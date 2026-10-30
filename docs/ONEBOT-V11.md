# OneBot v11 接入方案

桥接内置标准 OneBot v11 适配器：

- `src/gateway/onebot.mjs`
- HTTP 动作：`POST /{action}`
- WebSocket 事件：`ws://...`

SnowLuma 仍可保留，切换只改 `config.json` 的 `gateway.type`。

## 配置

```json
"gateway": {
  "type": "onebot",
  "httpUrl": "http://127.0.0.1:3000",
  "wsUrl": "ws://127.0.0.1:3001",
  "accessToken": ""
}
```

说明：

- `httpUrl` / `wsUrl` 指向 NapCat / LLOneBot / Lagrange 的 OneBot v11 服务
- `accessToken` 两边必须一致；没有就留空
- 如果 HTTP/WS 令牌不同，填 `wsAccessToken`；不填则复用 `accessToken`
- 不写 `gateway` 时默认仍是 SnowLuma

## 推荐后端

| 后端 | 说明 |
|---|---|
| NapCat | QQNT 的 OneBot v11 实现，HTTP + WS，常用 |
| LLOneBot | LiteLoaderQQNT 插件，OneBot v11 |
| Lagrange | 独立协议实现，部署方式不同 |
| go-cqhttp | 老项目，维护已不活跃，不建议新部署 |

个人 QQ 的第三方协议仍有账号风控风险；先用测试号。

## 切换步骤

1. 启动 OneBot v11 后端，确认端口和 token
2. 先探测：

```powershell
node scripts/onebot-probe.mjs
```

3. 备份 `config.json`
4. 加 `gateway` 段，设 `type: "onebot"`
5. 重启 bridge
6. 看日志：

```text
[gateway] 使用标准 OneBot v11
```

7. 发一条私聊和一条群聊，确认收、发、@、引用、图片

## 能力差异

| 能力 | SnowLuma | 标准 OneBot v11 |
|---|---|---|
| 群/私聊消息 | 有 | 有 |
| @ / 引用 | 有 | 有 |
| 图片 | 有 | 有，取决于后端 |
| 语音 record | 有 | 有，取决于后端 |
| 视频 | 扩展动作 | 取决于后端是否实现 `get_video` / `get_file` |
| 收藏表情 CDN | 扩展 | 通常没有 `fetch_face_entity`，桥接会降级 |
| 群成员列表 | 有 | 通常有，可能需要权限 |
| 表情名学习 | 有 | 降级为本地名字表 |

标准 OneBot 没有：

```text
fetchFaceEntity
```

桥接会自动降级，不会阻断聊天。

## 回滚

把：

```json
"gateway": { "type": "onebot" }
```

改回：

```json
"gateway": { "type": "snowluma" }
```

或删掉 `gateway` 段，重启即可。

## 已知限制

- OneBot 后端的 `get_image` / `get_video` / `get_record` 实现不一致，媒体可能部分失败
- WS token 有的后端只认 query，有的只认 header；当前适配器用 query
- 群成员列表可能受权限限制，人物簿同步会记录失败但不影响聊天
- 个人 QQ 仍有平台风控和账号风险，本项目不绕过限制
