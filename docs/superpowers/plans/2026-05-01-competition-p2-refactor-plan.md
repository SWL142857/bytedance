# Competition P2 Refactor — Implementation Plan

> Historical implementation plan. Do not use this as the current frontend target. Current frontend direction is `docs/superpowers/specs/2026-05-02-virtual-org-console-frontend-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Feishu Live Pipeline as primary product, dissolve standalone Graph RAG UI into pipeline enhancement layer.

**Architecture:** A (Pipeline)为主 B (Graph RAG)为辅. Phase A dismantles P1 standalone competition UI and cleans intrusions from core files. Phase B embeds graph search/review into pipeline Screening + Decision stages.

**Tech Stack:** TypeScript 5, vanilla JS ES modules, Node.js HTTP server, Drizzle ORM, Playwright

**Spec:** `docs/superpowers/specs/2026-05-01-competition-p2-refactor-design.md`

---

## Phase A: Clean Up P1 Standalone Competition UI

### Task A1: Delete standalone competition UI files

**Files:**
- Delete: `src/ui/competition-demo.js`
- Delete: `src/ui/competition-demo-config.js`
- Delete: `src/ui/data-source-labels.js`

- [ ] **Step 1: Remove files**

```bash
rm src/ui/competition-demo.js
rm src/ui/competition-demo-config.js
rm src/ui/data-source-labels.js
```

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -r "competition-demo\|competition-demo-config\|data-source-labels" src/ui/ --include="*.js" --include="*.html"
```

Expected: No results (all imports will be removed in subsequent tasks).

- [ ] **Step 3: Commit**

```bash
git add -u src/ui/competition-demo.js src/ui/competition-demo-config.js src/ui/data-source-labels.js
git commit -m "chore(p2): remove standalone competition UI files"
```

---

### Task A2: Clean up app.js — remove competition init

**Files:**
- Modify: `src/ui/app.js:2,53`

- [ ] **Step 1: Remove competition import**

Remove line 2:
```diff
-import { initCompetitionDemo } from "./competition-demo.js";
```

- [ ] **Step 2: Remove competition init call**

Remove line 53:
```diff
-  initCompetitionDemo();
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.js
git commit -m "chore(p2): remove competition-demo init from app.js"
```

---

### Task A3: Restore index.html — pipeline-first layout

**Files:**
- Modify: `src/ui/index.html`

- [ ] **Step 1: Replace current main content with pipeline-first layout**

Replace the entire `<main>` content (from `<main>` opening through the end of `</section>` before the hidden divs) with the original pipeline-first structure. Restore the original hero section. Remove the standalone `#competition-section` entirely. Remove the `integration-section` wrapper and `integration-notice`. Keep Feishu live data section, bento dashboard, and console drawer in their original positions.

The target main content structure:

