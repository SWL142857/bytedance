# Security Boundaries

## Non-Negotiable Rules

| 边界 | 当前保障 | 不能退化 |
|------|----------|----------|
| loopback-only 写入 | `isLocalRequest(req)` + server 绑定 `127.0.0.1` | UI 写入也不能绕过 |
| JSON body guard | `requireJsonContentType()` + `parseJsonBody()` | 带 body 的 POST 必须保持 |
| 4KB body cap | `parseJsonBody()` 累计 size 并返回 413 | 不能 destroy socket 后丢失响应 |
| 双确认 | write execute 要求 `EXECUTE` + `REVIEWED` | UI 不能预填 confirm |
| planNonce TOCTOU | execute 前重新读取、重跑 pipeline、复算 nonce | 不能直接执行旧计划 |
| 不写 offer/rejected | `validateLiveCandidateWriteScope()` | Agent 和 RAG 输入都不能越权 |
| 不泄露敏感输出 | server redaction + route tests | 新 route 也必须过 redaction |
| 安全错误消息 | 中文固定文案，无 stack trace | 不能透传 err.message 到前端 |

## Request Guards

请求边界集中在 `src/server/request-guards.ts`：

- `isLoopbackAddress()` 只接受 `127.0.0.1`、`::1`、`::ffff:127.0.0.1`。
- `isLocalRequest()` 使用 `req.socket.remoteAddress`，不信任 `Host` header。
- `requireJsonContentType()` 精确解析 media type，只接受 `application/json`。
- `parseJsonBody()` 限制 4KB，非法 JSON 或非对象 JSON 返回 400。

当前 live POST route 都保持 loopback guard。Provider demo、execute-writes、human decision 和 analytics report 还要求 JSON content-type 和 body cap。

## Provider Boundaries

Provider 相关能力默认 fail-closed：

- Provider smoke 需要 `--execute` 和 `EXECUTE_PROVIDER_SMOKE`。
- Provider Agent Demo 需要 `--use-provider`、`--execute` 和 `EXECUTE_PROVIDER_AGENT_DEMO`。
- Provider dataset verification 需要 `--execute-provider` 和 `VERIFY_PROVIDER_DATASET_EXECUTE`。

Provider 输出不得包含 endpoint、model ID、API key、request payload、authorization header、raw response、prompt 或 resume text。

## Base Write Boundaries

真实 Base 写入必须满足：

- `HIRELOOP_ALLOW_LARK_WRITE=1`
- 完整飞书配置
- explicit execute path
- confirm phrase
- command scope validation

Live candidate write scope 当前只允许：

- Candidates
- Resume Facts
- Evaluations
- Interview Kits
- Agent Runs

Reports 不在 Phase 7.0 live candidate write scope 内；Analytics report 使用 Phase 7.8 的 dedicated live analytics runner。

Human decision 是独立 guarded runner（Phase 7.7），只允许：

- `decision_pending -> offer` 或 `decision_pending -> rejected`
- 只写同一个 Candidates record 的 `human_decision*` 字段和 `status`
- Actor 必须是 `human_confirm`
- 双确认 + planNonce TOCTOU guard
- Agent 不能触发 offer/rejected

Analytics report 是独立 guarded runner（Phase 7.8），只允许：

- 只读读取 Candidates、Evaluations、Agent Runs
- 写入 Reports 和 Agent Runs
- 不写 Candidates、Evaluations、Interview Kits、Resume Facts
- 不做任何 status transition
- 双确认 + planNonce TOCTOU guard
- 没有候选人数据时 `needs_review`，不写空报告

## Redaction Rules

API JSON 和 UI 不应暴露：

- `rec_` record ID
- Base app token
- table ID
- command args
- payload
- stdout/stderr
- prompt
- resume text
- raw model response
- endpoint / model ID / API key
- stack trace 或 `.ts:` path

`SafeLinkView` 只暴露 opaque link ID，例如 `lnk_live_*`。link registry 有 TTL 和数量上限，过期后应 fail closed。

## Forbidden Trace Scan

`pnpm scan:forbidden-traces` 扫描仓库内容中的泄露痕迹。它只 block 危险上下文：

- 真实 secret marker
- 把 raw prompt/response/stdout/stderr/resumeText/payload 输出到日志
- 把 endpoint/modelId/apiKey 输出到日志

类型定义、配置对象、redaction 规则和测试断言中的普通字段名允许存在。CLI 只输出安全 JSON，不输出匹配原文。

## RAG Boundaries

RAG evidence 当前不进入 prompt。Phase 7.3/7.4 只处理数据契约和验证报告。

如果后续要让 evidence 进入 agent prompt，必须先明确：

- snippet redaction 策略
- evidence coverage 低时的降级策略
- evidence hash 是否进入 planNonce
- 哪些 agent 可以消费哪些 evidence
- UI 是否展示 evidence 原文还是摘要
