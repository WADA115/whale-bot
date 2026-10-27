// 静态审计：面板里 onclick 调用的函数是否都有定义（防止又是"点了没反应"）
import fs from 'node:fs';

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// 收集 onclick / onchange / oninput 里直接调用的函数名
const calls = new Set();
for (const m of html.matchAll(/on(?:click|change|input)="([^"]+)"/g)) {
  for (const f of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(f[1]);
}

// 脚本里定义的函数（function 声明 + const/let 箭头函数）
const defined = new Set();
for (const m of script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
for (const m of script.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);

const builtins = new Set(['alert', 'confirm', 'prompt', 'console', 'parseInt', 'parseFloat', 'String', 'Number', 'Math', 'JSON', 'fetch', 'setTimeout', 'encodeURIComponent']);

let missing = 0;
const rows = [...calls].sort().filter((f) => !builtins.has(f));
for (const f of rows) {
  const ok = defined.has(f);
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + f);
  if (!ok) missing += 1;
}
console.log('\n共检查 ' + rows.length + ' 个函数，缺失 ' + missing + ' 个');
process.exit(missing ? 1 : 0);
