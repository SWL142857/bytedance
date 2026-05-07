# HireLoop 复赛 Demo 交接说明

更新时间：2026-05-07

## 1. 本轮主要改动

这轮主要目标是把 HireLoop 从“功能很多但现场叙事分散”的状态，收口成一个可稳定演示、重点突出 Graph RAG 与虚拟组织的复赛 Demo。

### 前端 Demo 收口

- 首页进入 Demo Focus Mode，只保留主线模块：
  - Hero / 产品定位
  - 真实数据接入状态
  - Agent 工具轨迹
  - Graph RAG 查询与候选人分析
  - 虚拟组织接力状态
- 将一些容易分散注意力、或还不适合现场展示的模块默认隐藏：
  - 协作管线
  - Live Data
  - Audit Log
  - Operator Tasks
  - Analytics Report
  - Deferred Queue
- 修正了一批容易被评委误解的前端文案：
  - 不再展示英文执行确认词组合
  - 不再使用容易被理解为前端可写入的文案
  - 不再把 demo fixture 说成“真实审计轨迹”
  - demo 事件时间统一为“演示快照”
  - “阻塞”类文案改为“等待人工确认 / 写入被安全拦截 / 守卫已生效”

### Graph RAG 演示增强

- 给 Graph RAG 搜索区增加 Demo preset，避免现场自由输入导致结果不稳定：
  - AI 产品经理
  - 机器学习 / 数据分析
  - 内容运营 / 增长
  - 后端 / 数据工程
  - 强匹配·需复核
- 搜索 trace 明确标注数据源：
  - Competition Graph RAG 全量镜像
  - 5991 candidates / 23961 evidence / 38 roles
- 增加空结果、异常、服务不可用时的降级文案，避免现场空白。
- `competition-live-search.ts` 增加中文查询 enrichment，把中文岗位/技能词扩展成英文 token。
- `competition-demo-view-model.ts` 增加 role boost，让候选人 role 字段匹配成为更强信号。

### Feishu Base 与数据源边界

- 当前 Demo 使用两层数据源：
  - Feishu Base：用户侧可控业务样本，用于业务系统、状态流转、Agent 协作记录展示。
  - Competition Graph RAG 镜像：全量智能检索和可解释推荐。
- 增加“真实数据接入状态”面板，展示：
  - Graph RAG 是否就绪
  - Feishu Base 只读是否配置
  - 写入开关状态
  - 当前候选人、证据、岗位计数
- `writeDisabled` 已改为动态渲染，不再硬编码“写入关闭”。

### Agent 工具轨迹与虚拟组织

- 新增 `src/ui/agent-tool-trace.js`：
  - 优先展示 `/api/work-events` 返回的事件
  - 若无真实事件，则展示流程蓝图
  - demo fixture 会显示“审计轨迹示例”，不伪装成真实执行
- 新增 `src/ui/server-data-readiness.js`
- 新增 `src/ui/analytics-report.js`
- 统一 Agent / Work Events / Org Relay 里的状态文案，突出：
  - 前端只读
  - 后端双确认
  - planNonce
  - TOCTOU guard

### 自动检查与交付脚本

新增脚本：

- `scripts/auto-demo-loop.ts`
  - 只读自动检查 Demo 状态
  - 读取 Base status、Graph RAG overview、Work Events、Analytics plan
  - 输出安全快照，不执行写入

- `scripts/live-loop-preflight.ts`
  - 演示前 preflight
  - 只检查 env 是否 present/missing，不输出值
  - 检查 Base 状态、competition 数据路径、runbook 文件

- `scripts/competition-live-loop-runbook.ts`
  - 13 步竞赛闭环 runbook
  - 默认只读
  - execute 模式 fail-closed
  - 用于解释完整业务链路：数据产生 -> 状态更新 -> Agent 处理 -> 决策 -> 反馈 -> 报告

- `scripts/import-competition-demo-base.ts`
  - 用于把 competition demo 数据导入到用户自己的 Feishu Base

- `scripts/load-local-env.ts`
  - 本地 env 加载工具，方便脚本读取 `.env.local`

### 测试补强

新增或扩展了安全边界测试，重点覆盖：

- 前端不暴露 execute route
- 前端不暴露确认 token
- UI 不出现误导性写入文案
- demo fixture 不伪装成真实事件
- Graph RAG preset 存在且可用
- 搜索失败 / 空结果有安全降级文案
- 自动 demo loop 默认只读
- preflight 不泄露 env 值
- runbook execute guard fail-closed

当前关键验证结果：

```bash
pnpm typecheck
node --import tsx --test tests/server/server-routes.test.ts tests/scripts/auto-demo-loop.test.ts tests/scripts/competition-live-loop-runbook.test.ts tests/scripts/live-loop-preflight.test.ts
```

最近一次结果：

```text
typecheck pass
165 tests pass, 0 fail
```

## 2. 当前状态

### Git 状态

本轮改动已提交并推送到 GitHub：

```text
commit 219f375
message: Prepare HireLoop competition demo
branch: main
remote: origin/main
```

注意：本地有一个未提交目录：

```text
competition /
```

这个目录名末尾带空格，像是误拷资料目录，没有提交，也不建议提交。

### 当前 Demo 入口

本地启动：

```bash
pnpm ui:dev -- --port=3021
```

浏览器打开：

```text
http://localhost:3021
```

推荐演示路径：

