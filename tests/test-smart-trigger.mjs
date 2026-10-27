// 体测「群聊是不是在跟我说话」判断器的准确度与成本。
// 用法: node test-smart-trigger.mjs <repo 目录>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'config.json'), 'utf8'));
const key = cfg.role?.smartTrigger?.apiKey || cfg.webSearch?.apiKey || process.env.DEEPSEEK_API_KEY || '';
const baseURL = (cfg.role?.smartTrigger?.baseURL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
const model = cfg.role?.smartTrigger?.model || 'deepseek-flash';

// 没有 key 或没网时直接跳过：这个脚本是要真调模型的，不属于离线单测
if (!key) {
  console.log('跳过（需要 API key）：设 DEEPSEEK_API_KEY 或配置 role.smartTrigger.apiKey 后再跑');
  process.exit(0);
}

const sys = `你在帮一个 QQ 群机器人「小鲸鱼」判断：群里最新这条消息，是不是在跟它说话、或者在等它回应。
最后只输出一个字：是 或 否。
判断要点：
- 明确叫了「小鲸鱼」或它的别名 → 是
- 在追问它刚说过的话、或明显接着它开的头 → 是
- 群里只有一两个人在说话、像是随手抛给群里的话（"你在干嘛""说话啊""这个怎么看"）→ 是
- 明确在跟某个群友对话（点名了别人、或明显在回答别人的问题）→ 否
- 两个人明显在一问一答、内容与机器人无关（约时间、聊别的游戏）→ 否
- 纯表情、图片、刷屏、无意义字符 → 否
- 只有明显是别人之间的私聊内容时才判 否；轻微不确定倾向判 是（宁可多接一句，也不要像没听见）`;

async function judge(history, line) {
  const user = `${history ? `最近群聊：\n${history}\n\n` : ''}最新一条 — ${line}`;
  const t0 = Date.now();
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      max_tokens: 300,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  const msg = j?.choices?.[0]?.message ?? {};
  let ans = String(msg.content ?? '').trim();
  if (!ans) {
    const hit = String(msg.reasoning_content ?? '').match(/(?:回答|输出|结论|答案)[^是no]{0,12}(是|否)/);
    ans = hit ? hit[1] : '(空)';
  }
  return `${ans}  (${Date.now() - t0}ms, tokens=${j?.usage?.total_tokens ?? '?'})`;
}

const history = '小鲸鱼: 在的\n阿伟: 今天几点吃饭\n小鲸鱼: 随便';

const cases = [
  ['闲聊(别人话题)', '阿伟: 我昨天买了个键盘'],
  ['随手抛一句', '阿伟: 你在干嘛'],
  ['催话', '阿伟: 说话啊'],
  ['约时间(别人之间)', '阿伟: 小红你几点到'],
  ['追问机器人', '阿伟: 你怎么半天不说话'],
  ['叫名字', '阿伟: 小鲸鱼你说呢'],
  ['纯表情', '阿伟: [表情包:笑死]'],
  ['接着它的话', '阿伟: 随便也太随便了'],
];

for (const [label, line] of cases) {
  try {
    console.log(`  ${label.padEnd(12, ' ')} → ${await judge(history, line)}`);
  } catch (error) {
    console.log(`  ${label.padEnd(12, ' ')} → 失败: ${error?.message ?? error}`);
  }
}
