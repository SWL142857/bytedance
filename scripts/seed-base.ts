import { parseArgs } from "node:util";
import { loadConfig, validateExecutionConfig, redactConfig } from "../src/config.js";
import { generateFullPlan } from "../src/base/commands.js";
import { runPlan } from "../src/base/lark-cli-runner.js";
import { ALL_DEMO_SEEDS } from "../src/fixtures/demo-data.js";

const { values } = parseArgs({
  options: {
    execute: { type: "boolean", default: false },
  },
  strict: false,
});

const config = loadConfig();
const execute = values.execute === true;

if (execute) {
  const errors = validateExecutionConfig(config);
  if (errors.length > 0) {
    console.error("Execution blocked due to invalid config:");
    for (const err of errors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    console.error("\nRedacted config:");
    console.error(JSON.stringify(redactConfig(config), null, 2));
    process.exit(1);
  }
}

const plan = generateFullPlan(ALL_DEMO_SEEDS);

console.log("=== HireLoop Base Seed Plan ===\n");
console.log(`Mode: ${execute ? "EXECUTE" : "DRY-RUN"}`);
console.log(`Total commands: ${plan.commands.length}`);
console.log(`Unsupported fields: ${plan.unsupportedFields.length}\n`);

if (plan.unsupportedFields.length > 0) {
  console.log("=== Unsupported Fields ===\n");
  for (const uf of plan.unsupportedFields) {
    console.log(`  ${uf.tableName}.${uf.fieldName}: ${uf.fieldType} — ${uf.reason}`);
  }
  console.log();
}

if (!execute && plan.unsupportedFields.length > 0) {
  console.log("Note: seed may be incomplete because unsupported fields exist in the schema.");
  console.log("Execute mode will be blocked until all field types are supported.\n");
}

const result = runPlan({ plan, config, execute });

console.log("\n=== Summary ===");
console.log(`Total duration: ${result.totalDurationMs}ms`);
if (result.blocked) {
  console.log("Status: BLOCKED — execution was blocked due to missing config, HIRELOOP_ALLOW_LARK_WRITE, or unsupported fields");
}
const byStatus = {
  planned: 0,
  skipped: 0,
  success: 0,
  failed: 0,
};
for (const r of result.results) {
  byStatus[r.status]++;
}
console.log(`Planned: ${byStatus.planned}`);
console.log(`Skipped: ${byStatus.skipped}`);
console.log(`Success: ${byStatus.success}`);
console.log(`Failed: ${byStatus.failed}`);

if (result.blocked || byStatus.failed > 0) {
  process.exit(1);
}
