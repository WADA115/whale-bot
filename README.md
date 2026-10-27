# 小鲸鱼 · deepseek_qq.bot

> 一个能记事、会换表情、还带控制台的 QQ 机器人：能聊天、看得懂图、记得住你，跑在自己的电脑上。

![登录页](docs/screenshots/login.png)

> **先读这个**：本文最后一节「坑」是踩过的真实问题合集，装之前扫一眼能省好几个小时。

---

## 它是什么

```
QQ 消息 → SnowLuma（网关）→ 桥接 → DeepSeek → 回复
                              ↕
                  记忆（按人隔离）/ 语境 / 表达 / 画图
                              ↕
                   控制台 3200 + 反代 5098
```

不是官方产品，是用你自己的 QQ 号在说话，数据全在本机。

---

## 功能

### 聊天
- 私聊直接聊；群聊自己判断接不接（智能 / 只回 @ / 每条都接）
- 按概率主动插话，有冷却；被拍一拍会回戳
- 长句拆成 2~5 条气泡，间隔 0.6~1.4 秒

### 看得懂
图片直读 · 动图抽帧 · 视频抽 4 帧 + 音轨转写 · 语音本地转写（音频不出本机）· 收藏表情包识图

### 记得住（五层 + 按人隔离）
设定（永不删）/ 长期 / 短期（72h 淡出，命中 2 次升长期）/ 关键词 / 会话摘要（超 24 条自动压缩）

- 开发者记忆在 `state/memory.json`；每个普通用户在自己的 `state/profiles/<用户名>/memory.json`
- 记忆以 `<context>` 包在 Prompt 最末尾（Layer 3），并附「不要因为记忆改变人格设定」

### 会学习（插件，默认关闭）
`plugins/learning`：从聊天里收游戏 / 梗 / 网络用语，存 `state/learning.json`，不碰记忆和设定；同句出现的词会两两关联。

### 自主记忆
每条消息本地判断一次「值不值得记」：身份 / 偏好 / 约定 → 长期，近期事实 → 短期。**不调模型、不花 token**，只写事实，不改人格卡和设定。

### 会表达
人格卡（卡片式，可自设，保存后自动同步「设定」）· 去 AI 腔 · 情绪影响语气 · 自主补表情 · 简笔画

### 有分寸
出站内容审核（7 类）· 危险工具要管理员确认 · 面板限速与 IP 脱敏

---

## 权限模型：两个入口，互不干扰

| | 普通用户 | 开发者 |
| --- | --- | --- |
| 进入方式 | 用户名 + 密码（可自助注册） | **只填密钥** |
| 设置存哪 | `state/profiles/<用户名>.json` | `config.json` |
| 能改 | 自己的人格、行为、语音开关、受信名单、记忆 | 全部（含本地管理） |
| 能否看全局 | ❌ 403 | ✅ |

- 开发者可永久停用开发者模式（`state/dev-mode.json`），恢复用 `开发者模式.ps1`
- 普通用户的数据与开发者完全隔离，环境检查对普通用户自动脱敏

---

## 快速开始

1. 装 **Node.js ≥ 20**（SnowLuma 自己要求 24+，两个都要满足装 24）
2. `npm install`
3. 复制 `config.example.json` → `config.json`，填 `ownerQQ` / `allow.*` / `snowluma.homeDir` / `dsh.baseUrl`
4. 准备 `tools/`（Windows 版 ffmpeg、ASR 模型；没有也能跑，只是少几种能力）
5. 启动（Windows 直接双击 `静默启动.vbs`）：
   ```bash
   node app.js          # 面板 3200
   node src/bridge.js   # 桥接 3100
   ```
6. 打开 `http://127.0.0.1:3200` → 填开发者密钥 → 到 SnowLuma 里登录 QQ

第一次启动会自动生成密钥，存在 `state/dev-key.txt`，控制台也打了一行。

---

## 控制台

![控制台](docs/screenshots/panel.png)

