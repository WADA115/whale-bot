import fs from 'node:fs';
import path from 'node:path';

/** 本地密钥文件：state/secrets.json（已被 .gitignore 忽略）。 */
export function secretFile(root) {
  return path.join(root, 'state', 'secrets.json');
}

export function readSecret(root, name = 'deepseekApiKey') {
  try {
    const file = secretFile(root);
    if (!fs.existsSync(file)) return '';
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return String(data?.[name] ?? '').trim();
  } catch {
    return '';
  }
}

export function writeSecret(root, name, value) {
  const file = secretFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  data[name] = String(value ?? '').trim();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}
