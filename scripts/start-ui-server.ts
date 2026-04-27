import { createServer } from "../src/server/server.js";
import { DEFAULT_RUNTIME_SNAPSHOT_PATH } from "../src/server/runtime-dashboard.js";

const args = process.argv.slice(2);

if (args.includes("--startup-check")) {
  const server = createServer({ runtimeSnapshotPath: DEFAULT_RUNTIME_SNAPSHOT_PATH });
  server.listen(0, () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 3000;
    console.log(`HireLoop UI startup check: http://localhost:${port}`);
    server.close(() => {
      console.log("Startup check passed.");
    });
  });
} else {
  const port = 3000;
  const server = createServer({ runtimeSnapshotPath: DEFAULT_RUNTIME_SNAPSHOT_PATH });
  server.listen(port, () => {
    console.log(`HireLoop UI: http://localhost:${port}`);
  });
}
