// 出站内容审核：机器人要说的话，先过一遍规则再发。
//
// 定位：这是"最后一道闸"，不是审核员。只拦明显会惹麻烦的类别
// （违法交易、诈骗赌博、色情、暴力威胁、涉政敏感），正常吐槽/脏话不拦。
//
// 设计取舍：
//   · 规则用正则可配置（config.safety.blockPatterns），默认内置一批保守规则；
//   · 命中就替换成一句拒绝话术，并把原文写进日志（含脱敏），便于事后复盘；
//   · 支持 allowPatterns 白名单（比如"杀时间""笑死"这类词不该被拦）。
export const DEFAULT_BLOCK_PATTERNS = [
  { id: 'drug', label: '毒品', re: /(冰毒|海洛因|摇头丸|麻古|K粉|大麻交易|买点货)/ },
  { id: 'gamble', label: '赌博', re: /(网赌|赌博网站|百家乐|六合彩|代下注|洗码)/ },
  { id: 'fraud', label: '诈骗', re: /(刷单|跑分|洗钱|代收款|银行卡四件套|接码|杀猪盘|内幕消息.*稳赚)/ },
  { id: 'porn', label: '色情', re: /(约炮|裸聊|成人视频.*下载|色情网站|黄片)/ },
  { id: 'weapon', label: '违禁品', re: /(枪支|弹药|雷管|管制刀具.*购买|炸药配方)/ },
  { id: 'threat', label: '威胁', re: /(杀了你|弄死你|砍死你|炸死你|人肉你)/ },
  { id: 'sensitive', label: '敏感', re: /(推翻政府|颠覆国家|分裂国家|恐怖袭击)/ }
];

const DEFAULT_ALLOW = [/杀时间/, /笑死/, /杀死比赛/, /打游戏/, /爆头.*游戏/];

function compileUserPatterns(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const src = typeof item === 'string' ? item : item?.re;
    if (!src) continue;
    try {
      out.push({ id: (item && item.id) || 'custom', label: (item && item.label) || '自定义', re: new RegExp(src, 'i') });
    } catch {}
  }
  return out;
}

export function createContentFilter(config = {}) {
  const disabled = config.enabled === false;
  const patterns = [...DEFAULT_BLOCK_PATTERNS, ...compileUserPatterns(config.blockPatterns)];
  const allowList = [...DEFAULT_ALLOW, ...compileUserPatterns(config.allowPatterns).map((p) => p.re)];

  /**
   * @returns {{ok: boolean, reason?: string, label?: string, hit?: string}}
   */
  function check(text) {
    if (disabled) return { ok: true };
    const s = String(text ?? '');
    if (!s.trim()) return { ok: true };
    if (allowList.some((re) => re.test(s))) return { ok: true };
    for (const p of patterns) {
      const m = s.match(p.re);
      if (m) return { ok: false, reason: p.id, label: p.label, hit: m[0].slice(0, 20) };
    }
    return { ok: true };
  }

  /** 拦截后用哪句话顶替。 */
  function refusal(configRefusal) {
    return String(configRefusal || config.refusal || '这个我不说。');
  }

  return { check, refusal, patterns };
}