概览（服务状态 / 指标 / 日志）· 设置（模型、人格、行为、语音、受控名单、账户、本地管理、开发者模式）· 记忆（五类分开）· 插件（卡片式启停）· 外观（6 只原创小鲸鱼，点一下换，会眨眼）· 环境检查（只扫不改）· 使用说明 · 更新日志

---

## 配置示例

```json
{
  "ownerQQ": "你的QQ号",
  "allow": { "private": ["你的QQ号"], "groups": ["你的群号"] },
  "gateway": { "type": "snowluma" },
  "snowluma": { "homeDir": "C:\\SnowLuma", "httpUrl": "http://127.0.0.1:3000", "wsUrl": "ws://127.0.0.1:3001" },
  "dsh": { "baseUrl": "http://127.0.0.1:端口" },
  "panel": { "registerPerHour": 20 },
  "role": {
    "groupTrigger": "smart",
    "memory": { "autoRemember": true, "compress": true, "compressAfterTurns": 24 },
    "expression": { "enabled": true, "stickerChance": 0.22, "faceChance": 0.12 }
  }
}
```

换标准 OneBot 网关只改 `gateway.type = "onebot"`，桥接不用动。

---

## 输入限制

用户名 2~24 · 密码 6~128 · 人格卡 20000 字节 · 单条记忆 300 字 · 受信 QQ 每人 50 · 普通账户 20 个 · 注册 20 次/小时（可配）

---

## 目录结构

```
app.js              面板（3200）+ SnowLuma 反代（5098）
src/bridge.js       桥接（0.7 MB，改动前先跑测试）
src/gateway/        网关适配（snowluma / onebot）
src/memory-core.js  记忆分层 + 多租户
src/auto-memory.js  自主判断
src/env-scan.js     环境检查
roles/              人格卡
plugins/            插件（learning / example / qq-agent-presets / qq-mode-console）
assets/icons/       外观图标（PNG + ICO，原创）
tests/              19 个自动化测试 + 自检/文档检查脚本
state/              账户、记忆、日志、备份（不进仓库）
docs/               部署、网关适配、截图
```

---

## 端口一览

| 端口 | 谁 |
| --- | --- |
| 3000 / 3001 | SnowLuma（HTTP / WebSocket） |
| 3100 | 桥接 |
| 3199 | 本地语音识别 |
| 3200 | 控制台 |
| 5098 | 面板给 SnowLuma 起的反代 |
| 5099 | SnowLuma 自带 WebUI |

---

## 安全默认

- 面板只监听 127.0.0.1；未登录只能看登录页与说明页
- 密码 scrypt + 随机盐；登录限速；开发者密钥失败指数退避
- 开发者密钥不写进代码：环境变量 → `state/dev-key.txt` → 首次生成
- 普通账户读全局配置 / 记忆 / 本地管理一律 403
- 日志 IP 脱敏；出站内容审核默认开启

---

## 测试

```bash
node tests/run-tests.mjs
```

19 项：记忆分层、多租户隔离、自主判断、语境、表达、审核、表情、网关适配、权限守卫、去重、压缩、智能触发、学习插件、环境扫描、文档渲染。

两个需要外部条件的会**自动跳过**而不是报错：

| 测试 | 条件 |
| --- | --- |
| `test-memory-extract` | 需要 API key |
| `test-smart-trigger` | 需要 API key |
| `test-reset-button` | 端到端，需 `QQB_E2E=1` 且面板在跑 |

---

## 开源检查

```bash
node tests/check-opensource.mjs "项目目录" "临时输出目录"
```

查敏感串、目录清洁度、必备文件、语法、绝对路径、体积。

---

## 服务器部署

Windows VPS 可整套直搬；Linux 需换 OneBot 网关（NapCat / LLOneBot / Lagrange），桥接不用改。详见 `docs/服务器部署.md`。

---

## 坑（装之前先看）

下面全是实际踩过的，按「会疼的程度」排序。

## 一、连不上 QQ

**1. SnowLuma 没登录 QQ 时，3000 端口是不开的。**

桥接会一直刷：

