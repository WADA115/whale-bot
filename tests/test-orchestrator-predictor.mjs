// 规则版预测器测试
import { predictRoute } from '../src/orchestrator/predictor.js';

let pass = 0; let fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass += 1; };
const bad = (m) => { console.log('  ❌ ' + m); fail += 1; };
const cfg = { role: { groupNameKeywords: ['鱼鱼'] } };

const ack = predictRoute({ event: { text: '666' }, cfg });
if (ack.route === 'flash' && ack.difficulty === 'easy' && ack.needThink === false) ok('666 → flash');
else bad('666 异常：' + JSON.stringify(ack));

const q = predictRoute({ event: { text: '这个怎么弄？' }, cfg });
if (q.route === 'pro' && q.intent === 'answer_question') ok('问题 → pro');
else bad('问题异常：' + JSON.stringify(q));

const mem = predictRoute({ event: { text: '你上次答应我的事呢' }, cfg });
if (mem.route === 'pro' && mem.difficulty === 'hard' && mem.risk.grounding >= 0.5) ok('记忆 → hard/pro');
else bad('记忆异常：' + JSON.stringify(mem));

const named = predictRoute({ event: { text: '鱼鱼在吗' }, cfg });
if (named.intent === 'addressed' && named.route === 'pro') ok('叫名字 → pro');
else bad('叫名字异常：' + JSON.stringify(named));

const empty = predictRoute({ event: { text: '' }, cfg });
if (empty.route === 'flash' && empty.intent === 'ignore') ok('空 → flash');
else bad('空异常：' + JSON.stringify(empty));

const multi = predictRoute({ event: { text: '为什么？怎么办？' }, cfg });
if (multi.route === 'pro' && multi.risk.ambiguity >= 0.6) ok('多问题 → pro');
else bad('多问题异常：' + JSON.stringify(multi));

console.log('\n' + (fail ? `❌ ${fail} 项失败` : `✅ ${pass} 项全部通过`));
process.exit(fail ? 1 : 0);
