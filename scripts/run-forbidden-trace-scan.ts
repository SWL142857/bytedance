import { runForbiddenTraceScan } from "../src/orchestrator/forbidden-trace-scan.js";

const args = process.argv.slice(2);
const rootDirArg = args.find((a) => a.startsWith("--root-dir="));

const report = runForbiddenTraceScan(
  rootDirArg ? { rootDir: rootDirArg.slice("--root-dir=".length) } : undefined,
);

console.log(JSON.stringify({
  status: report.status,
  findingCount: report.findingCount,
  categories: report.categories,
  files: report.files,
}));

if (report.status === "blocked") {
  process.exitCode = 1;
}
