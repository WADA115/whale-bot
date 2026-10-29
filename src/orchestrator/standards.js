// 四标准闸门：不编造 / 逻辑不冲突 / 思维不混乱 / 自主表达。
// 默认全部本地规则；只有本地规则拿不准时才应交给模型（由调用方决定）。

const HEDGES = /(可能|好像|也许|大概|记不清|不确定|如果我没记错|似乎)/;
const MEMORY_MARKERS = /(你(之前|上次|昨天|前天|说过|答应|提过)|我记得|上次|之前说|答应过)/;
const FACTUAL = /(\d{4}年|\d{1,2}月|\d{1,2}日|\d+点|昨天|今天|明天|上次|之前|答应|承诺)/;
const NEGATION = /(不|没|别|并非|不是)/;

function bigrams(text) {
  const s = String(text ?? '').replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

function overlap(a, b) {
  const A = bigrams(a); const B = bigrams(b);
  let n = 0;
  for (const x of A) if (B.has(x)) n += 1;
  return n;
}

function sentences(text) {
  return String(text ?? '').split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter(Boolean);
}

/** 不编造：事实性句子必须有证据或明确 hedge。 */
export function checkGrounding({ draft = '', evidence = [] } = {}) {
  const evidenceText = Array.isArray(evidence) ? evidence.join('\n') : String(evidence ?? '');
  const violations = [];
  for (const s of sentences(draft)) {
    if (!(MEMORY_MARKERS.test(s) || FACTUAL.test(s))) continue;
    if (HEDGES.test(s)) continue;
    if (!evidenceText.trim() || overlap(s, evidenceText) < 2) violations.push(s);
  }
  return { pass: violations.length === 0, violations, checked: 'grounding' };
}

/** 逻辑不冲突：与已知事实/承诺不能正反打架。 */
export function checkConsistency({ draft = '', facts = [], commitments = [] } = {}) {
  const violations = [];
  const known = [...facts, ...commitments].map(String).filter(Boolean);
  for (const s of sentences(draft)) {
    for (const k of known) {
      if (overlap(s, k) < 3) continue;
      const draftNeg = NEGATION.test(s);
      const factNeg = NEGATION.test(k);
      if (draftNeg !== factNeg && overlap(s, k) >= 3) {
        violations.push({ sentence: s, conflictsWith: k });
      }
    }
  }
  return { pass: violations.length === 0, violations, checked: 'consistency' };
}

/** 思维不混乱：一个主意图、要点不超、问题不超、气泡不超。 */
export function checkClarity({ draft = '', thought = {}, plan = null } = {}) {
  const violations = [];
  const messages = Array.isArray(plan?.messages) ? plan.messages : (draft ? [draft] : []);
  if (messages.length > 3) violations.push('气泡超过 3 条');
  const keyPoints = Array.isArray(thought?.keyPoints) ? thought.keyPoints : [];
  if (keyPoints.length > 4) violations.push('要点超过 4 条');
  const questions = messages.join(' ').match(/[?？]/g)?.length ?? 0;
  if (questions > 1) violations.push('一次问了多个问题');
  if (!thought?.intent) violations.push('缺少主意图');
  const all = messages.join(' ');
  if (all.length > 220) violations.push('总长度超过 220 字');
  return { pass: violations.length === 0, violations, checked: 'clarity' };
}

/** 自主表达：主动必须带驱动、理由、预算；被动回复直接通过。 */
export function checkAutonomy({ decision = {} } = {}) {
  const violations = [];
  if (decision.action === 'initiate' || decision.action === 'interject') {
    if (!decision.drive) violations.push('主动缺少 drive');
    if (!decision.reason) violations.push('主动缺少 reason');
    if (decision.budget && Number(decision.budget.remaining) <= 0) violations.push('主动预算已用尽');
  }
  return { pass: violations.length === 0, violations, checked: 'autonomy' };
}

export function checkStandards({ draft = '', thought = {}, plan = null, evidence = [], facts = [], commitments = [], decision = {} } = {}) {
  const results = [
    checkGrounding({ draft, evidence }),
    checkConsistency({ draft, facts, commitments }),
    checkClarity({ draft, thought, plan }),
    checkAutonomy({ decision })
  ];
  const violations = results.flatMap((r) => r.violations.map((v) => ({ standard: r.checked, detail: v })));
  return { pass: violations.length === 0, results, violations };
}
