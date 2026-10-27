import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// qq-owner-guard 的单元测试：验证写保护规则。
import path from 'node:path';
import { apply } from '../plugins/qq-agent-presets/qq-owner-guard.mjs';

let guard = null;
apply({ tools: { guard(fn) { guard = fn; } } });

const repo = ROOT;
const win = path.win32.join(repo, 'src', 'bridge.js');
const cases = [
  ['write 源码', { name: 'write', arguments: { file_path: win } }],
  ['edit 源码', { name: 'edit', arguments: { file_path: path.win32.join(repo, 'src', 'bridge.js') } }],
  ['write 配置', { name: 'write', arguments: { file_path: path.win32.join(repo, 'config.json') } }],
  ['write 语音库(应放行)', { name: 'write', arguments: { file_path: path.win32.join(repo, 'audio', 'x.mp3') } }],
  ['write 外部(应放行)', { name: 'write', arguments: { file_path: 'C:/temp/x.txt' } }],
  ['read 源码(应放行)', { name: 'read', arguments: { file_path: win } }],
  ['pwsh del 源码', { name: 'pwsh', arguments: { command: `del "${win}"` } }],
  ['pwsh Remove-Item 状态', { name: 'pwsh', arguments: { command: `Remove-Item "${path.win32.join(repo, 'state', 'bridge.log')}"` } }],
  ['pwsh 只读日志(应放行)', { name: 'pwsh', arguments: { command: `Get-Content "${path.win32.join(repo, 'state', 'bridge.log')}" -Tail 5` } }],
  ['pwsh 无关命令(应放行)', { name: 'pwsh', arguments: { command: 'Get-Date' } }],
];

let fail = 0;
for (const [label, exec] of cases) {
  const reason = guard(exec);
  const denied = Boolean(reason);
  const shouldDeny = !label.includes('应放行');
  const ok = denied === shouldDeny;
  if (!ok) fail += 1;
  console.log(`${ok ? '  OK ' : ' FAIL'} | ${denied ? '拒绝' : '放行'} | ${label}${reason ? ' ← ' + String(reason).slice(0, 46) : ''}`);
}
console.log(fail === 0 ? '\n全部用例通过' : `\n${fail} 个用例失败`);
process.exitCode = fail === 0 ? 0 : 1;
