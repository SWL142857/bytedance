(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────

  var STATE_FLOW = [
    "new",
    "parsed",
    "screened",
    "interview_kit_ready",
    "decision_pending",
  ];

  var STATE_LABELS = {
    new: "新增",
    parsed: "已解析",
    screened: "已筛选",
    interview_kit_ready: "面试就绪",
    decision_pending: "待决策",
    offer: "录用",
    rejected: "淘汰",
  };

  var STATUS_ICONS = {
    pass: "✓",
    locked: "✓",
    fail: "✗",
    block: "✗",
    blocked: "✗",
    warn: "!",
    needs_review: "!",
  };

  var STATUS_LABELS_DISPLAY = {
    pass: "通过",
    locked: "已锁定",
    fail: "失败",
    block: "阻断",
    blocked: "已阻断",
    warn: "预警",
    warning: "预警",
    needs_review: "待复核",
    ready: "就绪",
    ok: "正常",
    disabled: "未启用",
    dry_run: "干跑",
    planned: "已计划",
    readonly: "只读",
    passed: "已通过",
    failed: "失败",
  };

  var TEXT_LABELS_DISPLAY = {
    Typecheck: "类型检查",
    "Test Suite": "测试套件",
    Tests: "测试",
    Build: "构建",
    "Local MVP Demo": "本地 MVP 演示",
    "Live Ready Demo": "在线就绪演示",
    "Live Operator Runbook": "在线操作员手册",
    "Guarded Execute Block": "执行守卫阻断",
    "Forbidden Trace Scan": "禁用痕迹扫描",
    "API Boundary Audit": "API 边界审计",
    "Deterministic Demo": "确定性演示",
    "Provider Smoke Guard": "供应商连通守卫",
    "Provider Agent Demo Guard": "供应商 Agent 演示守卫",
    "Base Write Guard Independence": "Base 写入守卫独立",
    "Output Redaction": "输出脱敏",
    "Secret Scan": "密钥扫描",
    "Release Gate Consistency": "交付门禁一致性",
    "Agent Output Schemas": "Agent 输出结构",
    "State Machine": "状态机",
    "Base Write Guards": "Base 写入守卫",
    "Redaction Policy": "脱敏策略",
    "Release Gate": "交付门禁",
    "LLM Adapter Boundary": "模型适配器边界",
    Config: "配置",
    Resolution: "记录解析",
    Records: "记录",
    "Write Plan": "写入计划",
    "Write Commands": "写入命令",

    "Typecheck passed.": "类型检查通过。",
    "All tests passed.": "全部测试通过。",
    "Build passed.": "构建通过。",
    "Local MVP demo produces expected output.": "本地 MVP 演示输出符合预期。",
    "Live readiness demo produces valid report.": "在线就绪演示生成了有效报告。",
    "Live operator runbook available and produces valid output.": "在线操作员手册可用，输出有效。",
    "Guarded execute correctly blocks without valid config.": "缺少有效配置时，执行守卫会正确阻断。",
    "Forbidden traces detected. Clean repository before release.": "检测到禁用痕迹，发布前需要清理仓库。",
    "Forbidden traces detected.": "检测到禁用痕迹。",
    "API boundary audit passed.": "API 边界审计通过。",
    "Deterministic MVP demo produces expected output.": "确定性 MVP 演示输出符合预期。",
    "Provider smoke runner is guarded (blocks without full env + confirm).": "供应商连通测试已受守卫保护，缺少完整环境或确认时会阻断。",
    "Provider agent demo runner is guarded (blocks without --use-provider + execute + confirm).": "供应商 Agent 演示已受守卫保护，缺少供应商开关、执行标记或确认时会阻断。",
    "Base write guard is independent and not relaxed.": "Base 写入守卫保持独立，未被放松。",
    "All demo outputs pass safety redaction checks.": "所有演示输出均通过安全脱敏检查。",
    "No configured provider values found in tracked artifacts.": "未在受跟踪产物中发现已配置的供应商敏感值。",
    "Release gate report is consistent with API boundary audit.": "交付门禁报告与 API 边界审计一致。",
    "Agent output schemas are locked. No schema changes allowed without re-freeze.": "Agent 输出结构已锁定；未经重新冻结不得修改。",
    "Candidate status flow is locked. No state transitions can be added or modified.": "候选人状态流已锁定；不得新增或修改状态推进。",
    "Base write guards are locked. Guarded runner conditions cannot be relaxed.": "Base 写入守卫已锁定；不得放松守卫条件。",
    "Redaction policy is locked. No raw output leaking allowed.": "脱敏策略已锁定；不得泄露原始输出。",
    "Deterministic demo not passing. Verify local demo before API integration.": "确定性演示尚未通过；接入 API 前需先验证本地演示。",
    "Release gate not passing. Clear all release gate blocks first.": "交付门禁尚未通过；需先清除所有阻断项。",
    "LLM adapter boundary not defined. Define adapter interface before API integration.": "模型适配器边界尚未定义；接入 API 前需先定义适配接口。",
    "Config is complete for live execution.": "在线执行所需配置完整。",
    "Read-only resolution is blocked. Fix config or Base access.": "只读记录解析被阻断；需修复配置或 Base 访问权限。",
    "Resolved 0 of 2 required records.": "必需记录已解析 0 / 2 条。",
    "Write plan generated 0 commands.": "写入计划生成 0 条命令。",
    "No commands to validate.": "暂无可验证命令。",
    "Provider adapter is not enabled.": "模型供应商适配器未启用。",
    "Provider \"volcengine-ark\" is disabled. No external model calls will be made.": "模型供应商 volcengine-ark 未启用，不会发起外部模型调用。",
    "Dry-run only. Provider \"volcengine-ark\" connectivity test is planned but not executed.": "仅干跑：模型供应商 volcengine-ark 连通测试已规划，但不会执行。",
    "Dry-run only. Provider \"volcengine-ark\" agent demo is planned but not executed.": "仅干跑：模型供应商 volcengine-ark Agent 演示已规划，但不会执行。",
    "Not ready. Fix: Resolution, Records, Write Plan, Write Commands. Then re-run readiness check.": "尚未就绪。请修复记录解析、记录、写入计划与写入命令后重新检查。",
    "Real writes require explicit human authorization via the guarded runner. On failure, review the execution audit, recovery plan, and verification report before deciding on targeted compensation or retry. Do NOT blindly re-run the full pipeline.": "真实写入必须通过受守卫保护的执行器，并取得明确人工授权。若执行失败，需先查看执行审计、恢复方案与验证报告，再决定定向补偿或重试；不得盲目重跑完整流水线。",
    "API boundary is audited. Default behavior: no external model calls, no real Base writes. Provider integration is guarded and opt-in only. Do not relax guards or bypass schema validation.": "API 边界已审计。默认行为为不调用外部模型、不执行真实 Base 写入；供应商接入受守卫保护且必须显式开启。不得放松守卫或绕过结构校验。",
    "Architecture is frozen before API integration. API work is restricted to provider adapter, config validation, error mapping, and schema retry wiring. Default behavior must remain: no external model calls, no real Base writes, no schema bypass. Any change to state machine, write guards, redaction, or output schemas requires re-freeze review.": "API 接入前架构已冻结。后续 API 工作仅限供应商适配、配置校验、错误映射与结构重试接线。默认行为必须保持：不调用外部模型、不执行真实 Base 写入、不绕过结构校验。任何状态机、写入守卫、脱敏或输出结构变更都必须重新冻结评审。",
    "add disabled-by-default provider adapter": "新增默认关闭的供应商适配器",
    "add provider config validation": "新增供应商配置校验",
    "add provider error mapping": "新增供应商错误映射",
    "add schema retry wiring behind existing output contracts": "在现有输出契约后接入结构重试",
    "changing candidate status flow": "修改候选人状态流",
    "relaxing guarded live write conditions": "放松在线写入守卫条件",
    "writing raw prompts, resumes, or credentials to output": "向输出写入原始提示词、简历或凭据",
    "bypassing schema validation": "绕过结构校验",
    "enabling external model calls by default": "默认启用外部模型调用",
    sample: "演示样本",
  };

  var EVENT_TYPE_LABELS = {
    tool_call: "工具调用",
    status_transition: "状态推进",
    guard_check: "守卫检查",
    retry: "重试",
    error: "错误",
    human_action: "人工操作",
    blocked: "已阻止",
  };

  var EXECUTION_MODE_LABELS = {
    dry_run: "干跑",
    live_read: "在线只读",
    live_write: "在线写入",
    blocked: "已阻止",
  };

  var SAFE_ERROR_MSG = "信息不可用，请稍后重试";

  var GUARD_STATUS_LABELS = {
    passed: "已通过",
    blocked: "已阻止",
    skipped: "已跳过",
  };

  var TOOL_TYPE_LABELS = {
    record_list: "读取记录",
    record_upsert: "写入记录",
    table_create: "建表",
    llm_call: "模型调用",
  };

  var TARGET_TABLE_LABELS = {
    candidates: "候选人",
    jobs: "岗位",
    resume_facts: "简历要点",
    evaluations: "评估",
    interview_kits: "面试包",
    agent_runs: "运行日志",
    reports: "报告",
    work_events: "工作事件",
  };

  var EVENT_VERB_BY_TYPE = {
    tool_call: "调用工具",
    status_transition: "推进候选人状态",
    guard_check: "执行守卫检查",
    retry: "触发重试",
    error: "记录错误",
    human_action: "完成人工操作",
    blocked: "阻断写入",
  };

  var AVATAR_CLASS_BY_AGENT = {
    "HR 协调": "avatar-hr",
    "简历解析": "avatar-resume",
    "初筛评估": "avatar-screening",
    "面试准备": "avatar-interview",
    "数据分析": "avatar-analytics",
  };

  var AGENT_DESCRIPTIONS = {
    "HR 协调": "流程协调 · 任务分配 · 状态跟进",
    "简历解析": "结构化简历事实抽取 · 不做评价",
    "初筛评估": "基于 JD 的三档判断 · 含理由",
    "面试准备": "生成面试题与评分表",
    "数据分析": "漏斗与阻塞点分析 · 周报",
  };

  var AVATAR_INITIALS = {
    "HR 协调": "HR",
    "简历解析": "简",
    "初筛评估": "评",
    "面试准备": "面",
    "数据分析": "析",
  };

  var TASK_CATEGORY_LABELS = {
    dry_run: "演练",
    readiness: "就绪检查",
    report: "分析报告",
  };

  var AVAILABILITY_LABELS = {
    available_readonly: "只读可查看",
    disabled_phase_pending: "即将开放",
    disabled_requires_human_approval: "需人工授权",
  };

  // ── Helpers ────────────────────────────────────────────────

  function esc(str) {
    if (str == null) return "";
    var d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
  }

  function fetchJson(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error(SAFE_ERROR_MSG);
      return res.json();
    }).catch(function () {
      throw new Error(SAFE_ERROR_MSG);
    });
  }

  function avatarHtml(agentName, sizeClass) {
    var cls = AVATAR_CLASS_BY_AGENT[agentName] || "avatar-hr";
    var initial = AVATAR_INITIALS[agentName] || (agentName ? agentName.charAt(0) : "·");
    var extra = sizeClass ? (" " + sizeClass) : "";
    return '<div class="agent-avatar ' + cls + extra + '" aria-hidden="true">' + esc(initial) + '</div>';
  }

  function eventAvatarHtml(agentName) {
    var cls = AVATAR_CLASS_BY_AGENT[agentName] || "avatar-hr";
    var initial = AVATAR_INITIALS[agentName] || (agentName ? agentName.charAt(0) : "·");
    return '<div class="event-avatar ' + cls + '" aria-hidden="true">' + esc(initial) + '</div>';
  }

  function relativeTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var diffMs = Date.now() - d.getTime();
    var sec = Math.round(diffMs / 1000);
    if (sec < 0) return "刚刚";
    if (sec < 60) return sec + " 秒前";
    var min = Math.round(sec / 60);
    if (min < 60) return min + " 分钟前";
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + " 小时前";
    var day = Math.round(hr / 24);
    if (day < 30) return day + " 天前";
    return d.toLocaleDateString("zh-CN");
  }

  function formatDateTime(d) {
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function targetTableLabel(t) { return TARGET_TABLE_LABELS[t] || t || ""; }

  function displayStatus(status) {
    return STATUS_LABELS_DISPLAY[status] || status || "";
  }

  function displayText(text) {
    if (text == null) return "";
    var str = String(text);
    return TEXT_LABELS_DISPLAY[str] || str;
  }

  function setHeaderTime() {
    var el = document.getElementById("header-time");
    if (!el) return;
    el.textContent = formatDateTime(new Date());
  }

  function badgeHtml(status) {
    if (!status) return "";
    var cls = String(status).toLowerCase().replace(/\s+/g, "_");
    return '<div class="status-badge ' + cls + '">' +
      '<span class="badge-dot"></span>' + esc(displayStatus(String(status))) + '</div>';
  }

  function indicatorHtml(label, value) {
    var on = value === true || value === "true";
    var off = value === false || value === "false";
    var cls = on ? "on" : off ? "off" : "";
    var text = on ? "开启" : off ? "关闭" : esc(displayText(value));
    return '<div class="indicator-row">' +
      '<span class="indicator-label">' + esc(label) + '</span>' +
      '<span class="indicator-value ' + cls + '">' + text + '</span>' +
      '</div>';
  }

  function checkListHtml(checks) {
    if (!checks || !checks.length) return "";
    var html = '<div class="check-list">';
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      var icon = STATUS_ICONS[c.status] || "·";
      html += '<div class="check-row">' +
        '<span class="check-icon ' + esc(c.status) + '">' + icon + '</span>' +
        '<span class="check-name">' + esc(displayText(c.name)) + '</span>' +
        '<span class="check-summary">' + esc(displayText(c.summary)) + '</span>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function codeListHtml(items) {
    if (!items || !items.length) return "";
    var html = '<div class="code-list">';
    for (var i = 0; i < items.length; i++) {
      html += '<code>' + esc(items[i]) + '</code>';
    }
    html += '</div>';
    return html;
  }

  function noteHtml(text) {
    if (!text) return "";
    return '<div class="note-block">' + esc(displayText(text)) + '</div>';
  }

  function changesHtml(allowed, blocked) {
    var html = "";
    if (allowed && allowed.length) {
      html += '<div class="changes-section changes-allowed">';
      html += '<div class="changes-title">允许的变更</div>';
      html += '<div class="changes-list">';
      for (var i = 0; i < allowed.length; i++) {
      html += '<div class="changes-item">' + esc(displayText(allowed[i])) + '</div>';
      }
      html += '</div></div>';
    }
    if (blocked && blocked.length) {
      html += '<div class="changes-section changes-blocked">';
      html += '<div class="changes-title">禁止的变更</div>';
      html += '<div class="changes-list">';
      for (var i = 0; i < blocked.length; i++) {
      html += '<div class="changes-item">' + esc(displayText(blocked[i])) + '</div>';
      }
      html += '</div></div>';
    }
    return html;
  }

  function errorHtml() {
    return '<div class="error-msg">' + esc(SAFE_ERROR_MSG) + '</div>';
  }

  // ── Hero KPI ────────────────────────────────────────────────

  var ICON_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 19c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M21.5 17.5c0-2.4-2-4-4.5-4"/></svg>';
  var ICON_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>';
  var ICON_BOLT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/></svg>';
  var ICON_PULSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>';
  var ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.5 7.8 8 9 4.5-1.2 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>';

  function kpiCardHtml(opts) {
    return '<div class="kpi-card">' +
      '<div class="kpi-icon kpi-icon-' + opts.tone + '">' + opts.icon + '</div>' +
      '<div class="kpi-label">' + esc(opts.label) + '</div>' +
      '<div class="kpi-value">' + esc(opts.value) +
        (opts.suffix ? ('<span class="kpi-value-suffix">' + esc(opts.suffix) + '</span>') : '') +
      '</div>' +
      '<div class="kpi-foot ' + (opts.footTone ? ('kpi-foot-' + opts.footTone) : '') + '">' +
        esc(opts.foot) + '</div>' +
      '</div>';
  }

  function renderHero(orgData, eventsData) {
    var grid = document.getElementById("kpi-grid");
    if (!grid) return;

    var pipeline = (orgData && orgData.pipeline) || { stage_counts: [] };
    var stageCounts = Array.isArray(pipeline.stage_counts) ? pipeline.stage_counts : [];
    var totalCandidates = 0;
    for (var i = 0; i < stageCounts.length; i++) {
      totalCandidates += Number(stageCounts[i].count) || 0;
    }
    var pendingDecision = 0;
    for (var j = 0; j < stageCounts.length; j++) {
      if (stageCounts[j].label === "待决策") {
        pendingDecision = Number(stageCounts[j].count) || 0;
        break;
      }
    }

    var agents = (orgData && Array.isArray(orgData.agents)) ? orgData.agents : [];
    var workingCount = 0;
    var idleCount = 0;
    var blockedCount = 0;
    for (var k = 0; k < agents.length; k++) {
      var s = agents[k].status;
      if (s === "工作中") workingCount++;
      else if (s === "需要人工处理") workingCount++;
      else if (s === "阻塞") blockedCount++;
      else idleCount++;
    }

    var events = Array.isArray(eventsData) ? eventsData : [];
    var blockedEvents = 0;
    var dryRunEvents = 0;
    for (var m = 0; m < events.length; m++) {
      if (events[m].execution_mode === "blocked") blockedEvents++;
      if (events[m].execution_mode === "dry_run") dryRunEvents++;
    }

    var safety = (orgData && orgData.safety) || {};
    var safetyOk = safety.read_only === true && safety.real_writes === false &&
      safety.external_model_calls === false;

    var html = "";
    html += kpiCardHtml({
      tone: "brand", icon: ICON_USERS,
      label: "流水线候选人",
      value: totalCandidates, suffix: "人",
      foot: "当前阶段分布 · 追踪 " + stageCounts.length + " 个流程状态",
    });
    html += kpiCardHtml({
      tone: "warning", icon: ICON_FLAG,
      label: "等待人工决策",
      value: pendingDecision, suffix: "人",
      foot: pendingDecision > 0 ? "请操作员尽快确认" : "暂无待决策",
      footTone: pendingDecision > 0 ? "warning" : "",
    });
    html += kpiCardHtml({
      tone: "purple", icon: ICON_BOLT,
      label: "在岗虚拟员工",
      value: agents.length || 5, suffix: "位",
      foot: workingCount + " 位工作中 · " + blockedCount + " 位阻塞",
      footTone: blockedCount > 0 ? "warning" : "success",
    });
    html += kpiCardHtml({
      tone: "info", icon: ICON_PULSE,
      label: "今日协作活动",
      value: events.length,
      foot: dryRunEvents + " 次干跑 · " + blockedEvents + " 次阻断",
    });
    html += kpiCardHtml({
      tone: safetyOk ? "success" : "warning", icon: ICON_SHIELD,
      label: "组织安全状态",
      value: safetyOk ? "安全" : "需复核",
      foot: "只读模式 · 写入需人工",
      footTone: safetyOk ? "success" : "warning",
    });

    grid.innerHTML = html;
  }

  // ── Org overview ────────────────────────────────────────────

  function statusClassFor(status) {
    if (status === "工作中") return "agent-status-active";
    if (status === "需要人工处理") return "agent-status-human";
    if (status === "阻塞") return "agent-status-blocked";
    return "agent-status-idle";
  }

  function buildSafetySubText(data) {
    var ds = data.data_source;
    var safety = data.safety;
    if (ds && ds.mode === "runtime_snapshot" && ds.snapshot_source === "provider") {
      return "当前展示模型运行快照；外部模型调用状态以安全标记为准，界面仍只读，真实写入仍需人工授权。";
    }
    if (ds && ds.mode === "runtime_snapshot") {
      return "当前展示本地运行快照；界面只读，真实写入仍需人工授权。";
    }
    return "当前展示演示样本；界面只读，所有真实写入需要人工授权。";
  }

  function renderOrgOverview(data, eventsData) {
    var el = document.getElementById("org-overview-container");
    if (!el) return;
    if (!data || !Array.isArray(data.agents)) {
      el.innerHTML = errorHtml("组织总览暂不可用。");
      return;
    }

    var events = Array.isArray(eventsData) ? eventsData : [];
    var countsByAgent = {};
    var blockedByAgent = {};
    for (var i = 0; i < events.length; i++) {
      var name = events[i].agent_name;
      if (!name) continue;
      countsByAgent[name] = (countsByAgent[name] || 0) + 1;
      if (events[i].execution_mode === "blocked") {
        blockedByAgent[name] = (blockedByAgent[name] || 0) + 1;
      }
    }

    var html = '<div class="org-overview-grid">';
    html += '<div class="org-agents-grid">';
    for (var j = 0; j < data.agents.length; j++) {
      var a = data.agents[j];
      var statusCls = "agent-status " + statusClassFor(a.status);
      var role = AGENT_DESCRIPTIONS[a.agent_name] || (a.role_label || "");
      var count = countsByAgent[a.agent_name] || 0;
      var blocked = blockedByAgent[a.agent_name] || 0;

      html += '<div class="agent-card">';
      html += '<div class="agent-card-head">';
      html += avatarHtml(a.agent_name);
      html += '<div class="agent-card-meta-top">';
      html += '<div class="agent-card-name">' + esc(a.agent_name) + '</div>';
      html += '<div class="agent-card-role">' + esc(role) + '</div>';
      html += '</div>';
      html += '<span class="' + statusCls + '"><span class="agent-status-dot"></span>' +
        esc(a.status) + '</span>';
      html += '</div>';
      html += '<div class="agent-card-summary">' + esc(a.last_event_summary || "暂无活动记录") + '</div>';
      html += '<div class="agent-card-foot">';
      html += '<span class="agent-card-foot-item">活动 <strong>' + count + '</strong> 次</span>';
      html += '<span class="agent-card-foot-item">阻塞 <strong>' + blocked + '</strong></span>';
      html += '<span class="agent-card-foot-item" style="margin-left:auto">' +
        (a.duration_ms != null ? '上次耗时 <strong>' + a.duration_ms + ' ms</strong>' : '—') +
        '</span>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';

    if (data.safety) {
      html += '<div class="org-safety">';
      html += '<div class="org-safety-title">组织安全状态</div>';
      html += '<div class="org-safety-sub">' + esc(buildSafetySubText(data)) + '</div>';
      html += '<div class="safety-rows">';
      html += safetyRow("只读模式", data.safety.read_only);
      html += safetyRow("真实写入", data.safety.real_writes);
      html += safetyRow("外部模型调用", data.safety.external_model_calls);
      html += safetyRow("演示模式", data.safety.demo_mode);
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';

    el.innerHTML = html;
  }

  function safetyRow(label, value) {
    var on = value === true;
    return '<div class="safety-row">' +
      '<span class="safety-row-label">' + esc(label) + '</span>' +
      '<span class="safety-row-value ' + (on ? 'on' : 'off') + '">' + (on ? '开启' : '关闭') + '</span>' +
      '</div>';
  }

  // ── Work events feed ──────────────────────────────────────

  function renderWorkEvents(events) {
    var el = document.getElementById("work-events-container");
    if (!el) return;
    if (!Array.isArray(events) || !events.length) {
      el.innerHTML = errorHtml("暂无最近活动。");
      return;
    }

    var html = '<div class="events-list">';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var verb = EVENT_VERB_BY_TYPE[e.event_type] || "执行操作";
      var target = targetTableLabel(e.target_table);
      var statusTransition = "";
      if (e.event_type === "status_transition" && e.status_after) {
        var afterLbl = STATE_LABELS[e.status_after] || e.status_after;
        var beforeLbl = e.status_before ? (STATE_LABELS[e.status_before] || e.status_before) : null;
        statusTransition = beforeLbl ? (beforeLbl + " → " + afterLbl) : ("推进到 " + afterLbl);
      }

      html += '<div class="event-row">';
      html += eventAvatarHtml(e.agent_name);
      html += '<div class="event-body">';
      html += '<div class="event-headline">';
      html += '<span class="event-headline-agent">' + esc(e.agent_name) + '</span>';
      html += '<span class="event-headline-action">' + esc(verb) + '</span>';
      if (target) {
        html += '<span class="event-headline-target">' + esc(target) + '</span>';
      }
      if (statusTransition) {
        html += '<span class="event-headline-action">·</span>';
        html += '<span class="event-headline-target">' + esc(statusTransition) + '</span>';
      }
      html += '</div>';

      html += '<div class="event-tag-row">';
      html += '<span class="event-tag tag-type-' + esc(e.event_type) + '">' +
        esc(EVENT_TYPE_LABELS[e.event_type] || e.event_type) + '</span>';
      if (e.tool_type) {
        html += '<span class="event-tag">' + esc(TOOL_TYPE_LABELS[e.tool_type] || e.tool_type) + '</span>';
      }
      html += '<span class="event-tag tag-mode-' + esc(e.execution_mode) + '">' +
        esc(EXECUTION_MODE_LABELS[e.execution_mode] || e.execution_mode) + '</span>';
      if (e.guard_status) {
        html += '<span class="event-tag tag-guard-' + esc(e.guard_status) + '">守卫·' +
          esc(GUARD_STATUS_LABELS[e.guard_status] || e.guard_status) + '</span>';
      }
      if (e.duration_ms != null) {
        html += '<span class="event-tag">耗时 ' + e.duration_ms + ' ms</span>';
      }
      html += '</div>';

      html += '<div class="event-summary">' + esc(e.safe_summary || "") + '</div>';
      html += '</div>';

      html += '<div class="event-aside">';
      html += '<span class="event-time">' + esc(relativeTime(e.created_at)) + '</span>';
      if (e.link) {
        if (e.link.available) {
          html += '<button type="button" class="event-link-btn" data-link-id="' +
            esc(e.link.link_id) + '">' + esc(e.link.link_label || "打开记录") + '</button>';
        } else {
          html += '<span class="event-link-unavailable">' + esc(e.link.unavailable_label || "飞书记录未接入") + '</span>';
        }
      }
      html += '</div>';

      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;

    var buttons = el.querySelectorAll(".event-link-btn");
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", function (ev) {
        var linkId = ev.currentTarget.getAttribute("data-link-id");
        openSafeLink(linkId);
      });
    }
  }

  function openSafeLink(linkId) {
    var msgEl = document.getElementById("work-events-message");
    if (!linkId) {
      if (msgEl) {
        msgEl.hidden = false;
        msgEl.textContent = "无可用的演示跳转。";
      }
      return;
    }
    fetch("/go/" + encodeURIComponent(linkId))
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!msgEl) return;
        msgEl.hidden = false;
        if (result.ok && result.data && result.data.message) {
          msgEl.textContent = String(result.data.message);
        } else {
          msgEl.textContent = "暂不可跳转。";
        }
      })
      .catch(function () {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = "暂不可跳转。";
        }
      });
  }

  // ── Operator tasks ────────────────────────────────────────

  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/></svg>';
  var ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
  var ICON_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 21h18"/><path d="M6 17V9"/><path d="M11 17V5"/><path d="M16 17v-7"/></svg>';

  function taskCategoryIcon(category) {
    if (category === "dry_run") return ICON_PLAY;
    if (category === "report") return ICON_CHART;
    return ICON_CHECK_CIRCLE;
  }

  function availabilityClass(av) {
    if (av === "available_readonly") return "avail-readonly";
    if (av === "disabled_phase_pending") return "avail-pending";
    return "";
  }

  function renderOperatorTasks(data) {
    var el = document.getElementById("operator-tasks-container");
    if (!el) return;
    if (!data || !Array.isArray(data.tasks)) {
      el.innerHTML = errorHtml("操作员任务清单暂不可用。");
      return;
    }

    var html = "";
    html += '<div class="operator-notice">';
    html += '<svg class="operator-notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>';
    html += '<span>' + esc(data.notice || "操作员控制台尚处于准备阶段，仅展示只读任务清单。") + '</span>';
    html += '</div>';

    html += '<div class="section-source-hint">静态只读清单，不来自运行快照</div>';

    html += '<div class="tasks-grid">';
    for (var i = 0; i < data.tasks.length; i++) {
      var t = data.tasks[i];
      var iconCls = "task-icon-" + (t.category || "readiness");
      var availCls = "task-card-availability " + availabilityClass(t.availability);

      html += '<div class="task-card">';
      html += '<div class="task-card-head">';
      html += '<div class="task-card-icon ' + iconCls + '">' + taskCategoryIcon(t.category) + '</div>';
      html += '<div class="task-card-title">' + esc(t.display_name) + '</div>';
      html += '<span class="' + availCls + '">' +
        esc(AVAILABILITY_LABELS[t.availability] || t.availability) + '</span>';
      html += '</div>';
      html += '<div class="task-card-desc">' + esc(t.description) + '</div>';
      html += '<div class="task-card-guard">' + esc(t.guard_summary || "") + '</div>';
      html += '</div>';
    }
    html += '</div>';

    el.innerHTML = html;
  }

  // ── Pipeline funnel ────────────────────────────────────────

  function renderPipeline(data, orgData) {
    var container = document.getElementById("pipeline-container");
    if (!container) return;

    var finalIdx = STATE_FLOW.indexOf(data.finalStatus);
    if (finalIdx === -1) finalIdx = STATE_FLOW.length - 1;

    var stageCounts = (orgData && orgData.pipeline && Array.isArray(orgData.pipeline.stage_counts))
      ? orgData.pipeline.stage_counts : [];
    var total = 0;
    for (var ci = 0; ci < stageCounts.length; ci++) {
      total += Number(stageCounts[ci].count) || 0;
    }

    var html = '<div class="flow-wrapper"><div class="flow-track">';

    for (var i = 0; i < STATE_FLOW.length; i++) {
      var reached = i <= finalIdx;
      var current = i === finalIdx && data.completed;
      var cls = "flow-stage" + (current ? " is-current" : reached ? " is-reached" : "");
      var label = STATE_LABELS[STATE_FLOW[i]] || STATE_FLOW[i];
      var count = stageCounts[i] ? (Number(stageCounts[i].count) || 0) : 0;
      var pct = total > 0 ? Math.round((count / total) * 100) : 0;

      html += '<div class="' + cls + '">';
      html += '<div class="flow-stage-pill">' + esc(label) + '</div>';
      html += '<div class="flow-stage-count">' + count + '</div>';
      html += '<div class="flow-stage-bar"><div class="flow-stage-bar-fill" style="width:' + pct + '%"></div></div>';
      html += '<div class="flow-stage-pct">占比 ' + pct + '%</div>';
      html += '</div>';

      if (i < STATE_FLOW.length - 1) {
        html += '<div class="flow-arrow">›</div>';
      }
    }

    html += '</div></div>';

    html += '<div class="pipeline-meta">';
    html += '<div class="meta-chip"><span class="meta-label">最终状态</span>' +
      '<span class="meta-value ' + (data.completed ? 'is-success' : '') + '">' +
      esc(STATE_LABELS[data.finalStatus] || data.finalStatus) + '</span></div>';
    html += '<div class="meta-chip"><span class="meta-label">是否完成</span>' +
      '<span class="meta-value ' + (data.completed ? 'is-success' : 'is-error') + '">' +
      (data.completed ? '是' : '否') + '</span></div>';
    html += '<div class="meta-chip"><span class="meta-label">命令总数</span>' +
      '<span class="meta-value">' + data.commandCount + '</span></div>';
    html += '<div class="meta-chip"><span class="meta-label">写入计划</span>' +
      '<span class="meta-value">已生成 ' + data.commandCount + ' 条</span></div>';
    if (data.failedAgent) {
      html += '<div class="meta-chip"><span class="meta-label">失败 Agent</span>' +
        '<span class="meta-value is-error">' + esc(data.failedAgent) + '</span></div>';
    }
    html += '</div>';

    container.innerHTML = html;
  }

  // ── Report renderers (render into drawer targets) ─────────

  function renderReleaseGate(data) {
    consoleHealthState.releaseGate.error = false;
    consoleHealthState.releaseGate.ok = isStatusOk(data.status);
    var drawerEl = document.getElementById("drawer-release-gate");
    if (!drawerEl) return;

    var html = '<div class="card-header"><span class="card-header-dot"></span>交付检查</div>';
    html += '<div class="card-body">';
    html += badgeHtml(data.status);
    html += '<div class="indicator-rows">';
    html += indicatorHtml("本地演示就绪", data.localDemoReady);
    html += indicatorHtml("Live 安全就绪", data.liveSafetyReady);
    html += indicatorHtml("真实写入", data.realWritePermittedByReport);
    html += indicatorHtml("外部模型调用", data.externalModelCallPermittedByReport);
    html += '</div>';
    html += checkListHtml(data.checks);
    html += codeListHtml(data.recommendedDemoCommands);
    html += noteHtml(data.finalHandoffNote);
    html += '</div>';
    drawerEl.innerHTML = html;
  }

  function renderApiAudit(data) {
    consoleHealthState.apiAudit.error = false;
    consoleHealthState.apiAudit.ok = isStatusOk(data.status);
    var drawerEl = document.getElementById("drawer-api-audit");
    if (!drawerEl) return;

    var html = '<div class="card-header"><span class="card-header-dot"></span>API 边界审计</div>';
    html += '<div class="card-body">';
    html += badgeHtml(data.status);
    html += '<div class="indicator-rows">';
    html += indicatorHtml("外部模型调用", data.defaultExternalModelCallsPermittedByReport);
    html += indicatorHtml("真实 Base 写入", data.realBaseWritesPermittedByReport);
    html += indicatorHtml("Provider Smoke 守卫", data.providerSmokeGuarded);
    html += indicatorHtml("Provider Agent 守卫", data.providerAgentDemoGuarded);
    html += indicatorHtml("Base 写入守卫独立", data.baseWriteGuardIndependent);
    html += indicatorHtml("确定性演示安全", data.deterministicDemoSafe);
    html += indicatorHtml("输出脱敏安全", data.outputRedactionSafe);
    html += indicatorHtml("密钥扫描", data.secretScanPassed);
    html += indicatorHtml("门禁一致", data.releaseGateConsistent);
    html += '</div>';
    html += checkListHtml(data.checks);
    html += codeListHtml(data.recommendedCommands);
    html += noteHtml(data.finalNote);
    html += '</div>';
    drawerEl.innerHTML = html;
  }

  function renderPreApiFreeze(data) {
    consoleHealthState.preApiFreeze.error = false;
    consoleHealthState.preApiFreeze.ok = isStatusOk(data.status);
    var drawerEl = document.getElementById("drawer-pre-api-freeze");
    if (!drawerEl) return;

    var html = '<div class="card-header"><span class="card-header-dot"></span>架构冻结</div>';
    html += '<div class="card-body">';
    html += badgeHtml(data.status);
    html += '<div class="indicator-rows">';
    html += indicatorHtml("允许 API 接入", data.apiIntegrationAllowed);
    html += indicatorHtml("允许外部模型", data.externalModelCallAllowedByReport);
    html += indicatorHtml("允许真实 Base 写入", data.realBaseWriteAllowedByReport);
    html += '</div>';
    html += checkListHtml(data.checks);
    html += changesHtml(data.allowedNextChanges, data.blockedChanges);
    html += noteHtml(data.finalNote);
    html += '</div>';
    drawerEl.innerHTML = html;
  }

  function renderLiveReadiness(data) {
    consoleHealthState.liveReadiness.error = false;
    consoleHealthState.liveReadiness.ok = data.ready === true;
    var drawerEl = document.getElementById("drawer-live-readiness");
    if (!drawerEl) return;

    var html = '<div class="card-header"><span class="card-header-dot"></span>在线写入就绪</div>';
    html += '<div class="card-body">';
    html += '<div class="readiness-hero">';
    html += '<div class="readiness-status ' + (data.ready ? 'ready' : 'not-ready') + '">' +
      (data.ready ? '就绪' : '未就绪') + '</div>';
    html += '<div class="readiness-metrics">';
    html += '<div class="readiness-metric"><div class="readiness-metric-value">' +
      data.resolvedRecordCount + ' / ' + data.requiredRecordCount + '</div>' +
      '<div class="readiness-metric-label">记录解析</div></div>';
    html += '<div class="readiness-metric"><div class="readiness-metric-value">' +
      data.plannedWriteCount + '</div>' +
      '<div class="readiness-metric-label">写入计划</div></div>';
    html += '<div class="readiness-metric"><div class="readiness-metric-value">' +
      esc(displayText(data.resolutionMode || '—')) + '</div>' +
      '<div class="readiness-metric-label">解析模式</div></div>';
    html += '</div></div>';
    html += checkListHtml(data.checks);
    if (data.nextStep) {
      html += '<div class="readiness-next">' + esc(displayText(data.nextStep)) + '</div>';
    }
    html += '</div>';
    drawerEl.innerHTML = html;
  }

  // ── Provider renderers (render into drawer targets) ────────

  function renderProviderReadiness(data) {
    consoleHealthState.providerReadiness.error = false;
    consoleHealthState.providerReadiness.ok = isStatusOk(data.status);
    var drawerEl = document.getElementById("drawer-provider-readiness");
    if (!drawerEl) return;

    var html = '<div class="card-header"><span class="card-header-dot"></span>就绪状态</div>';
    html += '<div class="card-body">';
    html += badgeHtml(data.status);
    html += '<div class="indicator-rows">';
    html += indicatorHtml("模型供应商", data.providerName);
    html += indicatorHtml("外部模型调用", data.canCallExternalModel);
    html += '</div>';
    if (data.blockedReasons && data.blockedReasons.length) {
      html += '<div class="blocked-reasons">';
      for (var i = 0; i < data.blockedReasons.length; i++) {
        html += '<div class="blocked-reason">' + esc(displayText(data.blockedReasons[i])) + '</div>';
      }
      html += '</div>';
    }
    html += '<div class="provider-summary">' + esc(displayText(data.safeSummary)) + '</div>';
    html += '</div>';
    drawerEl.innerHTML = html;
  }

  function renderProviderSmoke(data) {
    consoleHealthState.providerSmoke.error = false;
    consoleHealthState.providerSmoke.ok = isStatusOk(data.status);
    var drawerEl = document.getElementById("drawer-provider-smoke");
    if (!drawerEl) return;

    var html = '<div class="card-header"><span class="card-header-dot"></span>连通测试</div>';
    html += '<div class="card-body">';
    html += badgeHtml(data.mode);
    html += badgeHtml(data.status);
    html += '<div class="provider-metric"><span class="provider-metric-label">HTTP 状态</span>' +
      '<span class="provider-metric-value">' + (data.httpStatus != null ? data.httpStatus : '—') + '</span></div>';
    html += '<div class="provider-metric"><span class="provider-metric-label">耗时</span>' +
      '<span class="provider-metric-value">' + data.durationMs + ' ms</span></div>';
    html += '<div class="provider-metric"><span class="provider-metric-label">有响应</span>' +
      '<span class="provider-metric-value">' + (data.hasChoices != null ? (data.hasChoices ? '是' : '否') : '—') + '</span></div>';
    html += '<div class="provider-metric"><span class="provider-metric-label">错误</span>' +
      '<span class="provider-metric-value">' + esc(data.errorKind || '无') + '</span></div>';
    html += '<div class="provider-summary">' + esc(displayText(data.safeSummary)) + '</div>';
    html += '</div>';
    drawerEl.innerHTML = html;
  }

  function renderProviderAgentDemo(data) {
    consoleHealthState.providerAgentDemo.error = false;
    consoleHealthState.providerAgentDemo.ok = isStatusOk(data.status);
    var drawerEl = document.getElementById("drawer-provider-agent-demo");
    if (!drawerEl) return;

    var html = '<div class="card-header"><span class="card-header-dot"></span>Agent 演示</div>';
    html += '<div class="card-body">';
    html += badgeHtml(data.mode);
    html += badgeHtml(data.status);
    html += '<div class="provider-metric"><span class="provider-metric-label">命令数</span>' +
      '<span class="provider-metric-value">' + (data.commandCount != null ? data.commandCount : '—') + '</span></div>';
    html += '<div class="provider-metric"><span class="provider-metric-label">Agent 状态</span>' +
      '<span class="provider-metric-value">' + esc(data.agentRunStatus || '—') + '</span></div>';
    html += '<div class="provider-metric"><span class="provider-metric-label">耗时</span>' +
      '<span class="provider-metric-value">' + data.durationMs + ' ms</span></div>';
    html += '<div class="provider-metric"><span class="provider-metric-label">重试次数</span>' +
      '<span class="provider-metric-value">' + (data.retryCount != null ? data.retryCount : '—') + '</span></div>';
    html += '<div class="provider-summary">' + esc(displayText(data.safeSummary)) + '</div>';
    html += '</div>';
    drawerEl.innerHTML = html;
  }

  // ── System Console Health State ─────────────────────────

  var consoleHealthState = {
    releaseGate: { ok: true, error: false },
    apiAudit: { ok: true, error: false },
    preApiFreeze: { ok: true, error: false },
    liveReadiness: { ok: true, error: false },
    providerReadiness: { ok: true, error: false },
    providerSmoke: { ok: true, error: false },
    providerAgentDemo: { ok: true, error: false },
  };

  function isStatusOk(status) {
    if (status == null) return true;
    var s = String(status).toLowerCase();
    return s === "pass" || s === "passed" || s === "ok" || s === "ready" ||
           s === "locked" || s === "disabled" || s === "readonly" || s === "dry_run";
  }

  function isStatusIssue(status) {
    if (status == null) return false;
    var s = String(status).toLowerCase();
    return s === "fail" || s === "failed" || s === "block" || s === "blocked" ||
           s === "warn" || s === "warning" || s === "needs_review" || s === "error";
  }

  function updateConsoleBadge() {
    var badge = document.getElementById("console-badge");
    if (!badge) return;

    var hasError = false;
    var hasIssue = false;
    var keys = Object.keys(consoleHealthState);
    for (var i = 0; i < keys.length; i++) {
      var state = consoleHealthState[keys[i]];
      if (state.error) { hasError = true; break; }
      if (!state.ok) hasIssue = true;
    }

    if (hasError) {
      badge.textContent = "加载异常";
      badge.className = "console-entry-badge badge-warn";
    } else if (hasIssue) {
      badge.textContent = "存在预警";
      badge.className = "console-entry-badge badge-warn";
    } else {
      badge.textContent = "全部正常";
      badge.className = "console-entry-badge badge-ok";
    }
  }

  function renderDrawerError(drawerId, title) {
    var el = document.getElementById(drawerId);
    if (!el) return;
    var html = '<div class="card-header"><span class="card-header-dot"></span>' + esc(title) + '</div>';
    html += '<div class="card-body">' + errorHtml() + '</div>';
    el.innerHTML = html;
  }

  // ── Drawer ────────────────────────────────────────────────

  var _prevFocusEl = null;

  function openDrawer() {
    var drawer = document.getElementById("console-drawer");
    var backdrop = document.getElementById("drawer-backdrop");
    if (!drawer || !backdrop) return;
    _prevFocusEl = document.activeElement;
    drawer.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(function () {
      drawer.classList.add("drawer-open");
      backdrop.classList.add("drawer-backdrop-visible");
      var firstFocusable = drawer.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])");
      if (firstFocusable) firstFocusable.focus();
    });
  }

  function closeDrawer() {
    var drawer = document.getElementById("console-drawer");
    var backdrop = document.getElementById("drawer-backdrop");
    if (!drawer || !backdrop) return;
    drawer.classList.remove("drawer-open");
    backdrop.classList.remove("drawer-backdrop-visible");
    setTimeout(function () {
      drawer.hidden = true;
      backdrop.hidden = true;
      if (_prevFocusEl && _prevFocusEl.focus) _prevFocusEl.focus();
      _prevFocusEl = null;
    }, 320);
  }

  function trapFocus(e) {
    var drawer = document.getElementById("console-drawer");
    if (!drawer || drawer.hidden) return;
    var focusables = drawer.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])");
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function mountDrawer() {
    var openBtn = document.getElementById("console-open-btn");
    if (openBtn) openBtn.addEventListener("click", openDrawer);

    var closeBtn = document.getElementById("drawer-close-btn");
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);

    var backdrop = document.getElementById("drawer-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawer();
      if (e.key === "Tab") trapFocus(e);
    });
  }

  // ── Intro overlay (轻量版 ≤ 1000ms) ────────────────────────

  function mountIntroOverlay() {
    var overlay = document.getElementById("intro-overlay");
    if (!overlay) return;

    var prefersReduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var alreadyShown = false;
    try { alreadyShown = sessionStorage.getItem("hireloop-intro-shown") === "1"; }
    catch (e) { alreadyShown = false; }

    if (prefersReduced || alreadyShown) {
      overlay.hidden = true;
      return;
    }

    var fill = overlay.querySelector(".intro-bar-fill");
    if (fill) {
      requestAnimationFrame(function () {
        fill.style.width = "100%";
      });
    }

    setTimeout(function () {
      overlay.setAttribute("data-state", "leave");
      try { sessionStorage.setItem("hireloop-intro-shown", "1"); } catch (e) { /* noop */ }
      setTimeout(function () { overlay.hidden = true; }, 360);
    }, 880);
  }

  // ── Live capsule (在线动态胶囊) ──────────────────────────

  function mountLiveCapsule(events) {
    var capsule = document.getElementById("live-capsule");
    if (!capsule) return;
    var safeEvents = (Array.isArray(events) ? events : [])
      .filter(function (e) { return e && e.safe_summary; })
      .slice(0, 6);
    if (!safeEvents.length) {
      capsule.hidden = true;
      return;
    }

    var textEl = capsule.querySelector(".live-capsule-text");
    var fillEl = capsule.querySelector(".live-capsule-progress-fill");
    if (!textEl || !fillEl) return;

    var prefersReduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function buildText(e) {
      var name = e.agent_name || "虚拟员工";
      var verb = EVENT_VERB_BY_TYPE[e.event_type] || "执行操作";
      return name + " · " + verb + " · " + e.safe_summary;
    }

    capsule.hidden = false;
    textEl.textContent = buildText(safeEvents[0]);

    if (prefersReduced) {
      fillEl.style.transition = "none";
      fillEl.style.width = "100%";
      return;
    }

    var idx = 0;
    var SLOT_MS = 2800;
    var TICK_MS = 80;

    function startSlot() {
      fillEl.style.transition = "none";
      fillEl.style.width = "0%";
      requestAnimationFrame(function () {
        fillEl.style.transition = "width " + (SLOT_MS - TICK_MS) + "ms linear";
        fillEl.style.width = "100%";
      });
      setTimeout(function () {
        idx = (idx + 1) % safeEvents.length;
        textEl.textContent = buildText(safeEvents[idx]);
        startSlot();
      }, SLOT_MS);
    }
    startSlot();
  }

  // ── Data source display ────────────────────────────────────

  function updateModePill(orgData) {
    var el = document.getElementById("mode-pill");
    if (!el) return;
    var ds = orgData && orgData.data_source;
    if (!ds) { el.textContent = "只读"; return; }
    if (ds.mode === "runtime_snapshot") {
      el.textContent = (ds.label || "运行快照") + " · 只读";
    } else {
      el.textContent = "演示模式 · 只读";
    }
  }

  function updateFooterMeta(orgData) {
    var el = document.getElementById("footer-meta");
    if (!el) return;
    var ds = orgData && orgData.data_source;
    var redactionLabel = (ds && ds.mode === "runtime_snapshot") ? "运行快照已脱敏" : "演示样本已脱敏";
    var suffix = " · 二〇二六";
    if (ds && ds.mode === "runtime_snapshot" && ds.generated_at) {
      suffix = " · 生成 " + formatDateTime(new Date(ds.generated_at)) + suffix;
    }
    el.textContent = "职链 HireLoop · " + redactionLabel + suffix;
  }

  function renderDataSource(orgData) {
    updateModePill(orgData);
    updateFooterMeta(orgData);
  }

  // ── Load all ──────────────────────────────────────────────

  var REPORT_DRAWER_MAP = {
    "release-gate-content": { healthKey: "releaseGate", drawerId: "drawer-release-gate", title: "交付检查" },
    "api-audit-content": { healthKey: "apiAudit", drawerId: "drawer-api-audit", title: "API 边界审计" },
    "pre-api-freeze-content": { healthKey: "preApiFreeze", drawerId: "drawer-pre-api-freeze", title: "架构冻结" },
    "live-readiness-content": { healthKey: "liveReadiness", drawerId: "drawer-live-readiness", title: "在线写入就绪" },
    "provider-readiness-content": { healthKey: "providerReadiness", drawerId: "drawer-provider-readiness", title: "就绪状态" },
    "provider-smoke-content": { healthKey: "providerSmoke", drawerId: "drawer-provider-smoke", title: "连通测试" },
    "provider-agent-demo-content": { healthKey: "providerAgentDemo", drawerId: "drawer-provider-agent-demo", title: "Agent 演示" },
  };

  function safeCatch(elementId) {
    return function () {
      var el = document.getElementById(elementId);
      if (el) el.innerHTML = errorHtml();

      var mapping = REPORT_DRAWER_MAP[elementId];
      if (mapping) {
        consoleHealthState[mapping.healthKey].error = true;
        consoleHealthState[mapping.healthKey].ok = false;
        renderDrawerError(mapping.drawerId, mapping.title);
        updateConsoleBadge();
      }
    };
  }

  // ── Live Feishu Data (Phase 6.7) ──────────────────────────

  function renderLiveBaseStatus(data) {
    var el = document.getElementById("live-base-status");
    if (!el) return;
    var hint = document.getElementById("live-data-hint");

    if (data && data.readEnabled && data.blockedReasons && data.blockedReasons.length === 0) {
      el.innerHTML =
        '<div class="live-status-ok">' +
        '<span class="live-status-icon ok">&#10003;</span>' +
        '<span class="live-status-text"><strong>飞书已连接</strong> &middot; 实时只读模式，所有写入已禁用</span>' +
        "</div>";
      if (hint) hint.textContent = "飞书 Base 实时数据 · 只读模式";
    } else {
      var reasons = (data && data.blockedReasons) ? data.blockedReasons : ["飞书连接未配置"];
      var reasonItems = reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("");
      el.innerHTML =
        '<div class="live-status-blocked">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
        '<span class="live-status-icon blocked">&#10007;</span>' +
        '<span class="live-status-text"><strong>飞书未连接</strong> &middot; 只读未启用</span>' +
        "</div>" +
        '<ul class="live-status-reasons">' + reasonItems + "</ul>" +
        "</div>";
      if (hint) hint.textContent = "请配置 LARK_APP_ID / LARK_APP_SECRET / BASE_APP_TOKEN 并设置 HIRELOOP_ALLOW_LARK_READ=1";
    }
  }

  function renderLiveRecords(containerId, records, title, colName, colMeta, colExtra) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!records || records.length === 0) {
      el.innerHTML = '<div class="live-card-empty">暂无数据</div>';
      return;
    }
    var head =
      '<div class="live-card-head">' +
      '<span class="live-card-head-title">' + esc(title) + "</span>" +
      '<span class="live-card-head-count">' + esc(String(records.length)) + "</span>" +
      "</div>";
    var rows = "";
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var name = esc(String(r[colName] || ""));
      var meta = (colMeta || []).map(function (k) {
        var v = r[k];
        if (v === null || v === undefined || v === "") return "";
        return '<span class="live-record-meta-item">' + esc(String(v)) + "</span>";
      }).filter(Boolean).join(" &middot; ");
      var extra = colExtra ? colExtra(r) : "";
      var btn = "";
      if (r.link && r.link.available && r.link.link_id) {
        btn =
          '<button type="button" class="live-open-btn" data-link-id="' +
          esc(String(r.link.link_id)) +
          '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> 打开飞书</button>';
      }
      rows +=
        '<div class="live-record-row">' +
        '<div class="live-record-info">' +
        '<span class="live-record-name">' + name + "</span>" +
        '<span class="live-record-meta">' + meta + extra + "</span>" +
        "</div>" +
        btn +
        "</div>";
    }
    el.innerHTML =
      '<div class="live-card-panel">' + head + '<div class="live-card-body">' + rows + "</div></div>";

    var buttons = el.querySelectorAll(".live-open-btn");
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", function (ev) {
        var linkId = ev.currentTarget.getAttribute("data-link-id");
        window._hireloopOpenFeishu(linkId);
      });
    }
  }

  function loadLiveData() {
    fetchJson("/api/live/base-status")
      .then(function (status) {
        renderLiveBaseStatus(status);
        if (status && status.readEnabled && status.blockedReasons && status.blockedReasons.length === 0) {
          Promise.all([
            fetchJson("/api/live/records?table=candidates"),
            fetchJson("/api/live/records?table=jobs"),
          ]).then(function (results) {
            var candData = results[0];
            var jobData = results[1];
            renderLiveRecords(
              "live-candidates",
              (candData && candData.records) || [],
              "候选人",
              "display_name",
              ["status", "job_display"],
              function (r) {
                var tags = "";
                if (r.resume_available) tags += '<span class="live-record-tag resume">有简历</span>';
                if (r.screening_recommendation) tags += '<span class="live-record-tag">' + esc(r.screening_recommendation) + "</span>";
                return tags;
              },
            );
            renderLiveRecords(
              "live-jobs",
              (jobData && jobData.records) || [],
              "岗位",
              "title",
              ["department", "level", "status", "owner"],
              null,
            );
          }).catch(function () {
            var grid = document.getElementById("live-grid");
            if (grid) grid.innerHTML = errorHtml();
          });
        } else {
          var grid = document.getElementById("live-grid");
          if (grid) grid.innerHTML =
            '<div class="live-card-empty" style="grid-column:1/-1">飞书连接未就绪，实时数据暂不可用</div>';
        }
      })
      .catch(function () {
        renderLiveBaseStatus(null);
        var grid = document.getElementById("live-grid");
        if (grid) grid.innerHTML =
          '<div class="live-card-empty" style="grid-column:1/-1">飞书连接未就绪，实时数据暂不可用</div>';
      });
  }

  // Expose open-feishu for onclick
  window._hireloopOpenFeishu = function (linkId) {
    if (!linkId) return;
    window.open("/go/" + encodeURIComponent(linkId), "_blank", "noopener");
  };

  function load() {
    mountIntroOverlay();
    mountDrawer();
    setHeaderTime();
    setInterval(setHeaderTime, 30000);

    // Live data fetch (fire-and-forget, non-blocking)
    loadLiveData();

    Promise.all([
      fetchJson("/api/org/overview"),
      fetchJson("/api/work-events"),
    ]).then(function (results) {
      var orgData = results[0];
      var eventsData = results[1];
      renderDataSource(orgData);
      renderHero(orgData, eventsData);
      renderOrgOverview(orgData, eventsData);
      renderWorkEvents(eventsData);
      mountLiveCapsule(eventsData);

      fetchJson("/api/demo/pipeline")
        .then(function (data) { renderPipeline(data, orgData); })
        .catch(safeCatch("pipeline-container"));
    }).catch(function () {
      var grid = document.getElementById("kpi-grid");
      if (grid) grid.innerHTML = errorHtml();
      var org = document.getElementById("org-overview-container");
      if (org) org.innerHTML = errorHtml();
      var ev = document.getElementById("work-events-container");
      if (ev) ev.innerHTML = errorHtml();
      var p = document.getElementById("pipeline-container");
      if (p) p.innerHTML = errorHtml();
    });

    fetchJson("/api/operator/tasks").then(renderOperatorTasks).catch(safeCatch("operator-tasks-container"));

    fetchJson("/api/reports/release-gate")
      .then(function (d) { renderReleaseGate(d); updateConsoleBadge(); })
      .catch(safeCatch("release-gate-content"));
    fetchJson("/api/reports/api-boundary-audit")
      .then(function (d) { renderApiAudit(d); updateConsoleBadge(); })
      .catch(safeCatch("api-audit-content"));
    fetchJson("/api/reports/pre-api-freeze")
      .then(function (d) { renderPreApiFreeze(d); updateConsoleBadge(); })
      .catch(safeCatch("pre-api-freeze-content"));
    fetchJson("/api/reports/live-readiness")
      .then(function (d) { renderLiveReadiness(d); updateConsoleBadge(); })
      .catch(safeCatch("live-readiness-content"));
    fetchJson("/api/reports/provider-readiness")
      .then(function (d) { renderProviderReadiness(d); updateConsoleBadge(); })
      .catch(safeCatch("provider-readiness-content"));
    fetchJson("/api/reports/provider-smoke")
      .then(function (d) { renderProviderSmoke(d); updateConsoleBadge(); })
      .catch(safeCatch("provider-smoke-content"));
    fetchJson("/api/reports/provider-agent-demo")
      .then(function (d) { renderProviderAgentDemo(d); updateConsoleBadge(); })
      .catch(safeCatch("provider-agent-demo-content"));
  }

  load();
})();
