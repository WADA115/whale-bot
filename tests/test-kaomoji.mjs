// 颜文字单测
import { pickKaomoji, worthKaomoji, KAOMOJI_COUNT } from '../src/kaomoji.js';
import { decideExtras } from '../src/expression.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };

// 1. 词库非空
if (KAOMOJI_COUNT >= 20) ok('词库 ' + KAOMOJI_COUNT + ' 个');
else bad('词库太少：' + KAOMOJI_COUNT);

// 2. 按关键词挑
const love = pickKaomoji({ text: '我喜欢你', random: () => 0 });
if (love && love.includes('♡')) ok('「喜欢」→ 爱心颜文字：' + love);
else bad('关键词没生效：' + love);

const sad = pickKaomoji({ text: '好难过，想哭', random: () => 0 });
if (sad && /╥|；ω；|•́︿•̀/.test(sad)) ok('「难过」→ 哭脸：' + sad);
else bad('难过没匹配：' + sad);

const angry = pickKaomoji({ text: '烦死了，真讨厌', random: () => 0 });
if (angry && /╬|#`Д|ヽ\(`Д|￣\^￣/.test(angry)) ok('「讨厌」→ 生气脸：' + angry);
else bad('生气没匹配：' + angry);

// 3. 无关键词时按心情
const happyMood = pickKaomoji({ text: '嗯', mood: 4, random: () => 0 });
if (happyMood) ok('心情好能挑到：' + happyMood);
else bad('心情好挑不到');

const sadMood = pickKaomoji({ text: '嗯', mood: -4, random: () => 0 });
if (sadMood) ok('心情差能挑到：' + sadMood);
else bad('心情差挑不到');

// 4. exclude 生效
const first = pickKaomoji({ text: '哈哈', random: () => 0 });
const second = pickKaomoji({ text: '哈哈', exclude: [first], random: () => 0 });
if (second && second !== first) ok('exclude 生效，不会连着重复');
else bad('exclude 没生效：' + first + ' / ' + second);

// 5. 长度合理
const sample = pickKaomoji({ text: '哈哈', random: () => 0.5 });
if (sample && sample.length <= 24) ok('长度可控：' + sample.length + ' 字符');
else bad('颜文字太长：' + sample);

// 6. worthKaomoji
if (worthKaomoji('好耶') && !worthKaomoji('啊'.repeat(200))) ok('长句不补颜文字');
else bad('长度判断不对');

// 7. decideExtras 支持 kaomoji
const cfg = { role: { expression: { enabled: true, stickerChance: 0, faceChance: 0, kaomojiChance: 1 } } };
const plan = decideExtras({ text: '好耶', mood: 2, cfg, rng: () => 0 });
if (plan.kaomoji === true) ok('decideExtras 会安排颜文字');
else bad('decideExtras 没安排：' + JSON.stringify(plan));

const plan2 = decideExtras({ text: '好耶', mood: 2, cfg: { role: { expression: { kaomojiChance: 0 } } }, rng: () => 0 });
if (plan2.kaomoji === false) ok('概率 0 时不安排');
else bad('概率 0 仍安排：' + JSON.stringify(plan2));

const plan3 = decideExtras({ text: '好耶', mood: 2, cfg: { role: { expression: { enabled: false, kaomojiChance: 1 } } }, rng: () => 0 });
if (plan3.kaomoji === false) ok('总开关关闭时不安排');
else bad('总开关没生效：' + JSON.stringify(plan3));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
