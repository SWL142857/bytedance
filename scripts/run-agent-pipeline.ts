import { DeterministicLlmClient } from "../src/llm/deterministic-client.js";
import { runCandidatePipeline } from "../src/orchestrator/candidate-pipeline.js";
import { loadCandidatePipelineInput } from "../src/runtime/agent-input.js";
import {
  buildRuntimeDashboardSnapshot,
  DEFAULT_RUNTIME_SNAPSHOT_PATH,
  writeRuntimeDashboardSnapshot,
} from "../src/server/runtime-dashboard.js";

interface CliOptions {
  inputFile?: string;
  inputJson?: string;
  snapshotPath?: string;
}

function parseArgs(args: string[]): CliOptions {
  return {
    inputFile: args.find((arg) => arg.startsWith("--input-file="))?.slice("--input-file=".length),
    inputJson: args.find((arg) => arg.startsWith("--input-json="))?.slice("--input-json=".length),
    snapshotPath: args.find((arg) => arg.startsWith("--snapshot-path="))?.slice("--snapshot-path=".length),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const input = loadCandidatePipelineInput({
    inputFile: options.inputFile,
    inputJson: options.inputJson,
  });

  const client = new DeterministicLlmClient();
  const result = await runCandidatePipeline(client, input);
  const snapshot = buildRuntimeDashboardSnapshot(result, {
    source: "deterministic",
    externalModelCalls: false,
  });
  const snapshotPath = options.snapshotPath || DEFAULT_RUNTIME_SNAPSHOT_PATH;
  writeRuntimeDashboardSnapshot(snapshot, snapshotPath);

  console.log(JSON.stringify({
    mode: "deterministic",
    status: result.completed ? "success" : "failed",
    finalStatus: result.finalStatus,
    completed: result.completed,
    failedAgent: result.failedAgent ?? null,
    agentRunCount: result.agentRuns.length,
    commandCount: result.commands.length,
    snapshotPath,
    safeSummary: result.completed
      ? `Candidate pipeline completed. Snapshot updated at ${snapshot.generated_at}.`
      : `Candidate pipeline stopped safely at ${result.failedAgent ?? "unknown_agent"}. Snapshot updated at ${snapshot.generated_at}.`,
  }, null, 2));
}

main().catch(() => {
  process.exitCode = 1;
  console.error(JSON.stringify({
    status: "failed",
    safeSummary: "Candidate pipeline runner failed before producing a safe result.",
  }));
});
