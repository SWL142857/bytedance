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

## Base Runtime

Agent 不直接拼接或执行 `lark-cli` 命令，统一通过 `src/base/runtime.ts` 生成 typed command plan，再交给 `runPlan()` 执行。这样可以集中处理 dry-run 默认行为、写入守卫、字段值校验和状态机校验。

Base link 字段只能写入真实记录 ID（`rec_xxx`），不能写业务侧 ID（如 `job_demo_*` 或 `cand_demo_*`）。在真实流程中需要先查询或创建目标记录，拿到 Base record ID 后再写关联字段。

lark-cli `+record-upsert` 不支持按业务字段自动查重；没有 `--record-id` 时就是创建新记录。真实更新操作必须先通过 `+record-list` 查询拿到 `rec_xxx`，再带上 `--record-id` 执行更新。

当前查询 helpers（`listCandidatesForStatusFilter` 等）不做服务端过滤，只生成 `+record-list` 分页读取命令。小规模 MVP 可在客户端过滤返回结果；数据规模增大后应改用预置视图 `--view-id` 或 data-query 接口。

当前 deterministic local agents 已覆盖 Resume Parser（new → parsed）、Screening（parsed → screened）、Interview Kit（screened → interview_kit_ready）、HR Coordinator（interview_kit_ready → decision_pending），完整的自动主链路可在无外部 API 的环境下通过 `pnpm pipeline:demo` 验证。Analytics Agent 可基于 synthetic snapshot 生成招聘周报 command plan，通过 `pnpm report:demo` 验证。Human Decision Plan 支持 `decision_pending → offer / rejected`（仅 `human_confirm` actor），通过 `pnpm decision:demo` 验证。完整 MVP 串接（pipeline + human decision + analytics）可通过 `pnpm mvp:demo` 一键验证。

Record Resolution 层负责在真实 Base 执行前将应用侧 ID（`job_demo_*` / `cand_demo_*`）解析为 Lark record ID（`rec_xxx`），通过 `pnpm base:resolve:demo` 查看解析计划，`pnpm base:resolve:sample` 验证 sample parse 流程。Live-Ready MVP（resolution + pipeline + human decision + analytics）可通过 `pnpm mvp:live-ready` 一键验证。

Read-Only Live Smoke（`pnpm base:resolve:readonly`）允许显式执行 `+record-list` 读取真实 Base 数据并解析 record ID，但不执行任何写命令（`+record-upsert`、`+table-create` 等）。执行要求：`--execute-readonly` 路径、完整飞书配置（`LARK_APP_ID`、`LARK_APP_SECRET`、`BASE_APP_TOKEN`）、`HIRELOOP_ALLOW_LARK_WRITE=1`。即使配置齐全，也只执行 `writesRemote === false` 的只读命令。

Live Write Plan Builder（`pnpm mvp:live-write-plan`）使用 sample resolution 构建完整 MVP 写入计划（pipeline + human decision + analytics），所有 link/status 字段使用 `rec_xxx`。默认不执行写入，仅输出命令列表。`pnpm mvp:live-write-plan:readonly` 先通过 read-only resolution 拿到真实 `rec_xxx`，再构建写入计划；如果 resolution blocked 或未解析到记录，则不生成写入计划。

Guarded Live Write Runner（`pnpm mvp:live-write:dry-run`）对 Live Write Plan 做安全执行封装，dry-run 只输出 planned 结果，不打印 args、payload、stdout 或 token。真实写入只能通过 `pnpm mvp:live-write:execute` 触发，并且必须同时满足 read-only resolution 成功、`--execute`、确认短语 `EXECUTE_LIVE_MVP_WRITES`、完整飞书配置和 `HIRELOOP_ALLOW_LARK_WRITE=1`；否则返回 blocked/skipped，不执行写命令。

Live write runner 会输出 execution audit summary，记录 planned/skipped/success/failed 计数、失败停在第几条命令以及 recovery note。失败后不要盲目重跑整条链路，应先人工检查 Base 中已成功写入的前序记录，再决定补偿或定向重试。

