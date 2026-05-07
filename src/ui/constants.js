export const STATE_FLOW = [
  "new",
  "parsed",
  "screened",
  "interview_kit_ready",
  "decision_pending",
];

export const STATE_LABELS = {
  new: "新增",
  parsed: "已解析",
  screened: "已筛选",
  interview_kit_ready: "面试就绪",
  decision_pending: "待决策",
  offer: "录用",
  rejected: "淘汰",
};

export const STATUS_ICONS = {
  pass: "✓",
  locked: "✓",
  fail: "✗",
  block: "✗",
  blocked: "✗",
  warn: "!",
  needs_review: "!",
};

export const STATUS_LABELS_DISPLAY = {
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

export const TEXT_LABELS_DISPLAY = {
  Typecheck: "类型检查",
  "Test Suite": "测试套件",
  Tests: "测试",
  Build: "构建",
  "Local MVP Demo": "本地运行快照",
  "Live Ready Demo": "在线就绪预演",
  "Live Operator Runbook": "在线操作员手册",
  "Guarded Execute Block": "执行守卫阻断",
  "Forbidden Trace Scan": "禁用痕迹扫描",
  "API Boundary Audit": "API 边界审计",
  "Deterministic Demo": "确定性安全预演",
  "Provider Smoke Guard": "供应商连通守卫",
  "Provider Agent Demo Guard": "供应商 Agent 预览守卫",
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
  "Provider agent demo runner is guarded (blocks without --use-provider + execute + confirm).": "供应商 Agent 预览已受守卫保护，缺少供应商开关、执行标记或确认时会阻断。",
  "Base write guard is independent and not relaxed.": "Base 写入守卫保持独立，未被放松。",
  "All demo outputs pass safety redaction checks.": "所有预演输出均通过安全脱敏检查。",
  "No configured provider values found in tracked artifacts.": "未在受跟踪产物中发现已配置的供应商敏感值。",
  "Release gate report is consistent with API boundary audit.": "交付门禁报告与 API 边界审计一致。",
  "Agent output schemas are locked. No schema changes allowed without re-freeze.": "Agent 输出结构已锁定；未经重新冻结不得修改。",
  "Candidate status flow is locked. No state transitions can be added or modified.": "候选人状态流已锁定；不得新增或修改状态推进。",
  "Base write guards are locked. Guarded runner conditions cannot be relaxed.": "Base 写入守卫已锁定；不得放松守卫条件。",
  "Redaction policy is locked. No raw output leaking allowed.": "脱敏策略已锁定；不得泄露原始输出。",
  "Deterministic demo not passing. Verify local demo before API integration.": "确定性预演尚未通过；接入 API 前需先验证本地预演。",
  "Release gate not passing. Clear all release gate blocks first.": "交付门禁尚未通过；需先清除所有阻断项。",
  "LLM adapter boundary not defined. Define adapter interface before API integration.": "模型适配器边界尚未定义；接入 API 前需先定义适配接口。",
  "Config is complete for live execution.": "在线执行所需配置完整。",
  "Read-only resolution is blocked. Fix config or Base access.": "只读记录解析被阻断；需修复配置或 Base 访问权限。",
  "Resolved 0 of 2 required records.": "必需记录已解析 0 / 2 条。",
  "Write plan generated 0 commands.": "写入计划生成 0 条命令。",
  "No commands to validate.": "暂无可验证命令。",
  "Provider adapter is not enabled.": "模型供应商适配器未启用。",
  'Provider "volcengine-ark" is disabled. No external model calls will be made.': "模型供应商 volcengine-ark 未启用，不会发起外部模型调用。",
  'Dry-run only. Provider "volcengine-ark" connectivity test is planned but not executed.': "仅干跑：模型供应商 volcengine-ark 连通测试已规划，但不会执行。",
  'Dry-run only. Provider "volcengine-ark" agent demo is planned but not executed.': "仅干跑：模型供应商 volcengine-ark Agent 预览已规划，但不会执行。",
  "Not ready. Fix: Resolution, Records, Write Plan, Write Commands. Then re-run readiness check.": "尚未就绪。请修复记录解析、记录、写入计划与写入命令后重新检查。",
  "Real writes require explicit human authorization via the guarded runner. On failure, review the execution audit, recovery plan, and verification report before deciding on targeted compensation or retry. Do NOT blindly re-run the full pipeline.": "真实写入必须通过受守卫保护的执行器，并取得明确人工授权。若执行失败，需先查看执行审计、恢复方案与验证报告，再决定定向补偿或重试；不得盲目重跑完整流水线。",
  "API boundary is audited. Default behavior: no external model calls, no real Base writes. Provider integration is guarded and opt-in only. Do not relax guards or bypass schema validation.": "API 边界已审计。默认行为为不调用外部模型、不执行真实 Base 写入；供应商接入受守卫保护且必须显式开启。不得放松守卫或绕过结构校验。",
  "Architecture is frozen before API integration. API work is restricted to provider adapter, config validation, error mapping, and schema retry wiring. Default behavior must remain: no external model calls, no real Base writes, no schema bypass. Any change to state machine, write guards, redaction, or output schemas requires re-freeze review.": "API 接入前架构已冻结。后续 API 工作仅限供应商适配、配置校验、错误映射与结构重试接线。默认行为必须保持：不调用外部模型、不执行真实 Base 写入、不绕过结构校验。任何状态机、写入守卫、脱敏或输出结构变更都必须重新冻结评审。",
  "add disabled-by-default provider adapter": "新增默认关闭的供应商适配器",
  "add provider config validation": "新增供应商配置校验",
  "add provider error mapping": "新增供应商错误映射",
  "add schema retry wiring behind existing output contracts": "在现有输出契约后接入结构重试",
  "changing candidate status flow": "修改候选人状态流",
  "relaxing guarded live write conditions": "放松后端写入守卫条件",
  "writing raw prompts, resumes, or credentials to output": "向输出写入原始提示词、简历或凭据",
  "bypassing schema validation": "绕过结构校验",
  "enabling external model calls by default": "默认启用外部模型调用",
  sample: "预演样本",
};

export const UI_MESSAGES = {
  SOURCE_FEISHU_LIVE: "来自飞书 Base 实时只读数据",
  SOURCE_SNAPSHOT: "本地运行快照",
  SOURCE_DETERMINISTIC: "确定性安全预演",
  BOUNDARY_NO_AUTO_HIRE: "不自动录用/淘汰，不自动写飞书，真实写入必须人工确认。",
  RAG_SAMPLE_NOTE: "Competition Graph RAG 能力样例（非主业务事实源）",
  CARD_AUDIT_NOTE: "审计/状态卡，非执行入口",
};

export const EVENT_TYPE_LABELS = {
  tool_call: "工具调用",
  status_transition: "状态推进",
  guard_check: "守卫检查",
  retry: "重试",
  error: "错误",
  human_action: "人工操作",
  blocked: "写入被安全拦截",
};

export const EXECUTION_MODE_LABELS = {
  dry_run: "干跑",
  live_read: "在线只读",
  live_write: "后端写入审计",
  blocked: "写入被安全拦截",
};

export const SAFE_ERROR_MSG = "信息不可用，请稍后重试";

export const GUARD_STATUS_LABELS = {
  passed: "已通过",
  blocked: "写入被安全拦截",
  skipped: "已跳过",
};

export const TOOL_TYPE_LABELS = {
  record_list: "读取记录",
  record_upsert: "记录变更计划",
  table_create: "建表",
  llm_call: "模型调用",
};

export const TARGET_TABLE_LABELS = {
  candidates: "候选人",
  jobs: "岗位",
  resume_facts: "简历要点",
  evaluations: "评估",
  interview_kits: "面试包",
  agent_runs: "运行日志",
  reports: "报告",
  work_events: "工作事件",
};

export const EVENT_VERB_BY_TYPE = {
  tool_call: "调用工具",
  status_transition: "推进候选人状态",
  guard_check: "执行守卫检查",
  retry: "触发重试",
  error: "记录错误",
  human_action: "完成人工操作",
  blocked: "写入被安全拦截",
};

export const AVATAR_CLASS_BY_AGENT = {
  "HR 协调": "avatar-hr",
  "简历录入": "avatar-resume",
  "信息抽取": "avatar-resume",
  "图谱构建": "avatar-screening",
  "图谱复核": "avatar-interview",
  "面试准备": "avatar-interview",
  "数据分析": "avatar-analytics",
};

export const AGENT_DESCRIPTIONS = {
  "HR 协调": "流程协调 · 任务分配 · 状态跟进",
  "简历录入": "简历原样打包 · 不做分析 · 确定性执行",
  "信息抽取": "LLM 结构化抽取 · 技能 / 特征 / 画像 · 含置信度",
  "图谱构建": "候选人相似边计算 · 图邻居链接 · 信号共享",
  "图谱复核": "融合 6 种图谱信号 · 综合决策 · 可解释推荐",
  "面试准备": "生成面试题与评分表",
  "数据分析": "漏斗与阻塞点分析 · 周报",
};

export const AVATAR_INITIALS = {
  "HR 协调": "HR",
  "简历录入": "录",
  "信息抽取": "抽",
  "图谱构建": "图",
  "图谱复核": "核",
  "面试准备": "面",
  "数据分析": "析",
};

export const TASK_CATEGORY_LABELS = {
  dry_run: "演练",
  readiness: "就绪检查",
  report: "分析报告",
};

export const AVAILABILITY_LABELS = {
  available_readonly: "只读可查看",
  disabled_phase_pending: "即将开放",
  disabled_requires_human_approval: "需人工授权",
};

export const ICON_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 19c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M21.5 17.5c0-2.4-2-4-4.5-4"/></svg>';
export const ICON_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>';
export const ICON_BOLT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/></svg>';
export const ICON_PULSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>';
export const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.5 7.8 8 9 4.5-1.2 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>';
export const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/></svg>';
export const ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
export const ICON_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 21h18"/><path d="M6 17V9"/><path d="M11 17V5"/><path d="M16 17v-7"/></svg>';
export const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
export const ICON_ACTIVITY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
export const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
export const ICON_DATABASE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';

// ── Pipeline Spine (8 stages, design contract) ──

export const PIPELINE_STAGE_ORDER = [
  "new",
  "Intake",
  "Extraction",
  "Graph Builder",
  "Interview Kit",
  "Reviewer",
  "HR Coordinator",
  "decision_pending",
  "Analytics",
];

// Two-row layout: 4 + 5. The final Analytics node is a post-decision
// continuous-improvement employee, not an automatic hire/reject action.
export const PIPELINE_ROW1 = ["new", "Intake", "Extraction", "Graph Builder"];
export const PIPELINE_ROW2 = ["Interview Kit", "Reviewer", "HR Coordinator", "decision_pending", "Analytics"];

// Old role names that must NOT appear in UI
export const RETIRED_AGENT_NAMES = ["简历解析", "初筛评估", "resume_parser", "screening"];

export const PIPELINE_STAGE_LABELS = {
  "new": "来自飞书",
  "Intake": "简历录入",
  "Extraction": "信息抽取",
  "Graph Builder": "图谱构建",
  "Interview Kit": "面试准备",
  "Reviewer": "图谱复核",
  "HR Coordinator": "HR 协调",
  "decision_pending": "待人工决策",
  "Analytics": "数据分析",
};

export const PIPELINE_STAGE_DESCRIPTIONS = {
  "new": "Feishu Base 实时只读候选人入口",
  "Intake": "简历原样打包 · 确定性执行",
  "Extraction": "LLM 结构化抽取 · 技能/经验/画像",
  "Graph Builder": "Candidate similarity edges · graph neighbor linking",
  "Interview Kit": "生成面试题与评分表",
  "Reviewer": "融合图谱信号 · 可解释推荐",
  "HR Coordinator": "流程协调 · 任务分配 · 状态跟进",
  "decision_pending": "需人类操作员确认最终决策",
  "Analytics": "漏斗统计 · 周报 · 阻塞点持续优化",
};

// ── 7 Agent Employees (static display metadata only) ──

export const AGENT_NODES = [
  {
    id: "resume_intake",
    name: "简历录入",
    role: "简历原样打包 · 不做分析 · 确定性执行",
    targetTable: "candidates",
    mode: "确定性安全预演",
    avatarInitial: "录",
    colorVar: "--accent-purple",
  },
  {
    id: "resume_extraction",
    name: "信息抽取",
    role: "LLM 结构化抽取 · 技能 / 特征 / 画像",
    targetTable: "resume_facts",
    mode: "本地运行快照",
    avatarInitial: "抽",
    colorVar: "--accent-purple",
  },
  {
    id: "graph_builder",
    name: "图谱构建",
    role: "候选人相似边计算 · 图邻居链接 · 信号共享",
    targetTable: "candidates",
    mode: "本地运行快照",
    avatarInitial: "图",
    colorVar: "--accent-cyan",
    isGraphRag: true,
  },
  {
    id: "interview_kit",
    name: "面试准备",
    role: "生成面试问题、评分表、关注点",
    targetTable: "interview_kits",
    mode: "本地运行快照",
    avatarInitial: "面",
    colorVar: "--accent-orange",
  },
  {
    id: "screening_reviewer",
    name: "图谱复核",
    role: "融合 6 种图谱信号 · 综合决策 · 可解释推荐",
    targetTable: "evaluations",
    mode: "本地运行快照",
    avatarInitial: "核",
    colorVar: "--accent-cyan",
    isGraphRag: true,
  },
  {
    id: "hr_coordinator",
    name: "HR 协调",
    role: "流程协调 · 任务分配 · 状态跟进",
    targetTable: "work_events",
    mode: "本地运行快照",
    avatarInitial: "HR",
    colorVar: "--accent-blue",
  },
  {
    id: "analytics",
    name: "数据分析",
    role: "漏斗统计 · 周报 · 阻塞点分析",
    targetTable: "reports",
    mode: "本地运行快照",
    avatarInitial: "析",
    colorVar: "--accent-green",
  },
];

// Map agent id → pipeline stage
export const AGENT_TO_PIPELINE_STAGE = {
  "resume_intake": "Intake",
  "resume_extraction": "Extraction",
  "graph_builder": "Graph Builder",
  "interview_kit": "Interview Kit",
  "screening_reviewer": "Reviewer",
  "hr_coordinator": "HR Coordinator",
  "analytics": "Analytics",
};
