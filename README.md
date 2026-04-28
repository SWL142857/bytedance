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
| Work Events | Agent 工具调用与流程事件日志（safe summary、目标表、模式、状态、耗时、跳转状态） |
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

## 当前开发状态与路线

已完成：

| 阶段 | 状态 | 结果 |
|------|------|------|
| MVP deterministic local flow | 完成 | 5 Agent、Human Decision、Pipeline 和 Analytics 可通过 `pnpm mvp:demo` 离线验证 |
| Live Base guard | 完成 | record resolution、read-only smoke、write plan、guarded live write runner、audit、recovery、verification、runbook 和 release gate 已就绪 |
| Phase 5.3 | 完成 | disabled provider adapter boundary，默认 fail-closed |
| Phase 5.4 | 完成 | guarded provider connectivity smoke runner，默认 dry-run |
| Phase 5.5 | 完成 | guarded OpenAI-compatible provider client，实现 `LlmClient`，默认不接入业务 agents |
| Phase 5.6 | 完成 | schema retry and safe parse loop，invalid JSON/schema failure 最多安全重试一次 |
| Phase 5.7 | 完成 | opt-in provider-backed Resume Parser demo，无 Base 写入，默认不外呼 |
| Phase 5.8 | 完成 | API boundary release audit，并纳入 release gate |
| Phase 6.0 | 完成 | 安全本地 UI service + 中文企业级前端 shell，UI 仅消费安全 JSON，已通过 Codex review |
| Phase 6.1a | 完成 | 本地真实 agent 输入驱动 + runtime snapshot：`pnpm pipeline:run` 可从外部 JSON 跑真实 4-agent pipeline，并让 UI 优先展示安全快照 |
| Phase 6.4 | 完成 | Live dataset agent runner：`pnpm dataset:run` 支持 JSON array / JSONL 输入，默认 deterministic，provider execute 与 Base write 均受显式守卫且 fail-closed |
| Phase 6.6 | 完成 | 真实 forbidden trace scanner 已接入 release gate、API boundary audit 和 server report；`pnpm scan:forbidden-traces` 当前 0 findings |
| Phase 6.7 | 完成 | 飞书实时只读 + 安全跳转：`GET /api/live/base-status`、`GET /api/live/records?table=`、`/go/lnk_live_*` 302 到飞书 Base/对应表格页面；`HIRELOOP_ALLOW_LARK_READ=1` 独立只读开关；前端展示候选人/岗位实时数据与"打开飞书"按钮 |
| Phase 6.8 | 完成 | 前端候选人卡片可点击运行 deterministic Agent 预演，服务端只读解析真实候选人/岗位数据，写入本地安全 runtime snapshot；不写飞书、不外呼模型 |

当前开发重点：

| 阶段 | 状态 | 范围 |
|------|------|------|
| Phase 6.1 — Work Events 与飞书工作台集成 | 安全骨架完成 | Work Events 类型与 Base schema、demo fixture、统一 redaction、`/api/work-events` / `/api/org/overview` / `/go/:linkId` 安全骨架、UI 首页组织运行总览与最近活动；当前仍未启用真实飞书跳转或 Live Work Events 写入，但本地 UI 已可优先读取安全 runtime snapshot 展示真实 agent 运行结果 |
| Phase 6.2 — 操作员控制台 | 类型与只读任务清单已就绪 | `src/types/operator-task.ts`、`src/server/operator-tasks-demo.ts` 与 `GET /api/operator/tasks` 已落地，仅返回安全的只读任务清单（每个任务 `execute_enabled=false`），尚未提供任何 execute / spawn 入口；真实执行需要后续阶段开放并经人工确认 |
| Phase 6.3 — 数据伙伴接口契约 | 待定 | 与数据/RAG 侧对齐 `JobContext`、`CandidateProfile`、`RetrievedEvidence[]`、`AgentInputBundle` 等接口，先 mock 后替换 |
| Phase 6.5 — Provider dataset execute verification | 本地待验收 | `pnpm provider:dataset-verify` 已接入本地脚本入口，范围仅 provider 模型执行验证 + 本地 runtime snapshot，不做 Base 写入；blocked 时不 fallback deterministic |
| Phase 6.8 — 从前端点击运行 Agent Dry-run | 完成 | `POST /api/live/candidates/:linkId/run-dry-run`，从 UI 选真实飞书候选人跑 deterministic pipeline，不写飞书、不外呼模型 |
| Phase 6.9 — Provider Agent Preview | 完成 | `POST /api/live/candidates/:linkId/run-provider-agent-demo`，Confirm 确认后调用外部模型对真实候选人跑 Resume Parser，不写 Base |
| Phase 7.0 — 人工确认写回飞书 | 计划中 | 两步写回：生成 write plan → 双确认执行，仅推进到 decision_pending，不做 offer/rejected |

