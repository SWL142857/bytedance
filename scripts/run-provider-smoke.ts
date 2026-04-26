import {
  buildProviderSmokePlan,
  runProviderConnectivitySmoke,
  type ProviderSmokeOptions,
} from "../src/llm/provider-smoke-runner.js";
import { loadConfig } from "../src/config.js";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const confirmation = args
  .find((arg) => arg.startsWith("--confirm="))
  ?.slice("--confirm=".length);

function printHeader(label: string, value: string | number | boolean | null): void {
  console.log(`  ${label}: ${value}`);
}

function getProviderConfig() {
  const envConfig = loadConfig();
  return {
    enabled: true,
    providerName: envConfig.modelApiEndpoint
      ? "volcengine-ark"
      : "volcengine-ark",
    endpoint: envConfig.modelApiEndpoint ?? null,
    modelId: envConfig.modelApiEndpoint ? (process.env.MODEL_ID ?? null) : null,
    apiKey: envConfig.modelApiKey ?? null,
  };
}

async function main(): Promise<void> {
  console.log("=== Provider Connectivity Smoke ===");
  console.log("");

  const config = getProviderConfig();
  const options: ProviderSmokeOptions = {
    execute,
    confirm: confirmation,
  };

  if (!execute) {
    const result = buildProviderSmokePlan(config, options);

    printHeader("Mode", result.mode);
    printHeader("Status", result.status);
    printHeader("Provider", result.providerName);
    printHeader("Can Call External Model", result.canCallExternalModel);
    printHeader("HTTP Status", result.httpStatus ?? "null");
    printHeader("Has Choices", result.hasChoices ?? "null");
    printHeader("Content Length", result.contentLength ?? "null");
    printHeader("Duration Ms", result.durationMs);
    printHeader("Blocked Reasons", result.blockedReasons.length);
    for (const reason of result.blockedReasons) {
      console.log(`    - ${reason}`);
    }
    printHeader("Error Kind", result.errorKind ?? "null");
    printHeader("Safe Summary", result.safeSummary);

    console.log("");
    console.log("Dry-run only. To test real connectivity, set the local provider endpoint, model ID, and API key, then run:");
    console.log("  pnpm mvp:provider-smoke:execute");
    console.log("");
    console.log("Done.");
    return;
  }

  const result = await runProviderConnectivitySmoke(config, options);

  printHeader("Mode", result.mode);
  printHeader("Status", result.status);
  printHeader("Provider", result.providerName);
  printHeader("Can Call External Model", result.canCallExternalModel);
  printHeader("HTTP Status", result.httpStatus ?? "null");
  printHeader("Has Choices", result.hasChoices ?? "null");
  printHeader("Content Length", result.contentLength ?? "null");
  printHeader("Duration Ms", result.durationMs);
  printHeader("Blocked Reasons", result.blockedReasons.length);
  for (const reason of result.blockedReasons) {
    console.log(`    - ${reason}`);
  }
  printHeader("Error Kind", result.errorKind ?? "null");
  printHeader("Safe Summary", result.safeSummary);

  console.log("");
  console.log("Done.");
}

main().catch(() => {
  console.error("Error: Provider smoke runner failed before producing a safe result.");
  process.exitCode = 1;
});
