import { loadConfig } from "../src/config.js";
import {
  buildProviderAgentDemoPlan,
  runProviderAgentDemo,
  type ProviderAgentDemoOptions,
} from "../src/llm/provider-agent-demo-runner.js";

function parseArgs(args: string[]): ProviderAgentDemoOptions {
  return {
    useProvider: args.includes("--use-provider"),
    execute: args.includes("--execute"),
    confirm: args.find((a) => a.startsWith("--confirm="))?.split("=")[1],
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  const providerConfig = {
    enabled: true,
    providerName: config.modelProvider,
    endpoint: config.modelApiEndpoint,
    modelId: config.modelId,
    apiKey: config.modelApiKey,
  };

  if (!options.execute) {
    const plan = buildProviderAgentDemoPlan(providerConfig, options);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const result = await runProviderAgentDemo(providerConfig, options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  process.exitCode = 1;
  console.error(
    JSON.stringify({
      mode: "execute",
      status: "failed",
      safeSummary: "Provider agent demo failed before producing a safe result.",
    }),
  );
  void err;
});