```html
  <main>
    <!-- Hero: KPI strip -->
    <section class="hero anim-fade-up delay-1">
      <div class="hero-head">
        <div>
          <div class="hero-title">组织运行总览</div>
          <div class="hero-subtitle">五位虚拟员工在岗，Pipeline 全链路可解释、可追溯、可审计</div>
        </div>
        <div class="hero-pill-row">
          <span class="hero-pill pill-success">Pipeline 就绪</span>
          <span class="hero-pill pill-brand">写入需人工授权</span>
        </div>
      </div>
      <div class="kpi-grid" id="kpi-grid">
        <div class="loading-pulse">加载中</div>
      </div>
    </section>

    <!-- Live Feishu Data -->
    <section class="live-data anim-fade-up delay-2" id="live-data-section">
      <div class="section-label">
        <span class="section-label-bar"></span>
        <span class="section-label-text">飞书实时数据</span>
        <span class="section-label-hint" id="live-data-hint">正在检查飞书连接</span>
      </div>
      <div id="live-base-status" class="live-status-bar">
        <div class="loading-pulse">检查飞书连接中</div>
      </div>
      <div class="live-grid" id="live-grid">
        <div id="live-candidates"><div class="loading-pulse">加载中</div></div>
        <div id="live-jobs"><div class="loading-pulse">加载中</div></div>
      </div>
    </section>

    <!-- Bento Dashboard -->
    <div class="bento anim-fade-up delay-2">
      <!-- Left column (~65%) -->
      <div class="bento-left">
        <section>
          <div class="section-label">
            <span class="section-label-bar"></span>
            <span class="section-label-text">候选人流水线</span>
            <span class="section-label-hint">自简历投递至人工决策的全过程</span>
          </div>
          <div id="pipeline-container" class="panel">
            <div class="loading-pulse">正在初始化流水线</div>
          </div>
        </section>

        <section>
          <div class="section-label">
            <span class="section-label-bar"></span>
            <span class="section-label-text">组织运行总览</span>
            <span class="section-label-hint">五位虚拟员工 · 实时状态与近况</span>
          </div>
          <div id="org-overview-container">
            <div class="loading-pulse">正在加载组织总览</div>
          </div>
        </section>
      </div>

      <!-- Right column (~35%) -->
      <div class="bento-right">
        <section>
          <div class="section-label">
            <span class="section-label-bar"></span>
            <span class="section-label-text">最近活动</span>
            <span class="section-label-hint">虚拟员工协作时事 · 仅展示安全摘要</span>
          </div>
          <div id="work-events-container">
            <div class="loading-pulse">正在加载最近活动</div>
          </div>
          <div id="work-events-message" class="link-message" hidden></div>
        </section>

        <section>
          <div class="section-label">
            <span class="section-label-bar"></span>
            <span class="section-label-text">操作员任务清单</span>
            <span class="section-label-hint">当前为只读 · 真实执行须人工授权</span>
          </div>
          <div id="operator-tasks-container">
            <div class="loading-pulse">正在加载任务清单</div>
          </div>
        </section>

        <!-- System Console Entry (collapsed) -->
        <div class="console-entry panel" id="console-entry">
          <div class="console-entry-head">
            <div class="console-entry-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M12 3 4 6v6c0 4.5 3.5 7.8 8 9 4.5-1.2 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>
            </div>
            <div class="console-entry-text">
              <div class="console-entry-title">系统控制台</div>
              <div class="console-entry-summary" id="console-summary">安全检查 · 模型状态 · 合规审计</div>
              <div class="section-source-hint">本地安全报告，不来自运行快照</div>
            </div>
            <span class="console-entry-badge" id="console-badge">全部正常</span>
          </div>
          <button type="button" class="console-entry-btn" id="console-open-btn">查看合规详情</button>
        </div>
      </div>
    </div>

    <!-- Hidden: report data containers -->
    <div hidden>
      <div id="release-gate-content"></div>
      <div id="api-audit-content"></div>
      <div id="pre-api-freeze-content"></div>
      <div id="live-readiness-content"></div>
      <div id="provider-readiness-content"></div>
      <div id="provider-smoke-content"></div>
      <div id="provider-agent-demo-content"></div>
    </div>
  </main>
```

- [ ] **Step 2: Update header brand-tag**

Change `<span class="brand-tag">操作员控制台</span>` to `<span class="brand-tag">Pipeline 控制台</span>`.

- [ ] **Step 3: Verify the HTML is well-formed**

```bash
pnpm typecheck
```

Expected: PASS (HTML is not typechecked but this verifies nothing else broke).

- [ ] **Step 4: Quick server smoke test**

```bash
pnpm ui:dev -- --port=3001 &
sleep 2
curl -s http://localhost:3001 | grep -o '组织运行总览\|候选人流水线\|飞书实时数据' | sort | uniq -c
```

Expected: All three original sections present, no `competition-section` or `integration-section`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/index.html
git commit -m "refactor(p2): restore pipeline-first layout, remove standalone competition section"
```

---

### Task A4: Clean up safety-badge.js — remove P1 getDataSourceMode

**Files:**
- Modify: `src/ui/safety-badge.js:3-10,47-53`

- [ ] **Step 1: Remove _dataSourceMode and getDataSourceMode**

Remove lines 3-8:
```diff
-var _dataSourceMode = "demo_fixture";
-
-export function getDataSourceMode() {
-  return _dataSourceMode;
-}
```

- [ ] **Step 2: Remove data source mode storage from renderDataSource**

Remove lines 47-48 from `renderDataSource`:
```diff
 export function renderDataSource(orgData) {
-  var ds = orgData && orgData.data_source;
-  _dataSourceMode = (ds && ds.mode === "runtime_snapshot") ? "runtime_snapshot" : "demo_fixture";
   updateModePill(orgData);
   updateFooterMeta(orgData);
 }
```

- [ ] **Step 3: Verify no remaining references**

```bash
grep -rn "getDataSourceMode" src/ui/ --include="*.js"
```

Expected: No results.

- [ ] **Step 4: Commit**

```bash
git add src/ui/safety-badge.js
git commit -m "chore(p2): remove P1 getDataSourceMode from safety-badge.js"
```

---

### Task A5: Clean up pipeline.js — remove P1 dynamic labels

**Files:**
- Modify: `src/ui/pipeline.js`

- [ ] **Step 1: Remove getDataSourceMode import**

```diff
-import { buildSafetySubText, safetyRow, getDataSourceMode } from "./safety-badge.js";
+import { buildSafetySubText, safetyRow } from "./safety-badge.js";
```

- [ ] **Step 2: Remove hero KPI dynamic source hint**

Replace the dynamic hint block added in P1 (the entire block after `grid.innerHTML = html;` that creates hintEl with getDataSourceMode) with no hint. The hero section should not have a data-source hint:

```diff
   grid.innerHTML = html;