Phase 6.0 的最低验收边界（已完成）：

- 前端只能消费 `src/server/` 暴露的安全 JSON，不能直接读取 env、调用 provider client 或执行 Base command。
- 服务层必须统一过滤 command args、payload、authorization header、raw response、prompt、resume text、真实 endpoint/model ID/API key、Base record ID 和应用侧 demo ID。
- 500 错误返回固定安全中文消息，不向前端透传 err.message 或堆栈信息。
- UI 文案、按钮、状态、错误提示以中文为最高优先级，不引用外部字体 CDN。
- UI 首屏展示候选人流水线、虚拟员工动态、安全检查与审计、模型接入状态。
- 所有 execute 操作延后，当前 UI 只允许展示 dry-run/readiness/report 结果。
- 原有 CLI 验证链路必须保持不变：`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm mvp:demo`、`pnpm scan:forbidden-traces`、`pnpm mvp:release-gate`、`pnpm mvp:api-boundary-audit`。

Phase 6.1 安全骨架边界：

- 新增 `Work Events` 表与 `src/types/work-event.ts` 类型，`SafeWorkEventView` 不暴露 `event_id`、`parent_run_id`、`record_id`、`base_app_token`、`table_id`。
- `src/server/work-events-demo.ts` 提供固定 ISO 时间的中文 demo fixture，覆盖 5 个虚拟员工和 `tool_call`/`status_transition`/`guard_check`/`retry`/`human_action`/`blocked` 等模式。
- `redactWorkEvent` / `redactWorkEvents` / `buildSafeLinkForWorkEvent` 统一脱敏，未知或异常字段 fail-safe 返回安全值；`SafeLinkView` 仅在 `link_status === "demo_only"` 时返回 opaque `lnk_demo_NNN`，且 `available=false`。
- `/api/work-events` 输出脱敏后的事件列表；`/api/org/overview` 输出 5 个虚拟员工状态、流水线总览、最近活动和安全状态条；`/go/:linkId` 在 demo 模式下只返回中文 JSON 提示，未知链接返回中文安全 404。
- UI 首屏新增 “组织运行总览” 与 “最近活动” 板块；事件 link 按 `available` 门控：仅在安全链接可用时渲染可点击按钮，`demo_only` 事件显示不可点击文案 `飞书记录未接入`，不暴露真实飞书 URL/record/table/token。
- 当前不读取 `.env.local`、不调用外部模型、不执行真实飞书写入；live 跳转和 Live Work Events 写入留到后续阶段。

本地 runtime snapshot 补充边界：

- `pnpm pipeline:run` 允许通过 `--input-file` 或 `--input-json` 提供真实本地输入，运行 deterministic 4-agent pipeline，并将安全快照写入 `tmp/latest-agent-runtime.json`。
- UI server 在 `pnpm ui:dev` 下会优先读取 `tmp/latest-agent-runtime.json`；若快照不存在或无效，则自动回退到原有 demo fixture。
- runtime snapshot 只包含 redacted pipeline / work-events / org-overview 视图，不包含 command args、payload、prompt、resume text、Base record ID、run_id、provider config 或任何 secret。
- `org_overview.data_source` 会明确区分 `runtime_snapshot` 与 `demo_fixture`，并标记 deterministic / provider 来源、生成时间和是否存在外部模型调用；首页 header / footer 会据此切换“本地运行快照”或“演示样本”提示。
- runtime snapshot loader 会补齐旧版安全快照缺失的 `data_source`，并在快照结构异常、命中敏感字段或字符串模式时直接拒绝加载，回退到 demo fixture。
- 这条路径只用于本地真实 agent 演示，不代表已经接入真实飞书 Work Events、真实飞书跳转或真实 provider 外呼。

Phase 6.4 live dataset runner 边界：

