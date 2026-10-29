# 仓库目录地图（FOLDER_MAP）

> 一句话说明每个顶层目录干什么。最后核对：2026-10-29。

## 顶层布局

```
qq-bridge/
├─ README.md / README.en.md      项目说明（中文优先）
├─ LICENSE / CHANGELOG.md       许可证、更新日志
├─ FAQ.md / CONTRIBUTING.md / SECURITY.md
├─ package.json / package-lock.json / config.example.json
├─ app.js                        面板（3200）+ SnowLuma 反代（5098）
├─ 启动.bat                      一键启动入口（调 scripts/ops/start-hidden.vbs）
├─ src/                          桥接、记忆、成长、表达、网关、审核
│  ├─ prompt/                    assemble、context、wake、wake-render
│  ├─ message/                   parse（消息/媒体段解析）
│  ├─ send/                      pipeline（分条/气泡/超长拆分）
│  ├─ plugins/                   runtime（插件扫描/加载/钩子）
│  └─ dsh/                       queue、deliver（投递队列与内容）
├─ public/                       面板 / 登录页 / 说明页
├─ plugins/                      插件：learning、example、growth、DSH 预设
├─ roles/                        人格卡
├─ assets/                       图标与截图素材
├─ tests/                        自动化测试 + 文档检查
├─ docs/                         使用手册、配置说明、部署、截图
│  ├─ 使用手册.md / 配置说明.md
│  ├─ 服务器部署.md / 网关适配.md
│  └─ screenshots/
├─ scripts/
│  ├─ ops/                       启动、守护、状态、密钥、迁移、打包等运维脚本
│  └─ *.mjs                      DSH 探针 / 历史测试脚本
├─ dsh/                          DSH agent preset 源
├─ .github/workflows/ci.yml      CI：语法 → 离线测试 → 文档/开源检查
├─ state/                        运行数据（不进仓库）
├─ tools/                        ffmpeg / ASR 模型（不进仓库）
├─ audio/                        语音素材（不进仓库）
└─ node_modules/                 依赖（不进仓库）
```

## scripts/ops/ 里都是什么

| 脚本 | 作用 |
| --- | --- |
| `start-all.ps1` | 起 SnowLuma / 桥接 / 语音识别（启动令牌调用） |
| `start-asr.bat` | 单独起语音识别（自动找 Python 与 onnx 依赖） |
| `watchdog.ps1` | 守护：桥接 + ASR，掉线自动拉起 |
| `守护.bat` | 守护的可见窗口入口 |
| `静默启动.vbs` / `start-hidden.vbs` | 无窗口启动面板并打开浏览器 |
| `启动面板.bat` | 起面板并拉起服务 |
| `状态.bat` / `状态.ps1` | 只读查看端口、DSH、记忆、备份、守护 |
| `诊断启动.bat` | 启动失败时收集 node/端口信息 |
| `改密钥.ps1` / `开发者模式.ps1` / `重置密码.ps1` | 账户与密钥维护 |
| `同步令牌.ps1` / `sync-dsh-url.ps1` | SnowLuma 令牌 / DSH 端口同步 |
| `迁移.ps1` / `首次推送.ps1` / `开源打包.ps1` | 迁移、首次发布、打干净包 |
| `tts-sapi.ps1` / `语音测试.bat` | 本地语音合成测试 |

## 拆分模块

| 路径 | 作用 |
| --- | --- |
| \src/prompt/assemble.js\ | 闭代理提示词拼装 |
| \src/prompt/context.js\ | 批量/试探/退场/主动模板 |
| \src/prompt/wake.js\ | 身份行 + 唤醒原因模板 |
| \src/prompt/wake-render.js\ | 完整唤醒 prompt 组装 |
| \src/message/parse.js\ | 消息段/媒体段解析 |
| \src/send/pipeline.js\ | 分条/气泡/超长拆分 |
| \src/plugins/runtime.js\ | 插件扫描/加载/钩子调度 |
| \src/dsh/queue.js\ | DSH 投递串行队列 |
| \src/dsh/deliver.js\ | 投递内容组装 |
