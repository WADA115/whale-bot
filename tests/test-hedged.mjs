import { parseTransaction, raceTransactions } from '../src/dialogue/hedged.js';

let pass = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); process.exitCode = 1; } };

const tx = parseTransaction('{"action":"reply","messages":["a","b"],"reasoning":"内部","confidence":0.8}');
ok('parse reply', tx?.action === 'reply' && tx.messages.length === 2 && tx.reasoning === '内部');
ok('reasoning 不混入 messages', !tx.messages.includes('内部'));
const skip = parseTransaction('{"action":"skip","messages":[],"reasoning":"不想回"}');
ok('parse skip', skip?.action === 'skip' && skip.messages.length === 0);
const withState = parseTransaction('{"action":"reply","messages":["a"],"evidence":["知识1"],"state_patch":{"tone":"playful","open_questions":["q1"],"memory_candidates":["m1"]}}');
ok('state_patch/evidence', withState?.state_patch?.tone === 'playful' && withState.evidence[0] === '知识1');
ok('invalid 拒绝', parseTransaction('not json') === null);
const truncated = parseTransaction('{"action":"reply","messages":["第一句","第二句"');
ok('截断 JSON 修复', truncated?.messages?.length === 2 && truncated.messages[0] === '第一句');
const escaped = parseTransaction('{"action":"reply","messages":["含\\"引号\\"内容"');
ok('转义字符串修复', escaped?.messages?.[0] === '含"引号"内容');

let loserAborted = false;
const winner = await raceTransactions([
  { name: 'slow', run: async (signal) => { await new Promise((r) => setTimeout(r, 200)); if (signal.aborted) { loserAborted = true; throw new Error('abort'); } return parseTransaction('{"action":"reply","messages":["slow"]}'); } },
  { name: 'fast', run: async () => { await new Promise((r) => setTimeout(r, 10)); return parseTransaction('{"action":"reply","messages":["fast"]}'); } }
]);
ok('先合法者胜出', winner?.name === 'fast' && winner.value.messages[0] === 'fast');
await new Promise((r) => setTimeout(r, 250));
ok('输家被取消', loserAborted === true);

const none = await raceTransactions([
  { name: 'bad', run: async () => null }
]);
ok('全失败返回 null', none === null);

console.log(`\n${pass} 项 hedged 测试通过`);
