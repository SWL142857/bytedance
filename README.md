# 职链 HireLoop

基于飞书多维表格 Base 的 AI 招聘虚拟组织。

## 定位

HireLoop 是一个 **可解释、可审计、由人类最终决策** 的招聘运营辅助系统。Agent 生成证据、建议和报告，但最终从 `decision_pending` 到 `offer` 或 `rejected` 的决策必须由人类确认并记录。

系统不是自动录用或自动淘汰工具。

## MVP Agent

| Agent | 职责 | 可写表 |
|-------|------|--------|
| HR Coordinator | 流程协调、任务分配、状态更新 | Candidates, Agent Runs |
| Resume Parser | 简历结构化事实抽取（只抽取不评价） | Resume Facts, Candidates, Agent Runs |
| Screening | 基于 JD 和事实做三档评估 | Evaluations, Candidates, Agent Runs |
| Interview Kit | 生成面试问题、评分表、关注点 | Interview Kits, Candidates, Agent Runs |
| Analytics | 漏斗统计、周报、阻塞点分析 | Reports, Agent Runs |

## MVP Base 表

| 表 | 用途 |
|----|------|
| Jobs | 岗位定义、要求、评分标准 |
| Candidates | 候选人记录与状态跟踪 |
| Resume Facts | 从简历抽取的结构化事实 |
| Evaluations | 初筛评估结果 |
| Interview Kits | 面试准备材料 |
| Agent Runs | 审计日志（输入摘要、输出、prompt 版本、状态变更、错误） |
| Reports | 招聘周报与分析 |

## 状态流

```text
new → parsed → screened → interview_kit_ready → decision_pending → offer / rejected
```

- Agent 推进 `new` 到 `decision_pending` 的每一步。
- `offer` / `rejected` 只能由人类确认触发，Agent 不能自动决定。
- `talent_pool` 不作为主状态，只在 Evaluations 或 Reports 中作为建议标签出现。
- Screening 推荐为三档：`strong_match` / `review_needed` / `weak_match`。

## 技术约束

- 所有业务状态沉淀在飞书 Base，Agent 通过真实 OpenAPI/SDK/CLI 操作数据。
- 使用国内模型，不做任何微调（包括 LoRA、PEFT、RLHF）。
- 允许 Prompt Engineering、Sub-agent、Tool-use；数据量扩大时可引入 RAG。
- Agent Runs 记录审计依据（输入摘要、输出 JSON、evidence 引用、prompt 版本、状态变更），不记录完整思维链或简历原文。

## 运行方式

> **注意：本项目尚在开发中。** 以下为预期的运行方式，当前不代表系统已可真实运行。

预期流程：
1. 配置飞书应用凭据和 Base app token。
2. 运行建表脚本初始化 7 张表。
3. 写入示例岗位和候选人数据。
4. 触发 pipeline，各 Agent 依次处理。
5. 人类在 `decision_pending` 节点做最终决策。
6. Analytics Agent 生成周报。

## 项目结构

```text
src/
  types/          — 领域类型定义（Job, Candidate, ResumeFact 等）
  orchestrator/   — 状态机和 pipeline 编排
  agents/         — Agent 输出 schema 和校验
  base/           — 飞书 Base 表结构常量定义
tests/            — 纯逻辑测试
```

## 开发

```bash
# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 构建
pnpm build
```

## 许可

MIT