-
-  // Add data-source hint after KPI grid
-  var heroSection = document.getElementById("hero-section");
-  if (heroSection) {
-    var existingHint = heroSection.querySelector(".section-source-hint");
-    if (!existingHint) {
-      var mode = getDataSourceMode();
-      var hintLabel = mode === "runtime_snapshot" ? "运行快照" : "本地演示样本";
-      var hintText = mode === "runtime_snapshot" ? "系统 KPI 来自运行快照" : "系统 KPI 来自演示数据";
-      var hintEl = document.createElement("div");
-      hintEl.className = "section-source-hint";
-      hintEl.innerHTML = '<span class="data-source-badge data-source-' + mode + '">' + hintLabel + '</span> ' + hintText;
-      heroSection.appendChild(hintEl);
-    }
-  }
```

- [ ] **Step 3: Remove pipeline dynamic source hint**

Replace the dynamic source hint at the end of `renderPipeline`:

```diff
-  var pipelineMode = getDataSourceMode();
-  var pipelineLabel = pipelineMode === "runtime_snapshot" ? "运行快照" : "本地演示样本";
-  html += '<div class="section-source-hint"><span class="data-source-badge data-source-' + pipelineMode + '">' + pipelineLabel + '</span> 确定性流水线演示，不写入飞书</div>';
+  html += '<div class="section-source-hint">确定性流水线演示，不写入飞书</div>';
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/pipeline.js
git commit -m "chore(p2): remove P1 dynamic data-source labels from pipeline.js"
```

---

### Task A6: Clean up work-events.js — remove P1 dynamic label

**Files:**
- Modify: `src/ui/work-events.js`

- [ ] **Step 1: Remove getDataSourceMode import**

```diff
-import { getDataSourceMode } from "./safety-badge.js";
 import {
   STATE_LABELS,
```

- [ ] **Step 2: Replace dynamic source hint with static**

```diff
-  var eventsMode = getDataSourceMode();
-  var eventsLabel = eventsMode === "runtime_snapshot" ? "运行快照" : "本地演示样本";
-  var eventsHint = eventsMode === "runtime_snapshot" ? "虚拟员工活动来自运行快照" : "虚拟员工演示事件，不来自运行快照";
-  html += '<div class="section-source-hint"><span class="data-source-badge data-source-' + eventsMode + '">' + eventsLabel + '</span> ' + eventsHint + '</div>';
+  html += '<div class="section-source-hint">虚拟员工演示事件，不来自运行快照</div>';
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/ui/work-events.js
git commit -m "chore(p2): remove P1 dynamic data-source label from work-events.js"
```

---

### Task A7: Clean up operator-tasks.js — remove P1 dynamic label

**Files:**
- Modify: `src/ui/operator-tasks.js`

- [ ] **Step 1: Remove getDataSourceMode import**

```diff
-import { getDataSourceMode } from "./safety-badge.js";
 import {
   AVAILABILITY_LABELS,
```

- [ ] **Step 2: Replace dynamic source hint with static**

```diff
-  var tasksMode = getDataSourceMode();
-  var tasksLabel = tasksMode === "runtime_snapshot" ? "运行快照" : "本地演示样本";
-  var tasksHint = tasksMode === "runtime_snapshot" ? "静态只读清单，来自运行快照" : "静态只读清单，不来自运行快照";
-  html += '<div class="section-source-hint"><span class="data-source-badge data-source-' + tasksMode + '">' + tasksLabel + '</span> ' + tasksHint + '</div>';
+  html += '<div class="section-source-hint">静态只读清单，不来自运行快照</div>';
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/ui/operator-tasks.js
git commit -m "chore(p2): remove P1 dynamic data-source label from operator-tasks.js"
```

---

### Task A8: Clean up live-records.js — remove P1 dynamic label

**Files:**
- Modify: `src/ui/live-records.js`

- [ ] **Step 1: Restore original hint text (remove data-source badge)**

```diff
-    if (hint) hint.innerHTML = '<span class="data-source-badge data-source-live_feishu">飞书实时只读</span> 飞书 Base 实时数据';
+    if (hint) hint.textContent = "飞书 Base 实时数据 · 只读模式";
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/ui/live-records.js
git commit -m "chore(p2): remove P1 data-source badge from live-records.js"
```

---

### Task A9: Restore operator-tasks-demo.ts notice

**Files:**
- Modify: `src/server/operator-tasks-demo.ts`

- [ ] **Step 1: Replace P1 competition notice**

```diff
-    notice: "当前为比赛演示模式：Graph RAG 为只读驾驶舱，飞书写入需要经人工确认流程。以下系统能力均为本地演示样本，不连接外部模型服务。",
+    notice: "操作员控制台当前为本地演示模式，仅展示只读任务清单；真实写入执行需要后续阶段开放并经人工确认。",
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/operator-tasks-demo.ts
git commit -m "chore(p2): restore operator-tasks notice from P1 competition copy"
```

---

### Task A10: Clean up style.css — remove standalone competition CSS

**Files:**
- Modify: `src/ui/style.css`

- [ ] **Step 1: Remove all competition-specific CSS**

Remove everything from `/* ── Competition Graph RAG Demo ── */` (line ~2345) through the end of the competition responsive section and the integration-section/data-source-badge CSS.

Specifically remove these blocks:
- `.competition-section` through `.competition-bar` (container/layout)
- `.competition-overview` through `.competition-safety-text` (overview panel)
- `.competition-search` through `.competition-query-chip:hover` (search area)
- `.competition-search-summary` (search summary)
- `.competition-candidate-list` through `.competition-risk-tag` (candidate cards)
- `.competition-loading-area` through `.competition-empty-msg` (states)
- `.competition-review` through `.competition-review-badges` (review panel)
- `.competition-review-section` through `.competition-checkpoint-text` (review sections)
- `.competition-projection-*`, `.competition-role-memory`, `.competition-features-*`, `.competition-neighbors-*`, `.competition-human-checkpoint`
- `.competition-section-header`, `.competition-section-title`, `.competition-section-badge`, `.competition-section-count`
- All competition responsive breakpoints
- `.integration-section`, `.integration-notice`, `.integration-notice svg`
- `.hero-compact` and all its responsive variants
- `.data-source-badge` and all its variants (`.data-source-competition_graph`, `.data-source-live_feishu`, `.data-source-demo_fixture`, `.data-source-runtime_snapshot`, `.data-source-system_report`)

The file should end at the last pre-P1 CSS rule (likely the last responsive rule before `/* ── Competition Graph RAG Demo ── */`).

- [ ] **Step 2: Verify no competition CSS remains**

```bash
grep -c "competition-\|data-source-badge\|integration-section\|integration-notice\|hero-compact" src/ui/style.css
```

Expected: 0 (all competition CSS removed).

- [ ] **Step 3: Verify CSS still serves correctly**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/style.css
```

Expected: 200

- [ ] **Step 4: Commit**

```bash
git add src/ui/style.css
git commit -m "chore(p2): remove standalone competition and P1 integration CSS"
```

---

## Phase A Verification

- [ ] **Step V1: Run full verification**

```bash
pnpm typecheck
pnpm exec tsx --test tests/server/server-routes.test.ts tests/server/competition-routes.test.ts tests/runtime/competition-demo-view-model.test.ts
pnpm competition:rag:prepare -- --limit=20
```

Expected: typecheck PASS, all 130 tests PASS, RAG prepare succeeds.

- [ ] **Step V2: Quick UI smoke test**

```bash
# Start server if not running
pnpm ui:dev -- --port=3001 &
sleep 3

# Verify core sections present
curl -s http://localhost:3001 | grep -o '组织运行总览\|候选人流水线\|飞书实时数据\|最近活动\|操作员任务清单\|系统控制台' | sort | uniq -c

# Verify competition standalone is gone
curl -s http://localhost:3001 | grep -c 'competition-section'
```

Expected: 6 core sections present, `competition-section` count = 0.

- [ ] **Step V3: Verify competition API routes still work**

```bash
curl -s http://localhost:3001/api/competition/overview | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status'], d['candidateCount'])"
curl -s "http://localhost:3001/api/competition/search?q=Python" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['candidates']), 'cards')"
```

Expected: `ready 5991` and `12 cards`.

---

## Phase B: Embed Graph RAG into Pipeline

Phase B is planned separately after Phase A verification. The design specifies:
- Graph RAG search/browse embedded in pipeline screening area
- Graph RAG review panel embedded in decision stage
- Competition API routes remain as data layer
- `competition-rag-adapter.ts` and `competition-demo-view-model.ts` remain as data providers

---

## Self-Review Checklist

1. **Spec coverage:** Each file modification in the design spec has a corresponding task (A1-A10).
2. **Placeholder scan:** No TBD, TODO, "implement later", or vague instructions.
3. **Type consistency:** All imports/exports verified — removing `getDataSourceMode` import from 4 files, `initCompetitionDemo` from 1 file, removing 3 source files.
