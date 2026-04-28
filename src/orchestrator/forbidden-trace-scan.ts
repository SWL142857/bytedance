import { readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, relative, extname, join, basename } from "node:path";

// ── Types ──

export type ForbiddenTraceCategory = "secret_marker" | "unsafe_raw_field" | "unsafe_output_token";

export interface ForbiddenTraceRule {
  ruleId: string;
  category: ForbiddenTraceCategory;
  pattern: RegExp;
  safeSummary: string;
  /** Post-filter: return true to skip this match (false positive). */
  skipIf?: (line: string) => boolean;
}

export interface ForbiddenTraceFinding {
  file: string;
  category: ForbiddenTraceCategory;
  line: number;
  ruleId: string;
  safeSummary: string;
}

export interface ForbiddenTraceScanReport {
  status: "pass" | "blocked";
  findingCount: number;
  categories: Record<ForbiddenTraceCategory, number>;
  files: string[];
  findings: ForbiddenTraceFinding[];
}

export interface ForbiddenTraceScanOptions {
  rootDir?: string;
  include?: string[];
  exclude?: string[];
}

// ── Helpers ──

const PLACEHOLDER_RE = /^(?:your[_-]|test[-_]|dummy[-_]|fake[-_]|placeholder|xxx|changeme|example|<\w+>|['"]?\s*['"]?\s*$)/i;

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_RE.test(value) || value.length < 4;
}

function extractEnvValue(line: string, keyName: string): string | null {
  // Match KEY=value or KEY='value' or KEY="value"
  const re = new RegExp(
    `${keyName}\\s*=\\s*(?:['"\`])?([^'\\s"\`<>]+)(?:['"\`])?`,
    "i",
  );
  const m = line.match(re);
  return m ? (m[1] ?? "") : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isEscaped(line: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function isPositionInsideStringLiteral(line: string, targetIndex: number): boolean {
  let quote: "'" | "\"" | "`" | null = null;
  let templateExpressionDepth = 0;

  for (let i = 0; i < targetIndex; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (quote) {
      if (isEscaped(line, i)) continue;
      if (quote === "`" && ch === "$" && next === "{") {
        quote = null;
        templateExpressionDepth = 1;
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (templateExpressionDepth > 0) {
      if (ch === "'" || ch === "\"" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") {
        templateExpressionDepth++;
      } else if (ch === "}") {
        templateExpressionDepth--;
        if (templateExpressionDepth === 0) {
          quote = "`";
        }
      }
      continue;
    }

    if (ch === "'" || ch === "\"" || ch === "`") {
      quote = ch;
    }
  }

  return quote !== null;
}

function hasWordOutsideStringLiteral(line: string, word: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (!isPositionInsideStringLiteral(line, m.index)) return true;
  }
  return false;
}

/** Returns true only when every occurrence of `word` is inside a string literal. */
function isOnlyInsideStringLiteral(line: string, word: string): boolean {
  return !hasWordOutsideStringLiteral(line, word);
}

/** Returns true if a KEY=VALUE pattern has the KEY itself inside a string literal (test fixture). */
function isKeyInsideStringLiteral(line: string, key: string): boolean {
  return !hasWordOutsideStringLiteral(line, key);
}

/** Returns true if the sk- value looks obviously fake (contains common dictionary words). */
function isFakeSkValue(line: string): boolean {
  const m = line.match(/(?<![a-zA-Z0-9_-])(sk-[a-zA-Z0-9_-]{20,})(?![a-zA-Z0-9_-])/);
  if (m && m[1]) {
    const key = m[1];
    if (/\b(secret|super|test|dummy|fake|example|placeholder|changeme|xxx|hello|world|demo)\b/i.test(key)) return true;
  }
  // Skip lines that are clearly test assertions about redaction
  if (/\bassert\b.*\b(sk-|key|apiKey|secret)\b/i.test(line)) return true;
  return false;
}

// ── Rules ──

const RULES: ForbiddenTraceRule[] = [
  // ── secret_marker ──

  {
    ruleId: "secret_model_api_key",
    category: "secret_marker",
    pattern: /\bMODEL_API_KEY\s*=\s*['"`]?\S/i,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => {
      if (isKeyInsideStringLiteral(line, "MODEL_API_KEY")) return true;
      const v = extractEnvValue(line, "MODEL_API_KEY");
      if (v === null) return true;
      return isPlaceholderValue(v);
    },
  },
  {
    ruleId: "secret_lark_app_secret",
    category: "secret_marker",
    pattern: /\bLARK_APP_SECRET\s*=\s*['"`]?\S/i,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => {
      if (isKeyInsideStringLiteral(line, "LARK_APP_SECRET")) return true;
      const v = extractEnvValue(line, "LARK_APP_SECRET");
      if (v === null) return true;
      return isPlaceholderValue(v);
    },
  },
  {
    ruleId: "secret_base_app_token",
    category: "secret_marker",
    pattern: /\bBASE_APP_TOKEN\s*=\s*['"`]?\S/i,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => {
      if (isKeyInsideStringLiteral(line, "BASE_APP_TOKEN")) return true;
      const v = extractEnvValue(line, "BASE_APP_TOKEN");
      if (v === null) return true;
      return isPlaceholderValue(v);
    },
  },
  {
    ruleId: "secret_bearer_auth",
    category: "secret_marker",
    pattern: /Authorization\s*:\s*Bearer\s+\S+/i,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => {
      const m = line.match(/Authorization\s*:\s*Bearer\s+(\S+)/i);
      if (!m || !m[1]) return true;
      const token = m[1].replace(/['"`,;.]+$/, "");
      return isPlaceholderValue(token) || token.length < 8;
    },
  },
  {
    ruleId: "secret_sk_prefix",
    category: "secret_marker",
    pattern: /(?<![a-zA-Z0-9_-])sk-[a-zA-Z0-9_-]{20,}(?![a-zA-Z0-9_-])/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => {
      if (isFakeSkValue(line)) return true;
      return false;
    },
  },

  // ── unsafe_raw_field: only in output / logging contexts ──

  {
    ruleId: "unsafe_raw_prompt_output",
    category: "unsafe_raw_field",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\braw_prompt\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "raw_prompt"),
  },
  {
    ruleId: "unsafe_raw_response_output",
    category: "unsafe_raw_field",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\braw_response\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "raw_response"),
  },
  {
    ruleId: "unsafe_raw_stdout_output",
    category: "unsafe_raw_field",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\braw_stdout\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "raw_stdout"),
  },
  {
    ruleId: "unsafe_raw_stderr_output",
    category: "unsafe_raw_field",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\braw_stderr\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "raw_stderr"),
  },
  {
    ruleId: "unsafe_resume_text_output",
    category: "unsafe_raw_field",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\bresumeText\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "resumeText"),
  },
  {
    ruleId: "unsafe_payload_output",
    category: "unsafe_raw_field",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\bpayload\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "payload"),
  },
  {
    ruleId: "unsafe_json_stringify_raw",
    category: "unsafe_raw_field",
    pattern: /JSON\.stringify\s*\(\s*(?:[a-zA-Z_]\w*\.)?\s*(?:raw_prompt|raw_response|raw_stdout|raw_stderr)\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
  },

  // ── unsafe_output_token: only in output / logging contexts ──

  {
    ruleId: "unsafe_output_endpoint",
    category: "unsafe_output_token",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\bendpoint\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "endpoint"),
  },
  {
    ruleId: "unsafe_output_model_id",
    category: "unsafe_output_token",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\bmodelId\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "modelId"),
  },
  {
    ruleId: "unsafe_output_api_key",
    category: "unsafe_output_token",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\([^)]{0,200}\bapiKey\b/,
    safeSummary: "Forbidden trace pattern detected in source text.",
    skipIf: (line: string) => isOnlyInsideStringLiteral(line, "apiKey"),
  },
];