- `pnpm dataset:run` 支持通过 `--input-file` 或 `--input-json` 读取多条候选人输入，接受 JSON array 或 JSONL；逐条校验输入并对错误做脱敏。
- 默认路径使用 deterministic client 运行多条 4-agent pipeline，并基于最后一条已执行结果写入安全 runtime snapshot；不会为生成快照重复跑最后一个 candidate。
- provider execute 必须同时满足 `--use-provider`、`--execute-model`、确认短语 `EXECUTE_PROVIDER_DATASET_AGENTS` 与完整 provider env；若条件不满足，返回 blocked 且退出非 0，不会 fallback deterministic。
- `--write-base` 路径仍受 `--input-record-ids-are-live`、`--write-confirm=EXECUTE_LIVE_DATASET_WRITES` 和 `HIRELOOP_ALLOW_LARK_WRITE=1` 共同守卫；输出只保留安全 summary，不透传底层 stdout/stderr。
- 当前 Work Events 写入仍因 schema 中必填的应用侧标识字段而保持 blocked；dataset runner 只报告安全 blocked summary，不输出 payload、event_id 或 record ID。

Phase 6.5 provider dataset verification（本地待验收）：

- `pnpm provider:dataset-verify` 是 provider execute 专用 wrapper，复用 dataset runner，只验证 provider 模型执行与本地 runtime snapshot，不做 Base 写入。
- 真实执行必须同时满足 `--execute-provider`、确认短语 `VERIFY_PROVIDER_DATASET_EXECUTE` 与完整 provider env；blocked 时退出非 0，不会 fallback deterministic。
- 输出只保留 `status`、mode、candidate/command 计数、`snapshotWritten`、`externalModelCalls` 与安全摘要，不暴露 snapshot path、endpoint、model ID、API key、payload、prompt、resume text、record ID 或 raw response。

产品与交付约束：

- 面向中国客户，UI 文案、按钮、状态说明、错误提示、使用说明和演示材料必须以中文为最高优先级；英文仅作为代码标识、内部类型名或必要技术术语出现。
- HireLoop Console 是飞书工作流的可视化与指挥层，不替代飞书 Base。深入查看业务数据时应通过安全跳转进入飞书原生页面。
- 飞书跳转必须通过服务端受控入口或 opaque link ID 暴露给前端；普通 API JSON 不应直接暴露 Base app token、table ID、record ID、CLI args 或完整敏感 URL。
- Work Events 用于证明虚拟员工通过飞书 CLI/OpenAPI 真实协作：记录工具类型、目标表、执行模式、guard 状态、安全摘要和耗时，但不记录 payload、authorization header、raw stdout/stderr、prompt、resume text 或 raw model response。

## Base Runtime

Agent 不直接拼接或执行 `lark-cli` 命令，统一通过 `src/base/runtime.ts` 生成 typed command plan，再交给 `runPlan()` 执行。这样可以集中处理 dry-run 默认行为、写入守卫、字段值校验和状态机校验。

Base link 字段只能写入真实记录 ID（`rec_xxx`），不能写业务侧 ID（如 `job_demo_*` 或 `cand_demo_*`）。在真实流程中需要先查询或创建目标记录，拿到 Base record ID 后再写关联字段。

lark-cli `+record-upsert` 不支持按业务字段自动查重；没有 `--record-id` 时就是创建新记录。真实更新操作必须先通过 `+record-list` 查询拿到 `rec_xxx`，再带上 `--record-id` 执行更新。

当前查询 helpers（`listCandidatesForStatusFilter` 等）不做服务端过滤，只生成 `+record-list` 分页读取命令。小规模 MVP 可在客户端过滤返回结果；数据规模增大后应改用预置视图 `--view-id` 或 data-query 接口。

当前 deterministic local agents 已覆盖 Resume Parser（new → parsed）、Screening（parsed → screened）、Interview Kit（screened → interview_kit_ready）、HR Coordinator（interview_kit_ready → decision_pending），完整的自动主链路可在无外部 API 的环境下通过 `pnpm pipeline:demo` 验证。若需要去掉执行路径中的硬编码样本并用真实本地输入运行，可使用 `pnpm pipeline:run --input-file=...` 或 `pnpm pipeline:run --input-json=...`，运行完成后 UI 会优先展示生成的 runtime snapshot。Analytics Agent 可基于 synthetic snapshot 生成招聘周报 command plan，通过 `pnpm report:demo` 验证。Human Decision Plan 支持 `decision_pending → offer / rejected`（仅 `human_confirm` actor），通过 `pnpm decision:demo` 验证。完整 MVP 串接（pipeline + human decision + analytics）可通过 `pnpm mvp:demo` 一键验证。

