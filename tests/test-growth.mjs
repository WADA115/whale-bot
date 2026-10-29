// 成长 M1 单测：去噪/去重/规则兜底/prompt/解析/摘要
import { isNoise, fingerprint, ruleJudge, buildJudgePrompt, parseJudge, mergeJudge, buildDigest } from '../src/growth-judge.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 去噪
for (const t of ['嗯', '哦哦', '哈哈哈', '？？？', '。', '😂😂😂', '']) {
  if (isNoise(t)) ok('噪声被过滤：' + JSON.stringify(t));
  else bad('噪声没过滤：' + JSON.stringify(t));
}

// 2. 正常句子不被误杀
for (const t of ['今天上班好累啊', '我喜欢喝冰美式', '以后别叫我全名']) {
  if (!isNoise(t)) ok('正常句子保留：' + t);
  else bad('误杀：' + t);
}

// 3. 指纹稳定
const a = fingerprint('我喜欢喝冰美式！');
const b = fingerprint('我喜欢喝冰美式');
if (a === b) ok('标点不影响指纹');
else bad('指纹不稳：' + a + ' / ' + b);

// 4. 规则兜底
const info = ruleJudge('以后别叫我全名，叫阿杰就行');
if (info.keep && info.score === 3) ok('偏好/约定得 3 分');
else bad('规则判断错：' + JSON.stringify(info));

const chat = ruleJudge('今天天气还行');
if (chat.score <= 1) ok('普通闲聊低分');
else bad('闲聊分太高：' + JSON.stringify(chat));

// 5. prompt
const prompt = buildJudgePrompt([{ text: '我喜欢冰美式' }, { text: '今天好累' }]);
if (prompt.includes('[0]') && prompt.includes('[1]') && prompt.includes('输出格式')) ok('prompt 含编号与格式说明');
else bad('prompt 不对');

// 6. 解析（含 ```json 包裹）
const parsed = parseJudge('```json\n{"items":[{"i":0,"score":3,"kind":"preference","text":"喜欢冰美式"}]}\n```');
if (parsed && parsed[0].score === 3 && parsed[0].kind === 'preference') ok('能解析代码块包裹的 JSON');
else bad('解析失败：' + JSON.stringify(parsed));

const badJson = parseJudge('模型抽风了');
if (badJson === null) ok('坏输出返回 null');
else bad('坏输出没返回 null');

// 7. 合并：模型漏掉的用规则兜底
const items = [{ text: '我喜欢冰美式' }, { text: '今天好累' }, { text: '嗯' }];
const merged = mergeJudge(items, [{ i: 0, score: 3, kind: 'preference', text: '喜欢冰美式' }]);
if (merged[0].score === 3 && merged.length === 3) ok('合并保留全部并补分');
else bad('合并异常：' + JSON.stringify(merged));
if (merged[2].score === 0) ok('噪声在兜底里是 0 分');
else bad('噪声兜底分不对：' + JSON.stringify(merged[2]));

// 8. 摘要
const digest = buildDigest([
  { score: 3, kind: 'preference', summary: '喜欢冰美式' },
  { score: 2, kind: 'emotion', summary: '今天很累' },
  { score: 1, kind: 'chat', summary: '天气' }
], '2026-10-28');
if (digest.count === 2 && digest.text.includes('冰美式') && !digest.text.includes('天气')) ok('摘要只收 ≥2 分');
else bad('摘要不对：' + JSON.stringify(digest));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
