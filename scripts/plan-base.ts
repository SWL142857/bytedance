import { generateSetupPlan } from "../src/base/commands.js";

const plan = generateSetupPlan();

console.log("=== HireLoop Base Setup Plan ===\n");
console.log(`Total commands: ${plan.commands.length}`);
console.log(`Unsupported fields: ${plan.unsupportedFields.length}\n`);

if (plan.unsupportedFields.length > 0) {
  console.log("=== Unsupported Fields ===\n");
  for (const uf of plan.unsupportedFields) {
    console.log(`  ${uf.tableName}.${uf.fieldName}: ${uf.fieldType} — ${uf.reason}`);
  }
  console.log();
}

for (const cmd of plan.commands) {
  console.log(`[${cmd.writesRemote ? "WRITE" : "READ"}] ${cmd.description}`);
  console.log(`  ${cmd.redactedArgs.join(" ")}\n`);
}