Record Resolution 层负责在真实 Base 执行前将应用侧 ID（`job_demo_*` / `cand_demo_*`）解析为 Lark record ID（`rec_xxx`），通过 `pnpm base:resolve:demo` 查看解析计划，`pnpm base:resolve:sample` 验证 sample parse 流程。Live-Ready MVP（resolution + pipeline + human decision + analytics）可通过 `pnpm mvp:live-ready` 一键验证。

Read-Only Live Smoke（`pnpm base:resolve:readonly`）允许显式执行 `+record-list` 读取真实 Base 数据并解析 record ID，但不执行任何写命令（`+record-upsert`、`+table-create` 等）。执行要求：`--execute-readonly` 路径、完整飞书配置（`LARK_APP_ID`、`LARK_APP_SECRET`、`BASE_APP_TOKEN`）、`HIRELOOP_ALLOW_LARK_READ=1`。即使配置齐全，也只执行 `writesRemote === false` 的只读命令。

Live Write Plan Builder（`pnpm mvp:live-write-plan`）使用 sample resolution 构建完整 MVP 写入计划（pipeline + human decision + analytics），所有 link/status 字段使用 `rec_xxx`。默认不执行写入，仅输出命令列表。`pnpm mvp:live-write-plan:readonly` 先通过 read-only resolution 拿到真实 `rec_xxx`，再构建写入计划；如果 resolution blocked 或未解析到记录，则不生成写入计划。

Guarded Live Write Runner（`pnpm mvp:live-write:dry-run`）对 Live Write Plan 做安全执行封装，dry-run 只输出 planned 结果，不打印 args、payload、stdout 或 token。真实写入只能通过 `pnpm mvp:live-write:execute` 触发，并且必须同时满足 read-only resolution 成功（`HIRELOOP_ALLOW_LARK_READ=1`）、`--execute`、确认短语 `EXECUTE_LIVE_MVP_WRITES`、完整飞书配置和 `HIRELOOP_ALLOW_LARK_WRITE=1`；否则返回 blocked/skipped，不执行写命令。

Live write runner 会输出 execution audit summary，记录 planned/skipped/success/failed 计数、失败停在第几条命令以及 recovery note。失败后不要盲目重跑整条链路，应先人工检查 Base 中已成功写入的前序记录，再决定补偿或定向重试。

Live Readiness Report（`pnpm mvp:live-readiness`）在真实写入前做只读 readiness summary，检查 config、resolution、records、write plan 和 command validation。默认 sample mode，支持 `--use-readonly-resolution` 执行真实 read-only resolution。不执行任何写命令。`ready=true` 也不代表自动执行，仍需人工 review 后再用 guarded live write runner。Demo 输出不包含 `rec_demo_*` 等 record ID，仅显示解析状态和计数。

Live Recovery Plan（`pnpm mvp:live-recovery`）根据 execution audit 生成结构化失败恢复计划，评估风险等级和已写入命令数，给出人工核对清单和重跑策略。失败后不要盲目重跑整链路，先用 audit 和 recovery plan 做人工核对和定向补偿判断。

Live Post-Write Verification Report（`pnpm mvp:live-verification`）用于 live write 执行后核验 Base 中关键结果是否存在且状态合理。默认 sample/offline，不执行写入。真正 live 后应结合 readiness、execution audit、recovery plan 和 verification report 做人工确认。

Live Operator Runbook（`pnpm mvp:live-runbook`）把 readiness、dry-run、human approval、execute、recovery、verification 串成人工可执行的 live 操作手册摘要。它只是安全门和执行清单，不会自动执行真实写入。Live 执行前应先看 readiness + dry-run，执行后看 audit + recovery + verification。失败后不要盲目重跑整链路。

MVP Release Gate（`pnpm mvp:release-gate`）生成最终交付检查清单，确认 typecheck、tests、local demo、live safety tools 和 forbidden trace scan 全部通过。默认路径会运行真实 forbidden trace scanner，并根据真实 API boundary audit 推导最终状态；它不会运行真实写入，也不会调用模型 API。推荐 demo 流程：typecheck → test → local demo → live-ready → runbook → dry-run。真实写入仍必须人工明确授权，并走 guarded runner。

Pre-API Freeze Report（`pnpm mvp:pre-api-freeze`）生成接入真实模型 API 前的架构冻结报告，确认 Agent 输出 schema、状态机、Base 写入守卫和 redaction policy 已锁定，deterministic demo 和 release gate 通过，LLM adapter 边界已定义。API 接入只能在 provider adapter / config validation / error mapping / schema retry wiring 层发生，不能改业务逻辑、放松写入守卫或绕过 schema 校验。默认仍不允许外呼模型或真实写 Base。

