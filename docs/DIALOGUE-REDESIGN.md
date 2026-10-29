# 对话系统重做方案（B：混合编排）

> 决策：规则 + flash gate；不做每日 token 上限；灰度只用旧群 `978815624`，不碰新群 `344739750`。
> 原则：先记录、再回放、再替换；旧链路可一键回滚。

## 架构

```
QQ → Transport（现有 bridge）
   → Event Log（每条消息：sender/@/reply/isSelf/isBot）
   → Thread Store（最近事件、开放问题、机器人上一轮）
   → Wake Gate（规则 + flash，只决定值不值得叫醒）
   → Dialogue Orchestrator（DSH agent，输出结构化动作）
   → Output Guard → Scheduler → QQ
   → Turn Log → 回放/评测
```

## 结构化动作

```json
{ "action": "reply", "replyTo": 194, "messages": ["..."], "delayMs": [1200, 2600], "reason": "对方在追问上一题" }
{ "action": "skip", "reason": "两个群友在互相接梗" }
{ "action": "wait", "waitMs": 8000, "reason": "对方可能没说完" }
```

插话是显式 `reply` + `interject`，由独立预算控制，不再“判否后抽概率”。

## 阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | TurnLog + 黄金集 + 回放脚本 | ✅ 本次完成 |
| P1 | Event/Thread Store + 结构化动作契约（先由旧逻辑填） | ✅ 基础设施完成 |
| P2 | gate + thinker + speaker 影子 | ✅ 三层影子；真实发送切换待做 |
| P3 | 旧群灰度，可回滚 | ✅ 旧群全部群消息走新链路；可配置回退 |
| P4 | 切私聊/全群，删旧分类器 | 待做 |

## P0 产物

- `src/dialogue/turn-log.js`：`state/dialogue/turns-YYYY-MM-DD.jsonl`
- `scripts/dialogue-golden.mjs`：从 `state/context.json` 生成 `golden-<group>.jsonl`
- `scripts/dialogue-replay.mjs`：校验黄金集并统计
- `tests/test-turn-log.mjs`

## 约束

- 不记录密钥/完整媒体内容；文本截断 240 字。
- 黄金集需要人工补 `shouldReply`，不能拿“上下文标记”当答案。
- 新链路只在旧群灰度；新群不加白名单。

## v0.6.0 更新

- Orchestrator 成为唯一对话事务入口（pipeline 仅适配器）
- 四标准硬闸门：不编造 / 不冲突 / 不混乱 / 自主
- 召回与心理评估并行，直接 @ 走快路径
- 自主表达模块待接调度器
