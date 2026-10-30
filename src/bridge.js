// QQ ↔ DeepSeek Harness 入口：真正的运行时在 app.js。
import { main } from './app.js';

main().catch((error) => {
  console.error('[bridge] 启动失败:', error);
  process.exit(1);
});
