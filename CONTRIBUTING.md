# 参与贡献

谢谢你看这个项目。它是个「一个人 + 一个 AI」攒出来的本地项目，所以规矩尽量少、但底线要清楚。

## 开工前

```bash
git clone https://github.com/WADA115/whale-bot.git
cd whale-bot
npm install
cp config.example.json config.json     # 填自己的 QQ 号
node tests/run-tests.mjs               # 应该 19/19 全过
```

**改代码前先跑一遍测试**，确认你看到的是「本来就绿」的状态，不是自己改红的。

## 改完之后必须跑

| 命令 | 什么时候跑 | 通过了说明 |
| --- | --- | --- |
| `node tests/run-tests.mjs` | 改了任何 JS | 19 项全过 |
| `node tests/check-docs.mjs` | 改了面板文案 / 使用手册 | 两端说明一致（≤200 行） |
| `node tests/check-opensource.mjs ".." "<临时目录>"` | 准备发 PR | 没有敏感信息、目录干净 |

**三个都过再提 PR。** 少跑一个，我会退回让你补。

## 改功能时注意

1. **文档要同步**：面板 `guide.html` 和 `使用手册.md` 是「两端」，同一条规则两边都得有，否则 `check-docs.mjs` 会红。
2. **普通账户和开发者是两套路径**：记忆、配置、档案都分开。写代码时用 `memoryStore.for(owner)`，别自己拼 `state/memory.json`。
3. **记忆注入在 Prompt 最末尾（Layer 3）**：别往前插，会盖住人格设定。
4. **面板加函数**：`onclick` 里调用了的函数必须在 JS 里存在，`tests/audit-panel-refs.mjs` 会查。
5. **插件别默认开启**：`manifest.enabled` 默认 `false`，开之前要弹风险提示。

## 提交信息

```
一句话说清改了什么，中文即可

- 细节一
- 细节二
```

不用加 emoji，不用学 Conventional Commits，说人话就行。

## 不要做的事

- ❌ 提交 `state/`、`config.json`、`node_modules/`、`tools/` 里的二进制
- ❌ 把 QQ 号、令牌、密钥写进代码或文档
- ❌ 提交 `*.log`、个人报告、截图里的隐私信息
- ❌ 在 Issue / PR 里贴别人的聊天记录

## 报 Issue

先看 [FAQ.md](FAQ.md)（38 条坑）。还解决不了再开，模板会问你要环境信息——**照着填**，不然来回问很费时间。

安全问题**不要**开公开 Issue，走 [SECURITY.md](SECURITY.md) 里的私密报告。

## 许可

贡献的代码默认按 MIT 授权（见 [LICENSE](LICENSE)）。
