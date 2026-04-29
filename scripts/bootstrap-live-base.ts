import { parseArgs } from "node:util";
import { loadConfig, validateExecutionConfig, redactConfig } from "../src/config.js";
import { bootstrap, validateBootstrapReport } from "../src/base/live-bootstrap.js";

const { values } = parseArgs({
  options: {
    execute: { type: "boolean", default: false },
  },
  strict: false,
});

const config = loadConfig();
const execute = values.execute === true;

console.log("=== HireLoop Live Base Bootstrap ===\n");
console.log(`Mode: ${execute ? "EXECUTE" : "DRY-RUN"}\n`);

if (execute) {
  const errors = validateExecutionConfig(config);
  if (errors.length > 0) {
    console.error("执行已阻断: 配置不完整");
    for (const err of errors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    console.error("\n脱敏配置:");
    console.error(JSON.stringify(redactConfig(config), null, 2));
    process.exit(1);
  }
}

const report = bootstrap({ config, execute });
validateBootstrapReport(report);

// Print report
console.log("=== 预检结果 ===");
console.log(`状态: ${report.preflight.status === "ready" ? "就绪" : "阻断"}`);
if (report.preflight.blockedReasons.length > 0) {
  for (const reason of report.preflight.blockedReasons) {
    console.log(`  - ${reason}`);
  }
}
if (report.preflight.tableStatuses.length > 0) {
  console.log("\n表状态:");
  for (const ts of report.preflight.tableStatuses) {
    const status = ts.exists ? `已有 ${ts.recordCount} 条记录` : "不存在";
    console.log(`  ${ts.displayName}: ${status}`);
  }
}

console.log("\n=== 建表 ===");
console.log(`创建: ${report.setup.created}  跳过: ${report.setup.skipped}  失败: ${report.setup.failed}`);

console.log("\n=== 种子数据 ===");
console.log(`创建: ${report.seed.created}  跳过: ${report.seed.skipped}  失败: ${report.seed.failed}`);
console.log(`岗位关联: ${report.seed.jobLinked ? "已完成" : "未完成"}`);

console.log("\n=== 摘要 ===");
console.log(report.safeSummary);

if (report.preflight.status === "blocked" || report.setup.failed > 0 || report.seed.failed > 0) {
  process.exit(1);
}
