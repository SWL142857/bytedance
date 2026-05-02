# Competition P3 Agent Replacement Design

## Context

Competition teammate 的 `prompts.py` 定义了 5 个 Agent（Intake / Extraction / Graph Builder / Reviewer / Search），每个都有完整的 prompt 模板、few-shot examples 和输出 schema。HireLoop 现有 5 个 Agent（HR Coordinator / Resume Parser / Screening / Interview Kit / Analytics）。

P3 将 competition Agent prompt 集成进 HireLoop，替换重叠 Agent，新增图谱独有 Agent。

## Agent Mapping

| Competition Agent | HireLoop 现有 | 处理方式 |
|------|------|------|
| Intake | Resume Parser（部分） | **新增** Resume Intake Agent |
| Extraction | Resume Parser（部分） | **替换**为 Resume Extraction Agent |
| Graph Builder | *(无)* | **新增** Graph Builder Agent |
| Reviewer | Screening | **替换**为 Screening Reviewer Agent |
| Search | *(无)* | 已有 Graph RAG search API 覆盖，不新增 |

## Target: 7 Agent Organization

```
HR Coordinator      ← 保留（流程协调）
Resume Intake       ← 新增（确定性打包，不需 LLM）
Resume Extraction   ← 替换 Parser（LLM 结构化抽取）
Graph Builder       ← 新增（构建候选人相似图）
Screening Reviewer  ← 替换 Screening（图谱增强复核）
Interview Kit       ← 保留（面试准备）
Analytics           ← 保留（数据分析周报）
```

## Agent Details

### 1. Resume Intake（新增）
- **来源**: Competition `INTAKE_AGENT_PROMPT`
- **职责**: 接收原始简历 + JD，打包为干净 intake 记录
- **LLM 调用**: 否（纯确定性：复制文本、记录元数据、生成 candidate_id）
- **输入**: resume text, role name, job description
- **输出**: candidate_id, resume_raw, target_role, job_description_raw, source_metadata

### 2. Resume Extraction（替换 Resume Parser）
- **来源**: Competition `EXTRACTION_AGENT_PROMPT`
- **职责**: 从简历抽取结构化事实（skills/features/profile），含 confidence scoring
- **LLM 调用**: 是（demo 模式用 deterministic fallback）
- **输入**: resume text, target_role, job_description
- **输出**: skills[], features[{type/name/value/confidence/evidence}], profile{years/education/industry/leadership/communication/system_design/summary}

### 3. Graph Builder（新增）
- **来源**: Competition `GRAPH_BUILDER_AGENT_PROMPT`
- **职责**: 判断两个同岗位候选人是否应链接为图邻居
- **LLM 调用**: 是（demo 模式用相似度阈值 fallback）
- **输入**: candidate_a profile/skills/features, candidate_b profile/skills/features
- **输出**: should_link, link_reason, shared_signals[]

### 4. Screening Reviewer（替换 Screening）
- **来源**: Competition `REVIEWER_AGENT_PROMPT`
- **职责**: 综合 6 种信号做最终推荐
- **LLM 调用**: 是（demo 模式用确定性评分 fallback）
- **输入**: role_memory, candidate_profile, graph_projection, gnn_signal, query_aware_subgraph, top_neighbors
- **输出**: decision_pred (select|reject), confidence, reason_label, reason_group, review_summary

### 5-7. 保留不变
- HR Coordinator: 流程协调、状态推进
- Interview Kit: 面试问题、评分表
- Analytics: 漏斗统计、周报

## Safety Boundaries

```
evidenceMayEnterPrompt: false  → 不变（图谱证据不进 prompt text）
writesAllowed: false           → 不变
humanDecisionRequired: true    → 不变
no external LLM from dashboard → 不变（LLM 调用仅在 pipeline runner 内）
```

新 Agent 的 prompt 来自 competition 已验证模板，不包含敏感信息。

## Implementation Phases

### Phase 1: Agent Source Files
- 创建 `src/agents/intake.ts`
- 创建 `src/agents/extraction.ts`（替换 resume-parser.ts 的角色）
- 创建 `src/agents/graph-builder.ts`
- 创建 `src/agents/reviewer.ts`（替换 screener.ts 的角色）
- 更新 `src/agents/schemas.ts` 添加新输出类型

### Phase 2: Pipeline Integration
- 更新 `src/orchestrator/candidate-pipeline.ts` 使用新 Agent
- 保持 pipeline 结构不变，只替换 Agent 调用

### Phase 3: Tests
- 更新现有测试以适配新 Agent 输出
- 添加新 Agent 的单元测试

## Verification

```bash
pnpm typecheck
pnpm test
pnpm ui:dev -- --port=3001
```