Provider Adapter Readiness（`pnpm mvp:provider-readiness`）展示 provider adapter 当前 readiness 状态。当前 provider adapter 是 disabled/fail-closed boundary，定义了接口、配置校验和错误映射，但默认不做任何外部网络调用。火山方舟接入边界要求 provider、endpoint、model ID 和 API key 配置齐全，但 demo 输出会隐藏具体 endpoint、model ID 和 key。真实 API 接入必须在后续阶段实现，并且必须保留 pre-api freeze 的 schema/state/write/redaction 边界。

Provider Connectivity Smoke（`pnpm mvp:provider-smoke`）dry-run 默认不发起外部模型调用，只说明需要哪些环境变量。真实连通性测试必须显式 `pnpm mvp:provider-smoke:execute`，并满足 `--execute` + `--confirm=EXECUTE_PROVIDER_SMOKE` + 本地 `MODEL_API_ENDPOINT` / `MODEL_ID` / `MODEL_API_KEY` 齐全。Smoke 只发送固定安全 prompt（"ping"），不发送简历文本、JD 或 Base record ID。输出只包含 redacted summary（status、httpStatus、hasChoices、contentLength、durationMs、errorKind），不包含 endpoint、apiKey、modelId、request payload、authorization header 或 raw response。此工具只用于人工确认 provider 可达，不代表业务 agent 已接入模型。不要把 key、model ID、endpoint 或 raw response 放进日志、issue 或 commit。

Provider Client Implementation（Phase 5.5）增加了 `OpenAICompatibleClient`，实现了 `LlmClient` 接口，可向 OpenAI-compatible endpoint 发送 `POST /chat/completions` 请求。该 client 通过 `buildProviderAdapterReadiness` 守卫，默认 disabled/blocked 时不调用任何外部 API；只在 config 完整且 enabled 时才发起请求。当前默认 demos（`pnpm mvp:demo`、`pnpm pipeline:demo` 等）仍使用 `DeterministicLlmClient`，业务 agents 不直接 import `OpenAICompatibleClient`。真实 provider client 只是后续 opt-in agent demo 的基础。所有测试均 mock fetch，不允许真实网络调用。Provider 错误映射为安全错误类型，不透传 raw body、apiKey、endpoint 或 modelId。

Schema Retry（Phase 5.6）为所有业务 agents 增加 shared safe parse loop：首次模型输出 JSON parse 或 schema validation 失败时，最多重试一次。retry prompt 使用固定安全说明，不包含完整原 prompt、简历、JD、raw model output、payload、endpoint、model ID 或 API key。重试仍失败时写入安全错误摘要，不透传原始模型输出。

Provider Agent Demo（Phase 5.7）提供 opt-in provider-backed Resume Parser demo。默认 `pnpm mvp:provider-agent-demo` 只是 dry-run plan，不调用外部模型。真实执行必须同时满足 `--use-provider`、`--execute`、确认短语 `EXECUTE_PROVIDER_AGENT_DEMO`、完整 provider env，以及通过 `--input-file` 或 `--input-json` 提供 Resume Parser 输入。该 demo 只生成 command plan，不写 Base，不输出 prompt、resume text、raw model output、endpoint、model ID、API key、payload、authorization header 或 Base record ID。

### Provider dataset verification

`pnpm provider:dataset-verify` 是一个 provider 模型执行验证工具，用于在本地已配置 provider 环境时对一条或多条候选人 pipeline 执行真实的模型外呼，并将结果写入本地 runtime snapshot。该命令**不做飞书 Base 写入**。

前置条件：
- 环境变量 `MODEL_API_ENDPOINT`、`MODEL_ID`、`MODEL_API_KEY` 必须全部存在。
- 如果任一变量缺失，命令会 blocked（退出码非 0），不会 fallback 到 deterministic。

示例：
```bash
pnpm provider:dataset-verify \
  --input-json='[{"candidateRecordId":"rec_001","jobRecordId":"rec_job_001","candidateId":"demo_001","jobId":"demo_job_001","resumeText":"简历文本","jobRequirements":"岗位要求","jobRubric":"评分标准"}]' \
  --execute-provider \
  --confirm=VERIFY_PROVIDER_DATASET_EXECUTE
```

输出为安全 JSON，仅包含：`status`、`mode`、`totalCandidates`、`completedCount`、`failedCount`、`totalCommands`、`snapshotWritten`、`externalModelCalls`、`safeSummary`。不输出 snapshot 路径、env 值、payload、prompt、resume text 或 record ID。

