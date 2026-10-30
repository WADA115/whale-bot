# 本地密钥

DeepSeek API key 不再放在 `config.json`。

## 位置

```
state/secrets.json
```

已被 `.gitignore` 忽略，ACL 仅当前用户与 SYSTEM。

## 迁移

```powershell
cd E:\deepseek_qq.bot\qq-bridge
node scripts\secure-secrets.mjs
```

## 解析顺序

1. 环境变量 `DEEPSEEK_API_KEY`
2. `state/secrets.json` 的 `deepseekApiKey`
3. DSH `.credentials.yaml`
4. 都没有时，搜索回退 Bing

## 轮换

1. 在 DeepSeek 控制台撤销旧 key
2. 生成新 key
3. 更新 `state/secrets.json`
4. 重启 bridge

旧 key 曾出现在 `config.json` 和排查输出里，建议尽快轮换。
