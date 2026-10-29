# 鉴权与密码存储（可审计版）

## 密码哈希

| 参数 | 值 |
| --- | --- |
| 算法 | scrypt |
| N | 32768（2^15） |
| r | 8 |
| p | 1 |
| keylen | 32 字节 |
| salt | 16 字节随机 |
| maxmem | 64 MiB |

存储字段：

```json
{
  "user": "123456",
  "algo": "scrypt",
  "params": { "N": 32768, "r": 8, "p": 1, "keylen": 32 },
  "salt": "<hex>",
  "hash": "<hex>",
  "role": "user"
}
```

- 不存明文密码
- 校验使用 `crypto.timingSafeEqual`
- 旧记录没有 `params` 时按 N=16384/r=8/p=1 验证，成功后自动 rehash 到 32768
- 未知用户也执行一次 dummy scrypt，降低用户名枚举时序差异

代码：`src/core/auth/password.mjs`

## 密码策略

- 新密码最少 10 位，最多 128 位
- 临时密码：`QqBot-Reset-2026`，登录后强制修改
- 不允许把密码设成临时密码

## 会话

- 32 字节随机 token
- 服务端内存 Map，重启即失效
- Cookie：`HttpOnly; SameSite=Strict; Path=/`
- TTL 7 天
- 登录成功签发新 token；退出删除 token

代码：`src/core/auth/session.mjs`

## 开发者密钥退避

公式：

```
delay = min(2^(failCount-1) * 600ms, 12000ms)
```

- 第 1 次失败 600ms
- 第 2 次 1200ms
- ……
- 上限 12s
- 成功登录清零

语义：

| 情况 | 状态码 |
| --- | --- |
| 开发者模式未激活 | 403 |
| 密钥错误 | 403（并等待退避） |
| 仍在退避窗口 | 429 |

代码：`src/core/auth/throttle.mjs`

## 普通账户限速

- 同一 IP 每分钟最多 5 次失败
- 超过 → 429
- 成功登录清零

## 403 / 401 / 429 语义

| 状态 | 含义 |
| --- | --- |
| 401 | 未登录 / 会话过期 |
| 403 | 已登录但无权限，或开发者模式未激活，或密钥错误 |
| 429 | 触发登录限速 / 退避 |

## 边界

- 面板只允许本机访问（`isLocalRequest`），除非显式设置 `QQB_PANEL_ALLOW_REMOTE=1`
- 会话存内存，不做跨进程共享
- 不做密码找回邮件；本机自助重置后强制改密
