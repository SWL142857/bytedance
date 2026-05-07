import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(): boolean {
  if (process.env.HIRELOOP_SKIP_ENV_LOCAL === "1") return false;

  const repoRoot = resolve(import.meta.dirname, "..");
  const envPaths = [
    resolve(repoRoot, ".env.local"),
    resolve(repoRoot, ".env"),
  ];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
      return true;
    }
  }

  return false;
}
