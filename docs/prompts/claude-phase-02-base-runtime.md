# Claude Code Prompt: Phase 2 Base Runtime Contract

> Historical prompt. Do not use as current project direction. For current project truth, read `docs/current-state.md` first.

```text
你现在在 /Users/rosscai/projects/hireloop 仓库工作。

请先阅读：
- docs/superpowers/specs/2026-04-25-hireloop-design.md
- docs/implementation/phase-02-base-runtime-plan.md
- CLAUDE.md

本阶段目标：
实现 Base Runtime Contract：从现有 src/base/schema.ts 生成可执行的 lark-cli 操作计划，默认 dry-run，不触碰任何真实飞书 Base。只有显式 --execute 且 HIRELOOP_ALLOW_LARK_WRITE=1 时才允许真实执行。

硬约束：
- 不要调用飞书 Base API。
- 不要调用任何模型 API。
- 不要写入真实 token、app_id、secret、候选人真实 PII。
- 不要提交 git commit。
- 不要把 dry-run 输出伪装成真实成功。
- 不要用 shell 字符串拼接执行命令；后续 runner 必须使用 argv 数组。
- 测试中不得调用真实 lark-cli。

允许：
- 可以编辑 package.json 增加脚本。
- 可以新增 TypeScript 文件、测试文件、demo fixture。
- 可以使用现有依赖 TypeScript、tsx、node:test。
- 不需要新增第三方依赖；如果你认为必须新增，先说明理由，不要直接安装。

请实现以下文件：

1. src/config.ts
- 定义 HireLoopConfig。
- 从 process.env 读取：
  LARK_APP_ID
  LARK_APP_SECRET
  BASE_APP_TOKEN
  MODEL_API_KEY
  MODEL_API_ENDPOINT
  HIRELOOP_ALLOW_LARK_WRITE
  DEBUG
- 提供 loadConfig(env?: NodeJS.ProcessEnv)。
- 提供 validateExecutionConfig(config)。
- 提供 redactConfig(config)。
- execute 模式才要求 LARK_APP_ID、LARK_APP_SECRET、BASE_APP_TOKEN 存在。
- redactConfig 不得输出 secret/key 原文。

2. src/base/commands.ts
- 定义 BaseCommandSpec：
  description
  command
  args
  redactedArgs
  writesRemote
- 从 ALL_TABLES 生成 setup plan。
- 生成顺序必须稳定：
  create/ensure table -> create fields -> seed job -> seed candidate
- 只生成结构化 command spec，不执行。

3. src/base/field-mapping.ts
- 将 FieldDef 映射为后续 lark-cli field-create 可用的保守字段属性。
- 不要猜不确定的 Feishu 字段属性。
- 对暂不支持的字段类型显式返回 unsupported 或抛出明确错误。
- MVP 可支持 text、number、select、date、checkbox、url、link。
- json/multi_select 如不确定，先标 unsupported 并在测试覆盖。

4. src/base/lark-cli-runner.ts
- 执行 BaseCommandSpec[]。
- 默认 dry-run，只返回 planned/skipped。
- execute=true 时也必须检查 HIRELOOP_ALLOW_LARK_WRITE=1。
- 使用 child_process spawn 或 spawnSync 的 argv 数组形式。
- 串行执行，不并发。
- 不在日志中输出 secrets。
- 返回结构化结果，不直接 process.exit。

5. src/fixtures/demo-data.ts
- 定义一个 synthetic demo job 和一个 synthetic demo candidate。
- 不能包含真实姓名、电话、邮箱、身份证、真实公司敏感信息。
- 使用稳定 ID，比如 job_demo_ai_pm_001、cand_demo_001。
- 简历文本要短，且明显是虚构样例。

6. scripts/plan-base.ts
- 打印 Base setup plan。
- 不执行外部命令。

7. scripts/seed-base.ts
- 默认 dry-run。
- 支持 --execute。
- execute 时要求 validateExecutionConfig 通过。
- 调用 shared planner 和 runner。

8. package.json
新增脚本：
- base:plan
- base:seed:dry-run
- base:seed:execute

9. tests/base-command-planner.test.ts
覆盖：
- 命令顺序稳定。
- setup plan 包含 7 张表。
- seed plan 包含 demo job 和 demo candidate。
- unsupported 字段类型显式失败或被标记。
- command spec 不含 raw secret。

10. tests/config.test.ts
覆盖：
- dry-run 配置不要求真实 secret。
- execute mode 缺少必要配置会失败。
- redactConfig 不泄露 secret/key。

完成后运行：
- pnpm typecheck
- pnpm test
- pnpm base:plan
- pnpm base:seed:dry-run

完成后输出：
1. 创建/修改的文件列表
2. 执行过的命令和结果
3. 你没有做的事情：没有调用外部 API、没有安装依赖、没有提交 commit
4. 需要 Codex 重点 review 的点
```
