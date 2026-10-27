// 验证记忆提取提示词：给一轮对话，看模型吐不吐合法 JSON。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'config.json'), 'utf8'));
const key = cfg.webSearch?.apiKey || process.env.DEEPSEEK_API_KEY || '';

// 没有 API key 就跳过：这个测试要调真实模型，缺 key 时不算失败
if (!key) {
  console.log('  没有 API key，跳过');
  process.exit(0);
}
const baseURL = 'https://api.deepseek.com/v1';
const model = 'deepseek-flash';

const sys = '你负责维护一个 QQ 机器人的长期记忆。'
  + '从下面这轮对话里，提取「以后还用得上」的信息：对方的事实/身份/偏好、明确的要求或约定、群里反复出现的黑话或梗。'
  + '只输出 JSON 数组，不要任何解释、不要代码块。元素两种形式：'
  + '{"type":"fact","text":"一句话事实"} 或 {"type":"keyword","word":"词","meaning":"含义/用法"}。'
  + '没有值得记的就输出 []。最多 3 条，宁缺毋滥，别把寒暄和一次性信息记下来。';

const cases = [
  ['对方说：我是 阿明，这个号是我主号，小号在跑机器人\n机器人回：知道了', '真实身份'],
  ['对方说：以后别叫我大肥鱼，我不喜欢\n机器人回：行吧', '偏好'],
  ['对方说：难绷，这他妈也行\n机器人回：草', '黑话'],
  ['对方说：今天几点\n机器人回：三点', '一次性信息（应输出 []）'],
];

for (const [turn, label] of cases) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: turn }],
      max_tokens: 800,
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(25000)
  });
  const j = await res.json();
  const msg = j?.choices?.[0]?.message ?? {};
  let raw = String(msg.content ?? '').trim();
  const fromReasoning = raw ? '' : (String(msg.reasoning_content ?? '').match(/\[[\s\S]*\]/)?.[0] ?? '');
  const text = raw || fromReasoning;
  let parsed = null;
  try {
    const s = text.indexOf('['); const e = text.lastIndexOf(']');
    parsed = s >= 0 && e > s ? JSON.parse(text.slice(s, e + 1)) : null;
  } catch {}
  console.log(`  ${label.padEnd(18, ' ')} → ${parsed ? JSON.stringify(parsed) : `(解析失败) ${text.slice(0, 80)}`}  [tokens ${j?.usage?.total_tokens ?? '?'}]`);
}
