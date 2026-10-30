import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeSecret, readSecret, secretFile } from '../src/secrets.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfgPath = path.join(root, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const key = String(cfg?.webSearch?.apiKey ?? '').trim();
const snowToken = String(cfg?.snowluma?.accessToken ?? '').trim();
const snowWsToken = String(cfg?.snowluma?.wsAccessToken ?? '').trim();
const existing = readSecret(root);
if (!key && !existing && !snowToken && !snowWsToken) {
  console.log('没有可迁移的明文密钥');
  process.exit(1);
}
if (key) {
  writeSecret(root, 'deepseekApiKey', key);
  cfg.webSearch = { ...(cfg.webSearch ?? {}), apiKey: '' };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log('已迁移到 state/secrets.json，并清空 config.json 的 webSearch.apiKey');
}
if (snowToken) { writeSecret(root, 'snowlumaAccessToken', snowToken); cfg.snowluma.accessToken = ''; console.log('已迁移 SnowLuma HTTP token'); }
if (snowWsToken) { writeSecret(root, 'snowlumaWsAccessToken', snowWsToken); cfg.snowluma.wsAccessToken = ''; console.log('已迁移 SnowLuma WS token'); }
if (snowToken || snowWsToken) {
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}
const file = secretFile(root);
try {
  const user = os.userInfo().username;
  execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:(R,W)`, 'SYSTEM:(R,W)'], { stdio: 'ignore' });
  console.log('已收紧 ACL：仅当前用户与 SYSTEM');
} catch (error) {
  console.log('ACL 收紧失败（文件仍已脱离 config.json）：' + (error?.message ?? error));
}
