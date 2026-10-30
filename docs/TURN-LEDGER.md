# Turn Ledger

每轮对话写入 `state/runtime.db`，用于：

- 回放
- 并发检查
- 失败定位
- 上下文审计

## 表

```
chat_state(chat, version)
turn_events(turn_id, seq, stage, payload, ts)
turns(turn_id, chat, version, action, messages, evidence, standards, outcome)
```

## 阶段

```
received
context_ready
candidates
committed
failed
stale
```

## 回放

```powershell
cd E:\deepseek_qq.bot\qq-bridge
node scripts\turn-replay.mjs --chat=private:1260304613 --limit=10
node scripts\turn-replay.mjs --id=<turn_id>
```

## 并发

每个 chat 有递增 `version`。

提交时如果 `chat_state.version` 已经变化：

```
stale-turn
```

该轮不会发送，避免旧回合覆盖新回合。
