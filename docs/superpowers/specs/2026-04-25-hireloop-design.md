# 职链 HireLoop 设计规格

> Historical design note. Superseded for current execution by `docs/current-state.md` and the 2026-05-02 Virtual Org Console frontend design. This file still explains the original 5-Agent MVP rationale, but new work should use the current 7-Agent organization.

## 1. 项目定位

**职链 HireLoop** 是一个基于飞书多维表格 Base 的 AI 招聘虚拟组织。系统由多个 Agent 员工协同完成招聘运营中的结构化工作：岗位建模、候选人录入、简历事实抽取、初筛评估、面试工具包生成、人工决策记录与招聘周报。

系统定位为 **人类决策辅助系统**，不是自动录用或自动淘汰系统。Agent 可以生成证据、建议和报告，但最终从 `decision_pending` 到 `offer` 或 `rejected` 的决策必须由人类确认并记录。

## 2. 竞赛约束

- 所有业务状态沉淀在飞书 Base。
- Agent 必须通过真实多维表格 OpenAPI、SDK 或 CLI 操作数据。
- 不使用 mock 数据操作，不伪造日志，不虚构运行结果。
- 模型不做任何微调，包括全量微调、LoRA、PEFT、RLHF。
- 允许 Prompt Engineering、Sub-agent、Tool-use 和 RAG。
- 使用国内模型作为系统搭建与评测依赖的大语言模型。
- 交付物必须可复现，一键运行流程应能重建 Base 结构、写入示例数据并跑通业务链路。

## 3. MVP 范围

### 保留

- 5 个 Agent：HR Coordinator、Resume Parser、Screening、Interview Kit、Analytics。
- 7 张核心表：Jobs、Candidates、Resume Facts、Evaluations、Interview Kits、Agent Runs、Reports。
- 主状态流：`new -> parsed -> screened -> interview_kit_ready -> decision_pending -> offer/rejected`。
- 候选人建议标签：可在 Evaluations 或 Reports 中标记 `talent_pool_candidate`，但不作为 MVP 主状态。
- Agent Runs 审计表：记录 Agent 输入摘要、输出、prompt 版本、状态变更、错误和重试。
- 极简招聘周报：漏斗数量、平均评分、状态分布、阻塞点、人才库建议。

### 延后

- 真实多轮 AI 面试。
- 复杂 RAG 知识库和历史候选人画像。
- 细粒度动态权限图。
- 自动化人才库再推荐。
- 多岗位批量排名和自动拒信。

## 4. 核心亮点

1. **可解释审计链**
   每次 Agent 处理都写入 Agent Runs。系统记录可复核的输入摘要、输出 JSON、证据引用、prompt 标识、状态变更与错误信息，避免存储完整思维链或候选人敏感原文。

2. **Base 作为共享工作记忆**
   Agent 不通过临时上下文互相传递关键状态，而是通过 Base 表读写协作。Resume Parser 写 Resume Facts，Screening 读取事实并写 Evaluations，Interview Kit 读取评估结果并生成面试工具包。

3. **人在回路的招聘决策**
   Agent 只给出建议。`decision_pending -> offer/rejected` 必须记录人类操作者、决策时间和决策备注，体现企业真实流程中的责任边界。

## 5. Agent 设计

### HR Coordinator Agent

- 职责：招聘流程协调员。
- 输入：Candidates 中待处理记录、Jobs 岗位信息、当前状态。
- 输出：下一个待执行步骤、状态流转请求、异常分流建议。
- 可写表：Candidates、Agent Runs。
- 边界：不做候选人能力判断，不直接给 offer/rejected 结论。

### Resume Parser Agent

- 职责：简历事实抽取助理。
- 输入：候选人简历文本或简历文档链接、岗位基础信息。
- 输出：结构化 Resume Facts，包括教育、工作经历、项目、技能、证书、年限、语言等事实。
- 可写表：Resume Facts、Candidates、Agent Runs。
- 边界：只抽取事实，不做评价；不把 PII 原文写入 Agent Runs。

### Screening Agent