```
SnowLuma WebSocket closed before opening
SnowLuma 连接断开（code=1006），重连中…
```

这不代表桥接坏了，是网关没登录。去 SnowLuma 里扫码。

**2. SnowLuma 有两个令牌：HTTP 令牌和 WS 令牌，必须一致。**

只改一个会 401 或连上就断。仓库里有 `同步令牌.ps1`，读它的配置文件自动对齐。

**3. 换机器/重装 SnowLuma 后 `snowluma.homeDir` 要跟着改。**

路径不对 → 读不到配置 → 令牌对不上 → 又是上面那个死循环。

**4. `ownerQQ` 和 `allow.private` / `allow.groups` 不填，机器人一句话都不回。**

它只理白名单里的人。改完 `config.json` **必须重启桥接**。

---

## 二、DSH 连不上

**5. DSH 的端口每次启动都可能变。**

`dsh.baseUrl` 写死一个旧端口 → 连不上。桥接有自动探测，但 `config.json` 里的旧值会干扰，建议留空或写当前值。

**6. DSH 没启动时，桥接能起但回复会失败。**

先看面板「概览」里的 DSH 状态，再查日志。

---

## 三、面板

**7. 改了 `public/*.html` 要 Ctrl+F5，改了 `app.js` 要重启。**

只改文件不重启 = 看不到效果；只重启硬刷新 = 可能拿到缓存。

**8. 撞到「注册次数已用完（每小时 20 个）」或「错太多次了，等一分钟再试」不是 bug。**

限速在内存里，**重启面板立刻清零**。要永久调大：`config.json` → `panel.registerPerHour`。

**9. 普通用户看不到全局设置、账户管理、本地管理，是设计如此。**

正常返回 403。别以为是权限漏了。

**10. 3200 起不来，先查是不是有旧进程占着。**

```powershell
netstat -ano | findstr ":3200"
```

**11. 开发者密钥只存在 `state/dev-key.txt`。**

删了会重新生成，**旧密钥立刻失效**。密钥输错多次会指数退避（最长 12 秒），这也是正常的。

**12. 面板默认只听 127.0.0.1，手机访问不了。**

要么 SSH 隧道，要么改绑定地址——但改之前想清楚：这是能操作你机器人记忆和人格的后台。

---

## 四、数据与备份

**13. `state/` 删了 = 一切重置。**

账户、密码哈希、记忆、密钥、日志、学到的词全在里面。升级前先备份。

**14. 记忆分两个地方，只备份一个会漏。**

```
state/memory.json                       开发者的
state/profiles/<用户名>/memory.json      每个普通用户的
```

**15. 记忆保存是防抖的（800ms）。**

刚写完立刻强杀进程，最后一条可能没落盘。正常关停没这问题。

**16. 人格卡改完要点「保存」才同步到「设定」。**

只改 `roles/*.md` 文件、不在面板点保存，记忆里的设定层不会更新。

**17. 语音库、表情包目录是 config 里指的路径，换机器要一起搬。**

不然「它发的语音/表情」全变 404。

---

## 五、语音与图片

**18. 语音默认是关的，而且有两层开关。**

全局 `socialV2.voice.enabled` + 每个人自己的 `behavior.voiceReply`。少开一层都不出声。

**19. 语音转文字要 3199 在跑。**

没起 → 语音消息只能当文件处理；不影响文字聊天。

**20. 发语音依赖 `edge-tts`（Python）+ 网络。**

没装 Python 或断网，语音发不出去，文字照常。

**21. 视频理解依赖 Windows 版 ffmpeg。**

`tools/ffmpeg/ffmpeg.exe` 或 PATH 里要有。Linux 版 exe 不行。

---

## 六、插件

**22. 插件默认全关，启用后要重启桥接才加载。**

面板会提示「改完重启桥接生效」，不是摆设。

**23. 学习插件只写 `state/learning.json`。**

它不碰记忆、不碰设定。发现记忆被改了，那不是它干的。

**24. 插件有 3 秒超时。**

钩子里做重活会被掐断，日志里有 `[plugin] ... timeout`。

