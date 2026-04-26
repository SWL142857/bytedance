import {
  buildProviderAdapterReadiness,
  type ProviderAdapterConfig,
} from "../src/llm/provider-adapter.js";
import { DisabledProviderClient } from "../src/llm/disabled-provider-client.js";

const args = process.argv.slice(2);
const sampleDisabled = args.includes("--sample-disabled");
const sampleBlocked = args.includes("--sample-blocked");
const sampleReady = args.includes("--sample-ready");

function printHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

function getScenario(): ProviderAdapterConfig {
  if (sampleDisabled) {
    return {
      enabled: false,
      providerName: "volcengine-ark",
    };
  }

  if (sampleBlocked) {
    return {
      enabled: true,
      providerName: "volcengine-ark",
      endpoint: null,
      modelId: null,
      apiKey: null,
    };
  }

  if (sampleReady) {
    return {
      enabled: true,
      providerName: "volcengine-ark",
      endpoint: "https://provider.example.invalid/v1",
      modelId: "ep-demo-model-not-real",
      apiKey: "ark-demo-key-not-real",
    };
  }

  return {
    enabled: false,
    providerName: "volcengine-ark",
  };
}

function main(): void {
  const config = getScenario();
  const readiness = buildProviderAdapterReadiness(config);

  console.log("=== Provider Adapter Readiness ===");
  console.log("");
  printHeader("Status", readiness.status);
  printHeader("Provider Name", readiness.providerName);
  printHeader("Can Call External Model", readiness.canCallExternalModel);
  printHeader("Blocked Reasons", readiness.blockedReasons.length);
  for (const reason of readiness.blockedReasons) {
    console.log(`    - ${reason}`);
  }
  printHeader("Safe Summary", readiness.safeSummary);

  console.log("");
  console.log("--- Disabled Provider Client Check ---");
  const client = new DisabledProviderClient(config);
  printHeader("Client Readiness Status", client.readiness.status);
  printHeader("Client Can Call", client.readiness.canCallExternalModel);

  console.log("");
  console.log("Done.");
}

main();