- 职责：初筛专员。
- 输入：Job rubric、Resume Facts、候选人当前状态。
- 输出：三档结论 `strong_match/review_needed/weak_match`，维度分，证据引用，风险提示。
- 可写表：Evaluations、Candidates、Agent Runs。
- 边界：评分只能基于 JD 明确要求与 Resume Facts；禁止使用受保护属性或替代性歧视信号。

### Interview Kit Agent

- 职责：面试准备助理。
- 输入：Job、Resume Facts、Evaluation。
- 输出：面试问题列表、评分维度、追问点、风险验证点。
- 可写表：Interview Kits、Candidates、Agent Runs。
- 边界：不模拟真实面试，不替代面试官评价。

### Analytics Agent

- 职责：招聘运营分析师。
- 输入：Jobs、Candidates、Evaluations、Interview Kits 的聚合数据。
- 输出：周报文本、漏斗统计、阻塞点、候选人质量概览、人才库建议。
- 可写表：Reports、Agent Runs。
- 边界：MVP 只做描述性分析和建议，不做预测性录用模型。

## 6. Base 表结构

### Jobs

- `job_id`：文本或自动编号。
- `title`：岗位名称。
- `department`：部门。
- `level`：岗位级别。
- `requirements`：岗位要求文本。
- `rubric`：评分标准文本。
- `status`：`open/paused/closed`。
- `owner`：负责人。
- `created_at`：系统创建时间。

### Candidates

- `candidate_id`：文本或自动编号。
- `display_name`：候选人展示名或脱敏编号。
- `job`：关联 Jobs。
- `resume_source`：简历来源或文档链接。
- `resume_text`：MVP 可存短文本；长简历应改用飞书文档链接。
- `status`：候选人流程状态。
- `screening_recommendation`：`strong_match/review_needed/weak_match`。
- `talent_pool_candidate`：布尔或单选建议标签。
- `human_decision`：`offer/rejected/none`。
- `human_decision_by`：人类决策人。
- `human_decision_note`：决策备注。

### Resume Facts

- `candidate`：关联 Candidates。
- `fact_type`：`education/work_experience/project/skill/certificate/language/other`。
- `fact_text`：事实内容。
- `source_excerpt`：短证据片段。
- `confidence`：`high/medium/low`。
- `created_by_agent`：Agent 名称。

### Evaluations

- `candidate`：关联 Candidates。
- `job`：关联 Jobs。
- `dimension`：评分维度。
- `rating`：`strong/medium/weak`。
- `score`：可选数字分，仅作辅助展示。
- `recommendation`：`strong_match/review_needed/weak_match`。
- `reason`：评价理由。
- `evidence_refs`：证据引用，指向 Resume Facts 的摘要或关联。
- `fairness_flags`：公平性风险提示。
- `talent_pool_signal`：人才库建议原因。

### Interview Kits

- `candidate`：关联 Candidates。
- `job`：关联 Jobs。
- `question_list`：结构化问题列表文本。
- `scorecard`：面试评分表文本。
- `focus_areas`：重点验证点。
- `risk_checks`：需要面试确认的风险。
- `created_by_agent`：Agent 名称。

### Agent Runs

- `run_id`：文本或自动编号。
- `agent_name`：Agent 名称。
- `entity_type`：`job/candidate/evaluation/interview_kit/report`。
- `entity_ref`：相关记录引用或 ID。
- `input_summary`：输入摘要，不存完整简历原文。
- `output_json`：Agent 结构化输出。
- `prompt_template_id`：Prompt 模板标识。
- `git_commit_hash`：运行时代码版本。
- `prompt_hash`：可选，用于验证模板内容一致性。
- `status_before`：处理前状态。
- `status_after`：处理后状态。
- `run_status`：`success/failed/retried/skipped`。
- `error_message`：错误信息。
- `retry_count`：重试次数。
- `duration_ms`：耗时。

### Reports