---

## 七、测试

**25. 测试要面板在跑。**

`test-reset-button` 等端到端用例打的是 `127.0.0.1:3200`。

**26. 干净 clone 下来第一次跑测试，state 是空的。**

`tests/_setup.mjs` 会自动建最小结构；如果手动删过 `state/`，重跑一次就行。

**27. 测试撞 429 是限速，不是失败。**

连续跑多次自检会耗尽登录/注册额度，重启面板再跑。

---

## 八、Windows 环境

**28. PowerShell 脚本（.ps1）要 BOM + CRLF。**

编码不对会报「字符串缺少终止符」这类莫名其妙的错。仓库里的脚本已经是正确的，别用记事本另存。

**29. 静默启动（VBS）出错时不弹窗。**

看不到报错就看 `state/logs/`，bridge.log / panel.log 都在那。

**30. 端口探测别用 TcpClient 快速判断。**

这台机器上会假阴性。用 `netstat -ano | findstr LISTENING` 或直接发 HTTP 请求。

**31. 写 E 盘某些目录可能需要管理员权限。**

`npm install`、写 `tools/`、改系统 PATH 时如果报 EPERM/EACCES，用管理员开一个终端。

---

## 九、二次开发

**32. `src/bridge.js` 有 0.7 MB，改之前先跑测试。**

改完再跑一遍：

```bash
node tests/run-tests.mjs
```

**33. 面板里加函数，记得同步 `onclick` 引用。**

有 `tests/audit-panel-refs.mjs` 专门查这个（会扫出「HTML 里调用了但 JS 里没有」的函数）。

**34. 记忆注入在 Prompt 最末尾（Layer 3），别往前插。**

往前插会让人格设定被记忆盖住，语气就跑偏了。

**35. 普通用户和开发者的数据路径不一样，写代码时别用同一个常量。**

用 `memoryStore.for(owner)`，别自己拼 `state/memory.json`。

---

## 十、平台风险（这个最重要）

**36. 用自己 QQ 号跑自动化，技术上违反腾讯用户协议。**

轻则风控，重则封号。代码层面能做的只有：不群发、不营销、不碰支付、加内容审核。**不能保证不封号。**

**37. 别把面板暴露到公网。**

它没有 2FA、没有 CSRF token、没有审计日志。只适合本机或内网。

**38. 建议只发 GitHub，别发国内代码托管。**

「QQ 机器人 + 非官方协议」在国内平台容易被判违规下架。

---

## 快速排错表

| 症状 | 先看这里 |
| --- | --- |
| 完全不回消息 | `ownerQQ` / `allow.*` 白名单 → 是否重启桥接 |
| 桥接刷 WebSocket 错误 | SnowLuma 是否登录 QQ（3000 端口开没开） |
| 回复变慢/报错 | 面板概览里的 DSH 状态 |
| 面板打不开 | `netstat` 查 3200；看 `state/logs/panel.log` |
| 注册/登录 429 | 重启面板清限速 |
| 记忆不对 | 确认是开发者还是普通用户（两套文件） |
| 语音不发声 | 全局开关 + 个人开关 + 3199 + edge-tts |
| 插件没反应 | 是否重启桥接 |
| 测试失败 | 面板是否在跑；是否撞 429 |

---

## 许可证

MIT。保留上游 qq-bridge / QSH 的版权声明，并附本项目署名。

`assets/icons/` 里的吉祥物是本项目用代码绘制的原创图（随项目 MIT），未使用任何第三方素材。

## 致谢

[SnowLuma](https://github.com/SnowLuma/SnowLuma)、[DeepSeek Harness](https://www.deepseek.com/harness/)、[qq-bridge / QSH](https://github.com/Derpyu520/qq-bridge)、sherpa-onnx、FFmpeg、edge-tts、Pillow，以及所有写 OneBot 实现的人。详见 `致谢.md`。

## 免责声明

见 `免责声明.md`：AI 内容不保证正确；聊天记录明文存本机；API 费用自付；第三方组件版权归各自作者；封号风险自担。
