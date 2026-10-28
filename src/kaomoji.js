// 颜文字：按心情/句子挑一个，和表情包一样属于「补一刀」的表达。
//
// 设计目标和表情包一致：
//   · 有概率、有冷却、不刷屏
//   · 挑不到合适的就不发
//   · 纯文本，不依赖任何 CDN，一定发得出去

const KAOMOJI = {
  happy: ['(๑•̀ㅂ•́)و✧', '(≧▽≦)', 'ヽ(✿ﾟ▽ﾟ)ノ', '(*´▽`*)', '(๑>ᴗ<๑)', 'ヾ(≧▽≦*)o'],
  love: ['(♡˙︶˙♡)', '(´,,•ω•,,)♡', '(*/ω＼*)', '(灬ºωº灬)♡'],
  sad: ['(╥﹏╥)', '(｡•́︿•̀｡)', '(个_个)', '(´；ω；`)'],
  angry: ['(╬ Ò﹏Ó)', '(#`Д´)', 'ヽ(`Д´)ﾉ', '(￣^￣)'],
  confused: ['(・_・;)', '(￣▽￣;)', '(°ー°〃)', '(・・?)'],
  proud: ['(￣▽￣)ノ', '(*￣︶￣)', '(⌐■_■)', '(๑•̀ㅁ•́๑)✧'],
  tired: ['(￣o￣) zzZ', '(´-ω-`)', '(=_=)', '(－_－) zzZ'],
  cute: ['(๑´ㅂ`๑)', '(=^･ω･^=)', '(๑•́ ₃ •̀๑)', 'ʕ•ᴥ•ʔ']
};

const RULES = [
  { cat: 'love', words: ['喜欢', '爱你', '想你', '抱抱', '亲亲', '心动', '可爱', '萌'] },
  { cat: 'sad', words: ['难过', '伤心', '哭', '委屈', '崩', '寄', '唉', '呜呜', '累'] },
  { cat: 'angry', words: ['气', '烦', '讨厌', '滚', '怒', '无语', '服了', '醉了'] },
  { cat: 'confused', words: ['？', '?', '啊', '啥', '为什么', '不懂', '懵', '离谱'] },
  { cat: 'proud', words: ['厉害', '牛', '强', '赢了', '搞定', '当然', '必须'] },
  { cat: 'tired', words: ['困', '睡', '熬夜', '加班', '累死'] },
  { cat: 'happy', words: ['哈哈', '笑', '开心', '好耶', '棒', '耶', '好'] }
];

const ALL = Object.values(KAOMOJI).flat();

function moodCat(mood) {
  if (mood >= 3) return 'happy';
  if (mood <= -3) return 'sad';
  return null;
}

/**
 * 挑一个颜文字。
 * @param {{text?:string, mood?:number, exclude?:string[], random?:()=>number}} p
 */
export function pickKaomoji({ text = '', mood = 0, exclude = [], random = Math.random } = {}) {
  const s = String(text ?? '');
  let pool = [];

  for (const rule of RULES) {
    if (rule.words.some((w) => s.includes(w))) {
      pool = KAOMOJI[rule.cat] ?? [];
      break;
    }
  }
  if (!pool.length) {
    const cat = moodCat(Number(mood) || 0);
    pool = cat ? KAOMOJI[cat] : [];
  }
  if (!pool.length) pool = ALL;

  const skip = new Set((exclude ?? []).filter(Boolean));
  const candidates = pool.filter((k) => !skip.has(k));
  const list = candidates.length ? candidates : pool;
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)] ?? null;
}

/** 是不是「适合补颜文字」的短句（太长就别加了，会显得闹）。 */
export function worthKaomoji(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  return s.length <= 60;
}

export const KAOMOJI_COUNT = ALL.length;
