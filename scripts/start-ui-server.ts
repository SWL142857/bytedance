import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Load .env.local before anything else so Feishu creds are in process.env
const repoRoot = resolve(dirname(import.meta.dirname));
const envLocal = resolve(repoRoot, ".env.local");
if (existsSync(envLocal)) {
  process.loadEnvFile(envLocal);
}

import { createServer } from "../src/server/server.js";
import { DEFAULT_RUNTIME_SNAPSHOT_PATH } from "../src/server/runtime-dashboard.js";

const args = process.argv.slice(2);

const BIND_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

function parsePort(): number {
  const portArg = args.find((arg) => arg.startsWith("--port="));
  const raw = portArg ? portArg.slice("--port=".length) : process.env["PORT"];
  if (!raw) return DEFAULT_PORT;

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid UI port: ${raw}`);
  }
  return port;
}

if (args.includes("--startup-check")) {
  const server = createServer({ runtimeSnapshotPath: DEFAULT_RUNTIME_SNAPSHOT_PATH });
  server.listen(0, BIND_HOST, () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 3000;
    console.log(`HireLoop UI startup check: http://localhost:${port}`);
    server.close(() => {
      console.log("Startup check passed.");
    });
  });
} else {
  const port = parsePort();
  const server = createServer({ runtimeSnapshotPath: DEFAULT_RUNTIME_SNAPSHOT_PATH });
  server.listen(port, BIND_HOST, () => {
    console.log(`HireLoop UI: http://localhost:${port}`);
  });
}
