import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildCompetitionRagEnvelope } from "../src/runtime/competition-rag-adapter.js";
import { loadAgentInputBundles } from "../src/runtime/bundle-loader.js";
import { verifyBundles } from "../src/runtime/rag-dataset-verification.js";

interface CliOptions {
  competitionRoot: string;
  outputFile: string;
  limit?: number;
  maxFeaturesPerCandidate?: number;
  maxNeighborsPerCandidate?: number;
}

function parseArgs(args: string[]): CliOptions {
  const competitionRoot = args.find((arg) => arg.startsWith("--competition-root="))
    ?.slice("--competition-root=".length) ?? "competition ";
  const outputFile = args.find((arg) => arg.startsWith("--output-file="))
    ?.slice("--output-file=".length) ?? "tmp/competition-rag-bundles.json";
  const limit = parsePositiveIntArg(args, "--limit=");
  const maxFeaturesPerCandidate = parsePositiveIntArg(args, "--max-features=");
  const maxNeighborsPerCandidate = parsePositiveIntArg(args, "--max-neighbors=");

  return {
    competitionRoot,
    outputFile,
    limit,
    maxFeaturesPerCandidate,
    maxNeighborsPerCandidate,
  };
}

function parsePositiveIntArg(args: string[], prefix: string): number | undefined {
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${prefix.slice(2, -1)} must be a positive integer.`);
  }
  return parsed;
}

export function prepareCompetitionRag(options: CliOptions): {
  adapter: ReturnType<typeof buildCompetitionRagEnvelope>["report"];
  verification: ReturnType<typeof verifyBundles>;
  outputFile: string;
} {
  const competitionRoot = resolve(options.competitionRoot);
  const outputFile = resolve(options.outputFile);
  const built = buildCompetitionRagEnvelope({
    competitionRoot,
    limit: options.limit,
    maxFeaturesPerCandidate: options.maxFeaturesPerCandidate,
    maxNeighborsPerCandidate: options.maxNeighborsPerCandidate,
  });

  const jsonPayload = JSON.stringify([built.envelope], null, 2);
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, jsonPayload, "utf8");

  const loaded = loadAgentInputBundles({ inputJson: jsonPayload });
  const verification = verifyBundles(loaded, false);

  return {
    adapter: built.report,
    verification,
    outputFile,
  };
}

function main(): void {
  const result = prepareCompetitionRag(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