Live Readiness Report（`pnpm mvp:live-readiness`）在真实写入前做只读 readiness summary，检查 config、resolution、records、write plan 和 command validation。默认 sample mode，支持 `--use-readonly-resolution` 执行真实 read-only resolution。不执行任何写命令。`ready=true` 也不代表自动执行，仍需人工 review 后再用 guarded live write runner。Demo 输出不包含 `rec_demo_*` 等 record ID，仅显示解析状态和计数。

Live Recovery Plan（`pnpm mvp:live-recovery`）根据 execution audit 生成结构化失败恢复计划，评估风险等级和已写入命令数，给出人工核对清单和重跑策略。失败后不要盲目重跑整链路，先用 audit 和 recovery plan 做人工核对和定向补偿判断。

Live Post-Write Verification Report（`pnpm mvp:live-verification`）用于 live write 执行后核验 Base 中关键结果是否存在且状态合理。默认 sample/offline，不执行写入。真正 live 后应结合 readiness、execution audit、recovery plan 和 verification report 做人工确认。

Live Operator Runbook（`pnpm mvp:live-runbook`）把 readiness、dry-run、human approval、execute、recovery、verification 串成人工可执行的 live 操作手册摘要。它只是安全门和执行清单，不会自动执行真实写入。Live 执行前应先看 readiness + dry-run，执行后看 audit + recovery + verification。失败后不要盲目重跑整链路。

MVP Release Gate（`pnpm mvp:release-gate`）生成最终交付检查清单，确认 typecheck、tests、local demo、live safety tools 和 trace scan 全部通过。它不会运行真实写入，也不会调用模型 API。推荐 demo 流程：typecheck → test → local demo → live-ready → runbook → dry-run。真实写入仍必须人工明确授权，并走 guarded runner。

Pre-API Freeze Report（`pnpm mvp:pre-api-freeze`）生成接入真实模型 API 前的架构冻结报告，确认 Agent 输出 schema、状态机、Base 写入守卫和 redaction policy 已锁定，deterministic demo 和 release gate 通过，LLM adapter 边界已定义。API 接入只能在 provider adapter / config validation / error mapping / schema retry wiring 层发生，不能改业务逻辑、放松写入守卫或绕过 schema 校验。默认仍不允许外呼模型或真实写 Base。

Provider Adapter Readiness（`pnpm mvp:provider-readiness`）展示 provider adapter 当前 readiness 状态。当前 provider adapter 是 disabled/fail-closed boundary，定义了接口、配置校验和错误映射，但默认不做任何外部网络调用。火山方舟接入边界要求 provider、endpoint、model ID 和 API key 配置齐全，但 demo 输出会隐藏具体 endpoint、model ID 和 key。真实 API 接入必须在后续阶段实现，并且必须保留 pre-api freeze 的 schema/state/write/redaction 边界。

## 模型 API 本地配置

真实模型凭证只能放在本地环境文件或部署平台的 secret manager 中，不能提交到 GitHub。推荐流程：

```bash
cp .env.example .env.local
```

然后只在 `.env.local` 中填写：

```bash
MODEL_PROVIDER=volcengine-ark
MODEL_API_ENDPOINT=your_openai_compatible_base_url_here
MODEL_ID=your_model_or_endpoint_id_here
MODEL_API_KEY=your_model_api_key_here
```

`.env.local` 已被 `.gitignore` 忽略。提交前应确认 `git status --short --ignored` 中它仍显示为 ignored，并运行禁用痕迹扫描。不要把真实 API key、真实 model/endpoint ID、请求 payload、模型原始响应或完整简历文本复制到 README、issue、commit message、测试快照或日志中。

当前代码只提供 fail-closed provider adapter boundary 和 readiness demo；`pnpm mvp:provider-readiness` 不读取真实 key，也不发起外部模型调用。后续实现真实 API client 时，只能读取上述环境变量，并继续遵守 pre-api freeze 约束：schema 校验不可绕过、业务状态机不可放松、Base 写入守卫不可放松、输出必须 redacted。

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