API Boundary Release Audit（Phase 5.8，`pnpm mvp:api-boundary-audit`）审计 provider/API 接入没有削弱默认安全边界：默认 demos 不外呼模型，provider smoke 和 provider agent demo 都需要显式 execute + confirm，Base 写入守卫保持独立，demo 输出不包含敏感数据，release gate 能反映 API boundary 状态。默认路径会运行真实 forbidden trace scanner；该 audit 不执行真实 provider 调用，也不写 Base。

Forbidden Trace Scan（Phase 6.6，`pnpm scan:forbidden-traces`）扫描仓库内容中的泄露痕迹，而不是简单关键词禁用。它只 block 三类危险上下文：真实 secret marker、把 raw prompt/response/stdout/stderr/resumeText/payload 输出到日志、把 endpoint/modelId/apiKey 输出到日志。类型定义、配置对象、redaction 规则和测试断言中的普通字段名允许存在。CLI 只输出安全 JSON：`status`、`findingCount`、分类计数和文件列表，不输出匹配原文；release gate、API boundary audit 和 server report 只使用 pass/block 状态，不向 UI 暴露 findings 明细。

### 飞书实时只读与安全跳转（Phase 6.7）

**前置条件：** 配置飞书应用凭证并启用只读开关：

```bash
export LARK_APP_ID=<飞书应用 ID>
export LARK_APP_SECRET=<飞书应用密钥>
export BASE_APP_TOKEN=<Base 应用凭证>
export HIRELOOP_ALLOW_LARK_READ=1      # 独立只读开关，不依赖写入开关

# 可选：配置飞书 Base 页面地址以启用跳转
export FEISHU_BASE_WEB_URL=<飞书 Base 页面 URL>
# 或 export LARK_BASE_WEB_URL=<Lark Base 页面 URL>

# 可选：配置表级页面 URL 后，Candidates / Jobs / Work Events 会跳转到对应表格
export FEISHU_CANDIDATES_WEB_URL=<候选人表格页面 URL>
export FEISHU_JOBS_WEB_URL=<岗位表格页面 URL>
export FEISHU_WORK_EVENTS_WEB_URL=<Work Events 表格页面 URL>
```

**读写开关分离：**
- `HIRELOOP_ALLOW_LARK_READ=1` — 允许只读访问飞书 Base（列出记录、查看数据）
- `HIRELOOP_ALLOW_LARK_WRITE=1` — 允许写入飞书 Base（执行 upsert/update），需双重确认

**API 端点：**
- `GET /api/live/base-status` — 返回飞书连接状态（readEnabled、blockedReasons）
- `GET /api/live/records?table=candidates` — 返回候选人安全列表（含 link、display_name、status、screening_recommendation、job_display、resume_available，不含 resume_text 原文和 record_id）
- `GET /api/live/records?table=jobs` — 返回岗位安全列表（含 link、title、department、level、status、owner）
- `GET /go/lnk_live_*` — 302 跳转到配置的飞书表格页面；优先使用 `FEISHU_CANDIDATES_WEB_URL` / `FEISHU_JOBS_WEB_URL` / `FEISHU_WORK_EVENTS_WEB_URL`，未配置时回退到 `FEISHU_BASE_WEB_URL` / `LARK_BASE_WEB_URL`；linkId 为 opaque UUID，不包含 recordId/table 信息

**安全约束：**
- 不配置时返回空数组和 blocked status，不抛 500
- 原始 resume_text 不返回，最多返回 `resume_available: true/false`
- record_id 仅在服务端内存 link registry 中存储，不暴露给前端
- 响应不含 rec_、BASE_APP_TOKEN、table_id、payload、stdout、stderr、resumeText、apiKey、endpoint
- link registry 有 TTL（24 小时）和上限（10,000 条）

**前端展示：** 首页新增"飞书实时数据"区域：连接状态条 → 候选人列表 + 岗位列表（每条有"打开飞书"按钮）；未连接时显示中文原因和需配置项名称。

**测试：** 无 env 时 `GET /api/live/base-status` 返回 `readEnabled=false` 和 blocked reasons，非 500；mock executor 下 `GET /api/live/records` 返回 safe projection；`/go/lnk_live_*` 在配置 Base URL 时返回 302。

### 点击运行 Agent 预演（Phase 6.8）

