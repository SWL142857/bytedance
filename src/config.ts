export interface HireLoopConfig {
  larkAppId: string | null;
  larkAppSecret: string | null;
  baseAppToken: string | null;
  modelApiKey: string | null;
  modelApiEndpoint: string | null;
  modelId: string | null;
  modelProvider: string;
  allowLarkWrite: boolean;
  debug: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HireLoopConfig {
  return {
    larkAppId: env.LARK_APP_ID ?? null,
    larkAppSecret: env.LARK_APP_SECRET ?? null,
    baseAppToken: env.BASE_APP_TOKEN ?? null,
    modelApiKey: env.MODEL_API_KEY ?? null,
    modelApiEndpoint: env.MODEL_API_ENDPOINT ?? null,
    modelId: env.MODEL_ID ?? null,
    modelProvider: env.MODEL_PROVIDER ?? "volcengine-ark",
    allowLarkWrite: env.HIRELOOP_ALLOW_LARK_WRITE === "1",
    debug: env.DEBUG === "1" || env.DEBUG === "true",
  };
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

export function validateExecutionConfig(config: HireLoopConfig): ConfigValidationError[] {
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
  if (!config.allowLarkWrite) {
    errors.push({ field: "HIRELOOP_ALLOW_LARK_WRITE", message: "HIRELOOP_ALLOW_LARK_WRITE must be 1 for execution" });
  }

  return errors;
}

export interface RedactedConfig {
  larkAppId: string | null;
  larkAppSecret: string | null;
  baseAppToken: string | null;
  modelApiKey: string | null;
  modelApiEndpoint: string | null;
  modelId: string | null;
  modelProvider: string;
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
    modelApiKey: redact(config.modelApiKey),
    modelApiEndpoint: redact(config.modelApiEndpoint),
    modelId: redact(config.modelId),
    modelProvider: config.modelProvider,
    allowLarkWrite: config.allowLarkWrite,
    debug: config.debug,
  };
}
