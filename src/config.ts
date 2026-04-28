export interface HireLoopConfig {
  larkAppId: string | null;
  larkAppSecret: string | null;
  baseAppToken: string | null;
  feishuBaseWebUrl: string | null;
  feishuTableWebUrls?: Partial<Record<"candidates" | "jobs" | "work_events", string>>;
  modelApiKey: string | null;
  modelApiEndpoint: string | null;
  modelId: string | null;
  modelProvider: string;
  allowLarkRead: boolean;
  allowLarkWrite: boolean;
  debug: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HireLoopConfig {
  return {
    larkAppId: env.LARK_APP_ID ?? null,
    larkAppSecret: env.LARK_APP_SECRET ?? null,
    baseAppToken: env.BASE_APP_TOKEN ?? null,
    feishuBaseWebUrl: env.FEISHU_BASE_WEB_URL ?? env.LARK_BASE_WEB_URL ?? null,
    feishuTableWebUrls: {
      candidates: env.FEISHU_CANDIDATES_WEB_URL,
      jobs: env.FEISHU_JOBS_WEB_URL,
      work_events: env.FEISHU_WORK_EVENTS_WEB_URL,
    },
    modelApiKey: env.MODEL_API_KEY ?? null,
    modelApiEndpoint: env.MODEL_API_ENDPOINT ?? null,
    modelId: env.MODEL_ID ?? null,
    modelProvider: env.MODEL_PROVIDER ?? "volcengine-ark",
    allowLarkRead: env.HIRELOOP_ALLOW_LARK_READ === "1",
    allowLarkWrite: env.HIRELOOP_ALLOW_LARK_WRITE === "1",
    debug: env.DEBUG === "1" || env.DEBUG === "true",
  };
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

function validateLarkCredentials(config: HireLoopConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (!config.larkAppId) {
    errors.push({ field: "LARK_APP_ID", message: "LARK_APP_ID is required for execution" });
  }
  if (!config.larkAppSecret) {
    errors.push({ field: "LARK_APP_SECRET", message: "LARK_APP_SECRET is required for execution" });
  }
  if (!config.baseAppToken) {
    errors.push({ field: "BASE_APP_TOKEN", message: "BASE_APP_TOKEN is required for execution" });
  }

  return errors;
}

export function validateExecutionConfig(config: HireLoopConfig): ConfigValidationError[] {
  const errors = validateLarkCredentials(config);

  if (!config.allowLarkWrite) {
    errors.push({ field: "HIRELOOP_ALLOW_LARK_WRITE", message: "HIRELOOP_ALLOW_LARK_WRITE must be 1 for execution" });
  }

  return errors;
}

export function validateReadOnlyConfig(config: HireLoopConfig): ConfigValidationError[] {
  const errors = validateLarkCredentials(config);

  if (!config.allowLarkRead) {
    errors.push({ field: "HIRELOOP_ALLOW_LARK_READ", message: "HIRELOOP_ALLOW_LARK_READ must be 1 for read-only execution" });
  }

  return errors;
}

export interface RedactedConfig {
  larkAppId: string | null;
  larkAppSecret: string | null;
  baseAppToken: string | null;
  feishuBaseWebUrl: string | null;
  modelApiKey: string | null;
  modelApiEndpoint: string | null;
  modelId: string | null;
  modelProvider: string;
  allowLarkRead: boolean;
  allowLarkWrite: boolean;
  debug: boolean;
}

function redact(value: string | null): string | null {
  if (value === null) return null;
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "****" + value.slice(-2);
}

export function redactConfig(config: HireLoopConfig): RedactedConfig {
  return {
    larkAppId: redact(config.larkAppId),
    larkAppSecret: redact(config.larkAppSecret),
    baseAppToken: redact(config.baseAppToken),
    feishuBaseWebUrl: config.feishuBaseWebUrl ? "configured" : null,
    modelApiKey: redact(config.modelApiKey),
    modelApiEndpoint: redact(config.modelApiEndpoint),
    modelId: redact(config.modelId),
    modelProvider: config.modelProvider,
    allowLarkRead: config.allowLarkRead,
    allowLarkWrite: config.allowLarkWrite,
    debug: config.debug,
  };
}