**前置条件：** 与 Phase 6.7 相同（飞书应用凭证 + `HIRELOOP_ALLOW_LARK_READ=1`）。

**API：** `POST /api/live/candidates/:linkId/run-dry-run`
- linkId 必须来自 live link registry（候选人记录）
- 服务端通过只读 lark-cli 重新读取候选人字段和关联岗位信息
- 使用 deterministic LLM client 运行 4-agent pipeline（Resume Parser → Screening → Interview Kit → HR Coordinator）
- 成功后将安全 runtime snapshot 写入 `tmp/latest-agent-runtime.json`
- 返回 `{ status, finalStatus, completed, agentRunCount, commandCount, snapshotUpdated, safeSummary }`
- blocked 条件：link 无效、非候选人、read env 缺失、候选人缺简历、岗位缺要求/评分标准

**安全约束：**
- 不使用 provider 模型，不写飞书 Base
- 不依赖 `HIRELOOP_ALLOW_LARK_WRITE`
- 响应不含 record_id、resume_text、payload、command args、stdout/stderr
- 失败返回固定中文安全文案，不透传 err.message

**UI：** 飞书实时数据的候选人卡片新增"运行 Agent 预演"按钮；点击后 POST、显示 loading、成功/失败/blocked 状态提示；快照写入后自动刷新流水线和组织总览。

**下一步（计划中）：**
- Phase 7.0：人工确认写回飞书
- Phase 7.0：两步写回飞书（生成 write plan → 双确认执行），仅推进状态，不做 offer/rejected

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

`.env.local` 已被 `.gitignore` 忽略。提交前应确认 `git status --short --ignored` 中它仍显示为 ignored，并运行 `pnpm scan:forbidden-traces`。不要把真实 API key、真实 model/endpoint ID、请求 payload、模型原始响应或完整简历文本复制到 README、issue、commit message、测试快照或日志中。

当前代码只提供 fail-closed provider adapter boundary 和 readiness demo；`pnpm mvp:provider-readiness` 不读取真实 key，也不发起外部模型调用。后续实现真实 API client 时，只能读取上述环境变量，并继续遵守 pre-api freeze 约束：schema 校验不可绕过、业务状态机不可放松、Base 写入守卫不可放松、输出必须 redacted。Phase 5.5 已实现 `OpenAICompatibleClient`，但默认 demos 仍使用 deterministic client。

## 运行方式

> **注意：本项目尚在开发中。** 以下为预期的运行方式，当前不代表系统已可真实运行。

预期流程：
1. 配置飞书应用凭据和 Base app token。
2. 运行建表脚本初始化 8 张表。
3. 写入示例岗位和候选人数据。
4. 触发 pipeline，各 Agent 依次处理。
5. 人类在 `decision_pending` 节点做最终决策。
6. Analytics Agent 生成周报。

## 项目结构

```text
src/
  types/          — 领域类型定义（Job, Candidate, ResumeFact, WorkEvent 等）
  orchestrator/   — 状态机、pipeline 编排、release gate 与 forbidden trace scanner
  agents/         — Agent 输出 schema 和校验
  base/           — 飞书 Base 表结构常量定义（含 Work Events 表）
  llm/            — deterministic client、provider adapter/client 和 guarded provider runners
  runtime/        — 外部 JSON 输入装载与本地 agent 运行辅助
  server/         — 安全本地 UI service layer、redaction、live base service 与 link registry
  ui/             — 静态前端 shell（含组织运行总览、最近活动、飞书实时数据）
tests/            — 纯逻辑测试
```

新增文件（Phase 6.1 / 6.1a）：

```text
src/types/work-event.ts            — Work Event / SafeLinkView / OrgOverview 类型
src/server/work-events-demo.ts     — 中文 Work Events demo fixture（固定 ISO 时间）
src/server/runtime-dashboard.ts    — runtime snapshot 构建 / 读写 / UI 安全投影
src/runtime/agent-input.ts         — 外部 JSON 输入装载与校验
scripts/run-agent-pipeline.ts      — 真实本地输入驱动的 4-agent pipeline runner
tests/server/work-events.test.ts   — /api/work-events、/api/org/overview、/go/:linkId 安全测试
tests/server/runtime-dashboard.test.ts — runtime snapshot 安全投影测试
tests/runtime/agent-input.test.ts  — 外部输入解析测试
tests/scripts/run-agent-pipeline.test.ts — pipeline runner 脚本测试
```

新增文件（Phase 6.4）：