const DEFAULT_INCLUDE = ["README.md", "src", "scripts", "tests", "package.json"];
const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", "tmp", "coverage"];
const ALLOWED_EXTENSIONS = new Set([".ts", ".js", ".json", ".md", ".html", ".css"]);

const ALLOWLIST_PATH_SEGMENTS = [
  "forbidden-trace-scan.test.ts",
];

// ── Scanner ──

function isAllowedExtension(filePath: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isAllowlisted(filePath: string): boolean {
  return ALLOWLIST_PATH_SEGMENTS.some((seg) => filePath.includes(seg));
}

function shouldExcludeDir(dirName: string): boolean {
  return DEFAULT_EXCLUDE.includes(dirName) || dirName.startsWith(".");
}

function collectFiles(
  dir: string,
  rootDir: string,
  includeSet: Set<string>,
  excludeSet: Set<string>,
): string[] {
  const files: string[] = [];
  const relDir = relative(rootDir, dir) || ".";

  if (excludeSet.has(relDir) || excludeSet.has(basename(dir))) return files;
  if (basename(dir).startsWith(".") && relDir !== ".") return files;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }

    const relPath = relative(rootDir, fullPath);

    if (st.isDirectory()) {
      if (shouldExcludeDir(entry)) continue;
      if (relPath !== "." && excludeSet.has(relPath)) continue;
      files.push(...collectFiles(fullPath, rootDir, includeSet, excludeSet));
    } else if (st.isFile()) {
      if (!isAllowedExtension(fullPath) && !includeSet.has(relPath)) continue;
      if (excludeSet.has(relPath)) continue;
      files.push(fullPath);
    }
  }

  return files;
}

export function runForbiddenTraceScan(
  options: ForbiddenTraceScanOptions = {},
): ForbiddenTraceScanReport {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? [];

  const includeSet = new Set(include);
  const excludeSet = new Set(exclude);

  let scanFiles: string[] = [];
  for (const entry of include) {
    const fullPath = resolve(rootDir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }

    if (st.isFile()) {
      if (isAllowedExtension(fullPath) || includeSet.has(entry)) {
        scanFiles.push(fullPath);
      }
    } else if (st.isDirectory()) {
      scanFiles.push(...collectFiles(fullPath, rootDir, includeSet, excludeSet));
    }
  }

  scanFiles = [...new Set(scanFiles)];

  const findings: ForbiddenTraceFinding[] = [];

  for (const filePath of scanFiles) {
    const relPath = relative(rootDir, filePath);

    if (isAllowlisted(relPath)) continue;
    if (excludeSet.has(relPath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;

      let lineNum = 0;
      for (const line of lines) {
        lineNum++;
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(line)) continue;
        if (rule.skipIf && rule.skipIf(line)) continue;

        findings.push({
          file: relPath,
          category: rule.category,
          line: lineNum,
          ruleId: rule.ruleId,
          safeSummary: rule.safeSummary,
        });
      }
    }
  }

  const categoryCounts: Record<ForbiddenTraceCategory, number> = {
    secret_marker: 0,
    unsafe_raw_field: 0,
    unsafe_output_token: 0,
  };

  const fileSet = new Set<string>();
  for (const f of findings) {
    categoryCounts[f.category]++;
    fileSet.add(f.file);
  }

  const files = [...fileSet].sort();

  return {
    status: findings.length === 0 ? "pass" : "blocked",
    findingCount: findings.length,
    categories: categoryCounts,
    files,
    findings,
  };
}
