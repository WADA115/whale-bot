// 自主判断：这句话值不值得记住、记成什么层级。
//
// 只做判断，不写任何文件。调用方（桥接）拿结果去 memory.addFact，
// 因此**永远不会**碰设定（settings）和人格卡（roles/）。
//
// 判断是纯本地的（不调模型、不花 token）：先排除寒暄/提问/广告，再按线索打分。

const RE = {
  // 身份类：值得长期记
  identity: /我叫|我是[^，。]{1,12}$|我住在|我来自|我在[^，。]{1,12}(上班|工作|上学|读书)|我家(有|养)|我养了|我的(猫|狗|仓鼠|乌龟)/,
  // 偏好类：长期
  preference: /我喜欢|我讨厌|我最爱|我爱吃|我不吃|我习惯|我每天|我通常|我一般会|我看不惯/,
  // 约定/要求：长期
  commitment: /以后都|以后别|下次(记得|别)|记住|帮我记|提醒我|约定|说好了/,
  // 事实类：短期即可
  fact: /今天|昨天|明天|刚才|最近|这周|下周|考试|加班|出差|生病|感冒|搬家|换工作/,
  // 明显不该记
  chatter: /^(你好|在吗|早|晚安|哈+|嗯+|哦+|好的?|收到|谢谢|没事|拜拜)[呀啊哦。！!？?]*$/,
  question: /[?？]$|吗[?？。]?$|呢[?？。]?$|什么|怎么|为什么|哪[里个]/
};

const NOISE = /广告|代练|加微信|扫码|优惠券|点击链接|充值返利/;

/**
 * @param {string} text 用户说的话
 * @returns {{remember:boolean, tier:'long'|'short', text:string, reason:string}}
 */
export function judge(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const no = (reason) => ({ remember: false, tier: 'short', text: '', reason });

  if (!raw) return no('空消息');
  if (raw.length < 4) return no('太短');
  if (raw.length > 300) return no('太长');
  if (NOISE.test(raw)) return no('像广告');
  if (chatterSafe(raw)) return no('寒暄');
  if (RE.question.test(raw)) return no('提问，不是陈述');

  // 身份/偏好/约定 → 长期；一般事实 → 短期
  let tier = 'short';
  let reason = '';
  if (RE.identity.test(raw)) { tier = 'long'; reason = '身份信息'; }
  else if (RE.preference.test(raw)) { tier = 'long'; reason = '偏好'; }
  else if (RE.commitment.test(raw)) { tier = 'long'; reason = '约定/要求'; }
  else if (RE.fact.test(raw)) { tier = 'short'; reason = '近期事实'; }
  else return no('没看出值得记的线索');

  // 去掉明显的语气词前缀，保留一句完整陈述
  const cleaned = raw
    .replace(/^(那个|就是|其实|对了|话说|然后)[，,]?/, '')
    .replace(/[~～]+/g, '')
    .slice(0, 120)
    .trim();
  if (cleaned.length < 4) return no('清洗后太短');

  return { remember: true, tier, text: cleaned, reason };
}

function chatterSafe(text) {
  return RE.chatter.test(text.replace(/[~～。！!]/g, ''));
}

/** 给面板/日志用的一句话解释。 */
export function explain(result) {
  if (!result?.remember) return '不记：' + (result?.reason ?? '');
  return '记住（' + (result.tier === 'long' ? '长期' : '短期') + '，' + result.reason + '）：' + result.text;
}
