import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGroupRuntime } from '../src/group/runtime.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith('--file='))?.slice(7);
const group = 'sim:group';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-sim-'));
const rt = createGroupRuntime({
  dbPath: path.join(dir, 'sim.db'),
  cfg: { groupRuntime: { ambientReply: false, botCooldownMs: 30000 }, role: { displayName: '鱼鱼' } }
});

const scenario = fileArg
  ? JSON.parse(fs.readFileSync(fileArg, 'utf8'))
  : [
      { name: '甲', text: '我这插件还没改完' },
      { name: '乙', text: '@鱼鱼 在吗' },
      { name: '甲', text: '你别催他' },
      { name: '乙', text: '就这串代码' },
      { name: '鱼鱼', self: true },
      { name: '甲', text: '你那个插件发上来看看' },
      { name: '乙', text: '@鱼鱼 解释上面那张图', image: { id: 'img1', desc: '一张测试截图' } }
    ];

let batch = [];
for (const [i, item] of scenario.entries()) {
  if (item.self) {
    rt.recordBotReply(group, { messageId: 'bot' });
    console.log(`${i + 1}. [bot] 已回复，进入冷却`);
    batch = [];
    continue;
  }
  if (item.image) rt.rememberImage(group, { messageId: item.image.id, desc: item.image.desc, user: item.name });
  const decision = rt.observe({
    group, userId: item.name, name: item.name, text: item.text || '',
    messageId: `m${i + 1}`, direct: String(item.text || '').includes('@鱼鱼'),
    media: item.image ? [{ kind: 'image' }] : []
  });
  const relevant = decision.decision === 'direct' || decision.decision === 'likely';
  if (relevant) {
    batch.push(item.text || '[图片]');
    console.log(`${i + 1}. ${item.name}: ${item.text || '[图片]'} -> ${decision.decision}/${decision.reason}｜批次 ${batch.length} 条`);
  } else {
    console.log(`${i + 1}. ${item.name}: ${item.text || '[图片]'} -> ${decision.decision}/${decision.reason}`);
  }
}
console.log('\n最终批次:', batch.length ? batch.join(' / ') : '（空）');
console.log('图片引用:', rt.lastImage(group)?.desc ?? '无');
rt.close();
fs.rmSync(dir, { recursive: true, force: true });