1. 打开首页，先讲 HireLoop 是“AI Agent 虚拟招聘组织”。
2. 看“真实数据接入状态”，说明 Base 与 Graph RAG 的数据源分工。
3. 点击 Graph RAG preset：推荐用“AI 产品经理”或“机器学习 / 数据分析”。
4. 点击第一个候选人，展示图谱深度分析、证据链和推荐解释。
5. 回到虚拟组织接力状态，讲 7 个 Agent 如何围绕 Base 状态协作。
6. 最后强调安全边界：前端只读，真实写入必须后端双确认 + planNonce + TOCTOU guard。

### 当前数据源口径

现场一定要按这个口径讲：

- Feishu Base 不是全量检索库，而是业务系统承接层。
- Competition Graph RAG 镜像才是全量智能检索层。
- 两者计数不同是正常的：
  - Graph RAG：5991 candidates / 23961 evidence / 38 roles
  - Feishu Base：演示用业务样本，约 80 candidates / 38 jobs

## 3. 需要继续优化的重点

### A. Graph RAG 搜索质量继续优化

当前为了现场稳定，已经加了中文 query enrichment 和 role boost，但搜索质量仍有提升空间。

建议继续做：

- 检查 preset 的 Top 5 结果是否真的和岗位强相关。
- 优化中文查询到英文技能/岗位的映射表：
  - 产品经理
  - AI 产品
  - 数据分析
  - 机器学习
  - 内容运营
  - 增长
  - 后端
  - 数据工程
- 如果有时间，给每个 preset 固定一套“推荐展示候选人”，避免现场首位结果波动。
- 对搜索结果增加更强的 explanation：
  - 为什么匹配
  - 命中了哪些 evidence
  - 哪些点仍需人工复核

### B. Graph RAG 与 Base 的叙事再打磨

现在代码上已经明确两层数据源，但评委可能会问：

> 为什么 Base 里只有样本，而 Graph RAG 是全量镜像？

建议准备一句标准回答：

> Feishu Base 负责业务系统搭建、状态流转和协作沉淀；Graph RAG 负责全量候选人检索和证据推理。现场 Base 使用可控样本保证可复现，Graph RAG 使用全量镜像保证智能推荐能力，两者在产品中是“业务承接层 + 智能检索层”的组合。

### C. Agent 工具轨迹最好补真实事件

当前前端已经能区分：

- 真实 Work Events
- 审计轨迹示例
- 流程蓝图

但如果现场 `/api/work-events` 仍返回 demo fixture，标题会显示“审计轨迹示例”。这比伪装真实好，但创新性会弱一点。

建议继续优化：

- 演示前跑一条真正的 dry-run / plan 流程，生成新的 Work Events。
- 让 Work Events 里至少出现：
  - Graph RAG search
  - candidate review
  - interview kit plan
  - analytics plan
- 避免出现真实写入执行类事件，保持前端只读口径。

### D. Analytics 当前更适合作为备选，不建议主讲

Analytics 面板已经做了降级和计划展示，但目前默认隐藏。

建议：

- 主讲不要展开 Analytics。
- 如果评委问闭环报告，可以讲：
  - 系统具备 Analytics Agent
  - 当前以只读 plan 展示
  - 真实写报告需要后端双确认
- 后续如果有时间，可以把 Analytics 报告做成更漂亮的 Base 报告截图或单页文档。

### E. 继续清理前端过多信息

当前已经隐藏了很多模块，但如果现场还觉得页面复杂，可以继续做：

- Graph RAG 结果只保留 Top 3，避免页面过长。
- Agent 工具轨迹只展示 4 步：
  - 数据读取
  - Graph RAG 检索
  - Reviewer 解释
  - 人工确认门
- 虚拟组织状态只保留 7 Agent 卡片和当前状态，不展示太多描述。

### F. 提交材料补充

已经有本地核心代码包：

```text
tmp/hireloop-core-submission.zip
```

这个包没有提交到 GitHub，因为 `tmp/` 被忽略。提交平台如果需要“核心代码展示”，可以直接上传这个 zip。

如果后续要把 PPT 也交上去，当前本地文件：

```text
docs/hireloop-demo-slides.html
```

这个文件也被 gitignore 忽略了，没有推到 GitHub。若需要提交到仓库，需要手动 `git add -f docs/hireloop-demo-slides.html`。

## 4. 现场讲解建议

推荐主线：

> HireLoop 不是一个普通简历筛选工具，而是一个 AI Agent 虚拟招聘组织。Graph RAG 负责全量候选人理解与证据召回，Feishu Base 负责业务状态沉淀和协作流转。多个 Agent 围绕候选人、岗位、证据、面试材料和报告协作，形成从检索、解释、复核、决策到复盘的闭环。

最重要的三个亮点：

1. Graph RAG：5991 候选人、23961 条证据、38 类岗位，全量智能检索，不是关键词搜索。
2. 虚拟组织：7 个 Agent 有明确角色、输入输出和协作关系。
3. 安全落地：前端只读，写入必须后端双确认 + planNonce + TOCTOU guard。

避免现场主动展开：

- 真实写入 execute route
- confirm token
- 旧的隐藏 appendix 面板
- `competition /` 本地误拷目录
- “为什么所有数据没有都写进 Base”这类细节，除非评委问起。

## 5. 快速命令备忘

启动 UI：

```bash
pnpm ui:dev -- --port=3021
```

自动检查 Demo 状态：

```bash
pnpm auto:demo-loop -- --once --base-url=http://localhost:3021 --json
```

只读 preflight：

```bash
node --import tsx scripts/live-loop-preflight.ts --json
```

关键测试：

```bash
pnpm typecheck
node --import tsx --test tests/server/server-routes.test.ts tests/scripts/auto-demo-loop.test.ts tests/scripts/competition-live-loop-runbook.test.ts tests/scripts/live-loop-preflight.test.ts
```
