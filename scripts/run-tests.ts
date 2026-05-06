import { spawnSync } from "node:child_process";
import { readdirSync, type Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectTestFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectTestFiles(full));
    } else if (ent.isFile() && ent.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const roots = [join(repoRoot, "tests"), join(repoRoot, "src")];
const files = roots.flatMap((r) => collectTestFiles(r)).sort();

if (files.length === 0) {
  console.error("No *.test.ts files found under tests/ or src/.");
  process.exit(1);
}

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const filteredArgs = args.filter((a) => a !== "--watch");

const nodeArgs = ["--import", "tsx", "--test"];
if (watch) nodeArgs.push("--watch");
nodeArgs.push(...files, ...filteredArgs);

console.log(`Running ${files.length} test file(s)…`);

const result = spawnSync(process.execPath, nodeArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
