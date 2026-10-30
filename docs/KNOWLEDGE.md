# 本地知识库与学习舱

## 1. 冷启动

先让机器人离线学习：

```powershell
cd E:\deepseek_qq.bot\qq-bridge
node scripts\learn.mjs --minutes=90 --topics="小鲸鱼,QQ机器人,DeepSeek" --platforms=deepseek
```

学习完成后写：

```
state/knowledge/READY.json
state/knowledge/knowledge.db
```

启用知识库：

```powershell
node scripts\learn.mjs --minutes=90 --topics="小鲸鱼" --platforms=deepseek --enable
```

或手动把 `config.json` 的 `knowledge.enabled` 改成 `true`。

## 2. 状态

```powershell
node scripts\knowledge-status.mjs
```

## 3. 行为

- `knowledge.enabled=true` 且没有 READY：
  - 群聊沉默
  - 私聊只给管理员提示“学习中”
  - 不调用对话模型
- READY 后：
  - 每轮从 SQLite 检索
  - evidence 进入 schema transaction
  - 四标准 grounding 检查

## 4. 采集边界（默认 DeepSeek Search/Fetch）

- 只采公开页面/公开 API
- 不登录、不绕验证码、不破风控
- 限速：默认 2 秒/请求
- 412/429 自动冷却 120 秒
- 贴吧 403 时停止，不重试绕过
- 只存文本/片段/向量，不存原始 HTML

## 5. 表

```
sources / documents / chunks / chunks_fts
slang / style_profiles
crawl_jobs / learning_runs
turn_events / turns
```

## 6. 测试

```powershell
node tests\test-knowledge.mjs
node tests\test-knowledge-learning.mjs
```
