// 执行层防绕过检查：结构检查，不做运行时发送。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, 'src', 'app.js');
const generatedDir = path.join(root, 'src', 'runtime', 'generated');
const generated = fs.existsSync(generatedDir)
  ? fs.readdirSync(generatedDir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(generatedDir, f), 'utf8'))
  : [];
const src = [fs.readFileSync(file, 'utf8'), ...generated].join('\n');
const runtimeSrc = fs.readFileSync(path.join(root, 'src', 'runtime', 'handle-incoming.js'), 'utf8');

const checks = [];
const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

add('deliverPrompt 旧对话守卫', src.includes('legacyDialogDisabled') && src.includes("blocked: true, reason: 'legacy-dialog-disabled'"));
add('sendSpeakerPlan 走 Gateway', /async function sendSpeakerPlan[\s\S]{0,2000}executionGateway\.execute/.test(src));
add('runInitiative 走 Orchestrator', /async function runInitiative[\s\S]{0,1600}orchestrateDialog/.test(src));
add('sendSystem 走 Gateway', /async function sendSystem[\s\S]{0,800}source: 'system'/.test(src));
add('sendCommand 走 Gateway', /async function sendCommand[\s\S]{0,800}source: 'command'/.test(src));
add('canary 私聊开关', src.includes('canaryPrivate') || runtimeSrc.includes('canaryPrivate'));

const directSends = (src.match(/await sendToQQ\(key/g) ?? []).length;
const deliverCalls = (src.match(/deliverPrompt\(key/g) ?? []).length;
add('bridge 无直接 sendToQQ', directSends === 0);
add('底层发送走 transport', src.includes('createTransport({ sendToQQ })') && src.includes('rawTransport.sendRaw'));
add('安全通知走 security', src.includes('notifySecurity'));

console.log(`执行层检查：sendToQQ(key) ${directSends} 处，deliverPrompt(key) ${deliverCalls} 处`);
let fail = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}`);
  if (!c.ok) fail += 1;
}
console.log(fail ? `❌ ${fail} 项未通过` : `✅ ${checks.length} 项结构检查通过`);
process.exit(fail ? 1 : 0);
