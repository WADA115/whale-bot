# bridge.js 拆分路线（P2）

> 目标：把 1.3 万行的 `src/bridge.js` 拆成可读模块，**行为不变**，每步可回滚。
> 原则：先钉快照，再抽纯函数；不做一次性大爆炸重写。

## 已完成

| 模块 | 内容 | 守护测试 |
| --- | --- | --- |
| `src/prompt/assemble.js` | `buildClosedAgentPrompt()`：角色/锚点/语境/记忆/群聊/正文的段落顺序与分隔符 | `tests/test-prompt-assemble.mjs`（9 项） |
| `src/message/parse.js` | 媒体段解析、直接点名、针对 AI、必须回、自己消息 | `tests/test-message-parse.mjs`（13 项） |
| `src/send/pipeline.js` | 单行化、超长拆分、空格分条、气泡切分、分条计划 | `tests/test-send-pipeline.mjs`（11 项） |
| `src/prompt/context.js` | 批量/试探/退场/主动提示词模板与三个常量 | `tests/test-prompt-context.mjs`（8 项） |
| `src/prompt/wake.js` | 身份行 + 各唤醒原因的行动指令模板 | `tests/test-prompt-wake.mjs`（9 项） |
| `src/prompt/wake-render.js` | 完整唤醒 prompt 组装（状态由 bridge 以 deps 传入） | `tests/test-wake-render.mjs`（8 项） |
| `src/plugins/runtime.js` | 插件扫描/验证/子进程加载/钩子调度 | `tests/test-plugin-runtime.mjs`（5 项） |
| `src/dsh/queue.js` | DSH 投递串行队列、状态、drain/drainAll | `tests/test-dsh-queue.mjs`（6 项） |
| `src/dsh/deliver.js` | 唤醒快照后缀、文本/图片 content parts、错误脱敏 | `tests/test-dsh-deliver.mjs`（6 项） |
| `src/dsh/deliver-run.js` | 单条 prompt 投递编排（模式/唤醒检查、离线排队、建会话、退场、重试） | `tests/test-deliver-run.mjs`（7 项） |

`bridge.js` 现在只负责收集数据，再交给拼装函数。

## 下一批（按风险从低到高）

1. ~~**消息解析**（纯函数）~~ ✅ 已完成：`src/message/parse.js`
2. ~~**发送流水线**（文本规划部分）~~ ✅ 已完成：`src/send/pipeline.js`（重试/回读仍在 bridge，后续再抽）
3. ~~**语境与提示词**（批量/试探/退场/主动）~~ ✅ 已完成：`src/prompt/context.js`
   - 唤醒模板已抽身份行与原因指令：`src/prompt/wake.js`；完整组装已抽到 `src/prompt/wake-render.js`（状态读取留在 bridge）
4. **插件与工具桥**
   - 插件钩子调用、工具白名单、DSH 投递封装
   - 目标：`src/plugins/runtime.js`、`src/dsh/deliver.js`

## 护栏

- 每抽一个模块，先写“同输入同输出”的快照测试
- 一次只动一个模块，跑全量测试（离线 + 全量）
- 不改变对外接口、不改配置键、不改提示词顺序
- 出问题按提交粒度回滚，不做跨模块大改

## 现状

- `bridge.js`：约 13,200 行，`main()` 从 1,543 行开始（最大的一块）
- 已独立：记忆、成长、表达、黑话、叙事审核、人格锚点、提示词拼装
- 拆分是长期工程，按阶段推进，不承诺一次完成
