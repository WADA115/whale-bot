// 旧 pipeline 入口保留为 Orchestrator 适配器：真实决策统一走 orchestrator。
import { orchestrateDialog } from '../orchestrator/index.js';

export async function runDialoguePipeline(args = {}) {
  return orchestrateDialog(args);
}