- `report_id`：文本或自动编号。
- `period_start`：周期开始。
- `period_end`：周期结束。
- `funnel_summary`：漏斗统计。
- `quality_summary`：候选人质量概览。
- `bottlenecks`：流程阻塞点。
- `talent_pool_suggestions`：人才库建议。
- `recommendations`：招聘运营建议。
- `created_by_agent`：Analytics Agent。

## 7. 状态机

主状态：

```text
new
parsed
screened
interview_kit_ready
decision_pending
offer
rejected
```

合法转移：

```text
new -> parsed
parsed -> screened
screened -> interview_kit_ready
interview_kit_ready -> decision_pending
decision_pending -> offer
decision_pending -> rejected
```

规则：

- Agent 只能推进到自己负责的下一状态。
- `offer/rejected` 只能由人类确认脚本或人工操作写入。
- 写状态前读取当前状态，若状态已变化则中止并记录冲突。
- MVP 使用串行 pipeline，避免多个 Agent 并发写同一 Candidate。

## 8. Prompt 与输出契约

- 每个 Agent 都有独立 `prompt_template_id`。
- Agent 输出必须是 JSON，并通过 schema 校验。
- 校验失败最多重试 2 次，仍失败则写 Agent Runs 并停止该候选人流程。
- Prompt 中必须包含公平性 guardrail。
- Screening Agent 的最终推荐只允许三档：`strong_match/review_needed/weak_match`。
- 维度分仅辅助展示，不直接驱动最终录用或淘汰。

## 9. 模型与 RAG 策略

MVP 默认不启用复杂 RAG。岗位要求和 rubric 直接来自 Jobs 表。

当数据量扩大后，引入 RAG：

- 招聘政策库。
- 岗位族能力模型。
- 面试题库。
- 历史优秀候选人去标识化摘要。

RAG 检索结果只能作为上下文补充，最终评价仍必须绑定到 Resume Facts 和 Jobs rubric。

## 10. 可复现运行设计

交付脚本应支持：

1. 初始化项目配置。
2. 创建或连接飞书 Base。
3. 创建 7 张表和必要字段。
4. 写入示例岗位和示例候选人。
5. 触发端到端 pipeline。
6. 写入 Agent Runs、Evaluations、Interview Kits 和 Reports。
7. 输出运行摘要和 Base 访问提示。

所有真实调用失败时，系统应记录失败原因，不允许伪造成功结果。

## 11. 安全与公平性

- 不将完整简历原文写入 Agent Runs。
- 不在 git 中提交飞书 token、模型 API key 或候选人真实 PII。
- Screening prompt 禁止基于性别、年龄、民族、婚育、籍贯、照片、学校偏见等因素做判断。
- 对模型拒答、格式错误、超时和限流做显式错误处理。
- 对人类决策单独记录，避免系统被误解为全自动招聘决策工具。

## 12. Codex 与 Claude Code 分工

### Codex 重点负责

- 需求拆解和架构约束。
- Base 表设计、状态机、并发、安全和公平性审查。
- Prompt 策略、Agent 边界和输出契约审查。
- 关键 diff review。
- 最终合并前审查。

### Claude Code 重点负责

- 项目脚手架。
- TypeScript 类型定义。
- Base client 封装。
- 状态机第一版实现。
- Agent 基类与模板文件。
- 第一版测试。
- README、技术文档、演示脚本整理。

## 13. 第一阶段任务

1. 初始化项目骨架和基础文档。
2. 实现 Base 表结构定义与建表脚本。
3. 实现 Base client、限流、重试和错误记录。
4. 实现状态机与串行 pipeline。
5. 实现 Resume Parser、Screening 和 Interview Kit 的 schema 校验链路。
6. 实现极简 Analytics 周报。
7. 跑通一条端到端 Demo，并生成测试报告。

## 14. 设计自检

- 范围聚焦在招聘初筛与面试准备，不实现自动录用。
- 每个 Agent 有明确输入、输出和可写表。
- Base 表覆盖实体、关系、状态和审计。
- 状态机无分叉死锁；`offer/rejected` 保持人类确认。
- 报告能力保留，满足竞赛数据分析要求。
- 不依赖微调，符合 Prompt、Tool-use、RAG 的竞赛约束。
