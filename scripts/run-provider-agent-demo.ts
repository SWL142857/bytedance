import { loadConfig } from "../src/config.js";
import {
  buildProviderAgentDemoPlan,
  runProviderAgentDemo,
  type ProviderAgentDemoOptions,
} from "../src/llm/provider-agent-demo-runner.js";
import { loadResumeParserInput } from "../src/runtime/agent-input.js";

interface CliOptions extends ProviderAgentDemoOptions {
  inputFile?: string;
  inputJson?: string;
}

function parseArgs(args: string[]): CliOptions {
  return {
    useProvider: args.includes("--use-provider"),
    execute: args.includes("--execute"),
    confirm: args.find((a) => a.startsWith("--confirm="))?.split("=")[1],
    inputFile: args.find((a) => a.startsWith("--input-file="))?.slice("--input-file=".length),
    inputJson: args.find((a) => a.startsWith("--input-json="))?.slice("--input-json=".length),
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
  const input = options.inputFile || options.inputJson
    ? loadResumeParserInput({
      inputFile: options.inputFile,
      inputJson: options.inputJson,
    })
    : null;

  if (!options.execute) {
    const plan = buildProviderAgentDemoPlan(providerConfig, options, input);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const result = await runProviderAgentDemo(providerConfig, options, undefined, input);
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