```text
src/runtime/dataset-loader.ts          — JSON array / JSONL dataset 输入装载与脱敏校验
scripts/run-live-agent-dataset.ts      — 多 candidate dataset runner，默认 deterministic，provider / write-base 显式守卫
tests/runtime/dataset-loader.test.ts   — dataset loader 正常 / 异常 / 脱敏测试
tests/scripts/run-live-agent-dataset.test.ts — dataset runner guard、输出安全与注入式 write/provider 测试
```

新增文件（Phase 6.6）：

```text
src/orchestrator/forbidden-trace-scan.ts         — context-based forbidden trace scanner
scripts/run-forbidden-trace-scan.ts              — scanner CLI，输出安全 JSON
tests/orchestrator/forbidden-trace-scan.test.ts  — scanner 规则、allowlist、脱敏测试
tests/scripts/forbidden-trace-scan.test.ts       — scanner CLI exit code 与输出安全测试
```

新增文件（Phase 6.7）：

```text
src/server/live-base.ts                       — 飞书实时只读 service：status check、record listing（候选人/岗位安全投影）
src/server/live-link-registry.ts              — opaque link registry（内存 Map，24h TTL，10k 上限）
tests/server/live-base.test.ts                — live base service 单元测试（mock executor）
tests/server/live-link-registry.test.ts       — link registry 单元测试
```

新增文件（Phase 6.5，本地待验收）：

```text
scripts/run-provider-dataset-verify.ts       — provider dataset execute verification wrapper，仅验证模型执行与本地 snapshot
tests/scripts/run-provider-dataset-verify.test.ts — provider dataset verification guard、输出安全与 subprocess 测试
```

新增文件（Phase 6.2 准备阶段）：

```text
src/types/operator-task.ts             — OperatorTask 与 SafeOperatorTaskView 类型
src/server/operator-tasks-demo.ts      — 只读任务清单 demo（execute_enabled=false）
tests/server/operator-tasks.test.ts    — /api/operator/tasks 只读 + 安全测试
```

## 开发

```bash
# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 构建
pnpm build

# 启动本地 UI 服务
pnpm ui:dev

# 用真实本地输入运行 4-agent pipeline，并生成 UI 可读的 runtime snapshot
pnpm pipeline:run --input-json='{"candidateRecordId":"recCandidate001","jobRecordId":"recJob001","candidateId":"cand_001","jobId":"job_001","resumeText":"候选人简历文本","jobRequirements":"岗位要求","jobRubric":"评分标准"}'

# 或使用文件输入
pnpm pipeline:run --input-file=./path/to/candidate-pipeline.json

# 用 dataset JSON array / JSONL 运行多条 candidate pipeline（默认 deterministic，不写 Base）
pnpm dataset:run --input-file=./path/to/candidate-dataset.jsonl

# 或直接传入 JSON array
pnpm dataset:run --input-json='[{"candidateRecordId":"recCandidate001","jobRecordId":"recJob001","candidateId":"cand_001","jobId":"job_001","resumeText":"候选人简历文本","jobRequirements":"岗位要求","jobRubric":"评分标准"}]'

# Provider-backed dataset execute（需要 provider env + execute-model + confirm；blocked 时不 fallback deterministic）
node --import tsx scripts/run-live-agent-dataset.ts \
  --input-file=./path/to/candidate-dataset.jsonl \
  --use-provider \
  --execute-model \
  --confirm=EXECUTE_PROVIDER_DATASET_AGENTS

# Provider dataset execute verification wrapper（仅验证模型执行与本地 snapshot，不做 Base 写入）
pnpm provider:dataset-verify --input-file=./path/to/candidate-dataset.jsonl --execute-provider --confirm=VERIFY_PROVIDER_DATASET_EXECUTE

# 查看组织运行总览（demo 安全 JSON）
curl http://localhost:3000/api/org/overview

# 查看最近 Work Events（demo 安全 JSON）
curl http://localhost:3000/api/work-events

# 查看 Phase 6.2 操作员任务只读清单（每个任务 execute_enabled=false）
curl http://localhost:3000/api/operator/tasks

# Provider-backed Resume Parser dry-run
pnpm mvp:provider-agent-demo

# Provider-backed Resume Parser execute（需要 provider env + 输入 + confirm）
node --import tsx scripts/run-provider-agent-demo.ts \
  --use-provider \
  --execute \
  --confirm=EXECUTE_PROVIDER_AGENT_DEMO \
  --input-file=./path/to/resume-parser.json
```

## 许可

MIT
