# 依赖与供应链

## 安装方式

```powershell
npm ci
```

必须使用 `package-lock.json`；不要用 `npm install` 重新生成锁文件后直接发布。

当前锁文件：lockfileVersion 3，共 129 个包（含传递依赖）。

## 直接依赖（7 个）

| 包 | 锁定版本 | License | 用途 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-host-apiproxy` | 0.1.1-rc.2 | MIT | DSH host API 代理 |
| `@deepseek-ai/schemastery` | 3.18.1 | MIT | DSH 配置 schema |
| `@modelcontextprotocol/sdk` | 1.30.0 | MIT | MCP 工具协议 |
| `@snowluma/mcp` | 1.14.20 | 见包内 LICENSE | SnowLuma MCP 接口 |
| `@snowluma/sdk` | 1.14.20 | 见包内 LICENSE | SnowLuma SDK |
| `js-yaml` | 4.3.2 | MIT | YAML 预设解析 |
| `zod` | 4.4.3 | MIT | 运行时校验 |

`package.json` 对 6 个包使用 `^` 范围，但实际安装版本由锁文件固定。

## 安装脚本

当前存在：

```json
"postinstall": "node scripts/patch-snowluma-sdk.mjs"
```

这是一个会在 `npm install` 时自动执行的仓库脚本。

审计要求：

- 脚本只能修改 SnowLuma SDK 的已知文件
- 修改前校验目标路径
- 失败必须显式报错，不能静默
- 发布说明里必须提到它

后续建议改成显式命令（`npm run setup:snowluma`），避免安装即执行。

## 检查命令

```powershell
npm ci
npm ls --all
npm audit --omit=dev
node scripts/deps-report.mjs
```

发布前把 `npm audit` 结果附在发布记录里；有高危未修复项时不允许发布。

## 原则

- 新增依赖必须写用途、License、维护状态
- 不允许无锁文件安装
- 不允许匿名来源的 `postinstall`
- 不把 `node_modules` 提交进仓库
