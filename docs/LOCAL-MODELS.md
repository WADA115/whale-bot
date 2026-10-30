# 本地模型部署（混合模式）

## 机器

- CPU：Intel Core Ultra 7 255HX，20 核
- 内存：15.4 GB
- GPU：RTX 5060 Laptop，8 GB VRAM，CUDA 12.0
- 系统：Windows 11 26200
- 模型目录：`E:\ollama\models`

## 已安装

| 模型 | 大小 | 用途 | 状态 |
| --- | --- | --- | --- |
| `qwen3:4b` | 2.5 GB | 常驻快速任务 | ✅ |
| `qwen3:8b` | 5.0 GB | 摘要 / 兜底 | ✅（ModelScope GGUF 导入） |
| `qwen2.5vl:3b` | 3.3 GB | 识图 | ✅ |
| `bge-m3` | 1.2 GB | 记忆检索 | ✅ |

## Ollama

```powershell
E:\ollama\app\ollama.exe serve
```

环境变量：

```text
OLLAMA_MODELS=E:\ollama\models
OLLAMA_MAX_LOADED_MODELS=2
OLLAMA_KEEP_ALIVE=5m
```

## 注意

- 8 GB 显存一次只常驻一个模型
- 视觉和文本不要同时常驻
- Qwen3 默认 thinking；本地调用要取 `message.content`，忽略 `message.thinking`
- 8B 首次加载约数十秒，之后几秒
- Ollama registry TLS 吊销检查异常时用 `--ssl-no-revoke` 或 BITS

## 路由

| 角色 | 主 | 备 |
| --- | --- | --- |
| Thinker | DeepSeek v4-pro | 本地 qwen3:8b |
| Speaker | DeepSeek flash | 本地 qwen3:8b |
| 识图 | 本地 qwen2.5vl:3b | DSH 多模态 |
| 摘要 | 本地 qwen3:8b | DeepSeek flash |
| Embedding | 本地 bge-m3 | 关键词 |

DeepSeek 保留在关键路径，本地模型做增强/兜底。\n\n## 当前接入状态\n\n- `dialogueAsks`：DeepSeek 主，本地 8B 在 DeepSeek 超时/5xx 时兜底\n- `describeImages`：本地 Qwen2.5-VL 3B 优先，失败回 DSH 多模态\n- `bge-m3`：已接语义召回；关键词检索仍保留\n- 两个模型可同时常驻：4B/8B + bge-m3，显存约 6.2GB\n- 首次 embedding 需加载 bge（约 4 秒），之后查询约 40ms\n- 本地视觉实测：面板截图约 6 秒，能正确描述
