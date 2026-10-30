# 架构裁剪记录

日期：2026-10-30

## 目标

让所有对话只走：

```
Orchestrator → 四标准 → Execution Gateway → QQ
```

## 已关闭 / 已移除

| 功能 | 处理 |
| --- | --- |
| 旧 DSH 对话 prompt 构建 | 从入站路径移除 |
| T2 失败回退旧 DSH | 删除；失败只沉默 |
| `social` 观望/活跃/试探/退场 | 配置关闭，不再执行 |
| `reserved2` 唤醒对话 | `dialogue.all=true` 时跳过 |
| MCP 写工具（send/reply/burst/sticker/face/voice/poke/collect/wake/wait/markRead） | `socialV2.tools` 全部 false |
| 表情/小黄脸/颜文字直发补丁 | 删除 `maybeSendExtras` 调用与实现 |
| `polishReply` 在四标准后改写 | 删除 |
| 插件 `onReply` 改写正文 | 删除，避免绕过四标准 |
| 旧 `buildClosedAgentPrompt` 入站调用 | 删除 |

## 保留

- Orchestrator gate / thinker / speaker
- 四标准
- Execution Gateway（唯一出口）
- DeepSeek 主链路 + 本地 8B 兜底
- 本地 Qwen2.5-VL 识图
- 按需群历史 30/50
- 关键词 + bge 语义记忆
- 入站语音转写
- 只读 MCP 工具（诊断用）
- 面板、鉴权、日志、看门狗

## 行为变化

- 机器人不再主动进入“社交模式”或自动退场
- 表情包/小黄脸/颜文字通过 Gateway `expression` action 发送，不再直发
- 插件不能改写已通过四标准的正文
- 旧 DSH 只负责摘要、记忆提取等内部任务，不生成对话

## 后续

- 已加 `InitiativeScheduler`：只决定时机，决策仍走 Orchestrator\n- 表情通过 Gateway `expression` action 发送

