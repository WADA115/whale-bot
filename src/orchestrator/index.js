// 中央调度枢纽：一次对话 = 一个事务（当前先覆盖 gate → 思维 → 表达 → 四标准）。
import { evaluateGate } from '../dialogue/gate.js';
import { think } from '../dialogue/thinker.js';
import { speak } from '../dialogue/speaker.js';
import { checkStandards } from './standards.js';
import { predictRoute } from './predictor.js';

function nowMs() { return Date.now(); }

function normalizeRecall(raw) {
  if (!raw) return { lines: [], evidence: [], facts: [], commitments: [] };
  if (typeof raw === 'string') return { lines: [raw], evidence: [raw], facts: [], commitments: [] };
  if (Array.isArray(raw)) return { lines: raw.map(String), evidence: raw.map(String), facts: [], commitments: [] };
  return {
    lines: Array.isArray(raw.lines) ? raw.lines.map(String) : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String) : [],
    facts: Array.isArray(raw.facts) ? raw.facts.map(String) : [],
    commitments: Array.isArray(raw.commitments) ? raw.commitments.map(String) : []
  };
}

function defaultAppraisal(event = {}) {
  const text = String(event.text ?? '');
  const playful = /(哈|笑|梗|草|乐)/.test(text);
  const stressed = /(累|烦|难受|崩|急)/.test(text);
  return {
    label: stressed ? '低落' : playful ? '活跃' : '平静',
    valence: stressed ? -0.3 : playful ? 0.4 : 0,
    arousal: playful ? 0.6 : 0.3
  };
}

function buildExtra(recall, appraisal) {
  const parts = [];
  if (recall.lines.length) parts.push('记忆：\n' + recall.lines.slice(0, 30).join('\n'));
  if (appraisal) parts.push('当前心理：' + JSON.stringify(appraisal));
  return parts.join('\n');
}

export async function orchestrateDialog({ event = {}, thread = {}, roleHint = '', cfg = {}, asks = {}, context = {} } = {}) {
  const startedAt = nowMs();
  const trace = { stages: {}, standards: null, totalMs: 0 };
  trace.prediction = predictRoute({ event, thread, cfg });

  // 直接 @ / 叫名字：跳过 gate，省一次 flash
  const at = Array.isArray(event.at) ? event.at : [];
  const keywords = Array.isArray(cfg.role?.groupNameKeywords) && cfg.role.groupNameKeywords.length
    ? cfg.role.groupNameKeywords : ['小鲸鱼', '鱼鱼'];
  const direct = event.initiative === true || at.includes('你') || keywords.some((k) => k && String(event.text ?? '').includes(k));

  const recallStartedAt = nowMs();
  const gatePromise = direct
    ? Promise.resolve({ candidate: true, reason: '直接叫名字', source: 'rules' })
    : evaluateGate({ event, thread, cfg, ask: asks.gate });

  const [gate, recallRaw, appraisal] = await Promise.all([
    gatePromise,
    (async () => { try { return context.recall ? await context.recall() : null; } catch { return null; } })(),
    (async () => { try { return context.appraise ? await context.appraise() : defaultAppraisal(event); } catch { return defaultAppraisal(event); } })()
  ]);
  const recall = normalizeRecall(recallRaw);
  trace.stages.recallAppraiseMs = nowMs() - recallStartedAt;
  trace.stages.gateMs = nowMs() - recallStartedAt;
  if (!gate.candidate) {
    trace.totalMs = nowMs() - startedAt;
    return { stage: 'gate', gate, plan: null, trace };
  }

  const extraContext = buildExtra(recall, appraisal);
  const thinkStartedAt = nowMs();
  let thought = await think({ event, thread, roleHint, cfg, ask: asks.thinker, extraContext });
  trace.stages.thinkerMs = nowMs() - thinkStartedAt;
  if (event.initiative === true && (!thought || thought.shouldReply !== true)) {
    thought = {
      shouldReply: true,
      target: '群里',
      intent: 'initiate',
      keyPoints: [String(event.initiativeReason || '主动开个话题')],
      constraints: ['自然', '一句话'],
      confidence: 0.7
    };
  }
  if (!thought || thought.shouldReply !== true) {
    trace.totalMs = nowMs() - startedAt;
    return { stage: 'thinker', gate, thought, plan: null, trace };
  }

  const speakStartedAt = nowMs();
  let spoken = await speak({ event, thread, thought, roleHint, cfg, ask: asks.speaker, extraContext });
  trace.stages.speakerMs = nowMs() - speakStartedAt;
  if (!spoken || !spoken.messages?.length) {
    trace.totalMs = nowMs() - startedAt;
    return { stage: 'speaker', gate, thought, spoken, plan: null, trace };
  }

  const draft = spoken.messages.join(' ');
  const eventEvidence = (thread.events ?? []).map((e) => `${e.sender?.name ?? ''}：${e.text ?? ''}`);
  const report = checkStandards({
    draft,
    thought,
    plan: spoken,
    evidence: [...recall.evidence, ...eventEvidence],
    facts: recall.facts,
    commitments: recall.commitments,
    decision: { action: 'reply', reason: 'pipeline' }
  });
  trace.standards = report;

  if (!report.pass && cfg.dialogue?.standardsEnforce !== false) {
    const repairNotes = report.violations.map((v) => `${v.standard}: ${typeof v.detail === 'string' ? v.detail : JSON.stringify(v.detail)}`).join('\n');
    const repairStartedAt = nowMs();
    const repaired = await speak({ event, thread, thought, roleHint, cfg, ask: asks.speaker, extraContext, repairNotes });
    trace.stages.repairMs = nowMs() - repairStartedAt;
    if (repaired?.messages?.length) {
      const recheck = checkStandards({
        draft: repaired.messages.join(' '),
        thought,
        plan: repaired,
        evidence: [...recall.evidence, ...eventEvidence],
        facts: recall.facts,
        commitments: recall.commitments,
        decision: { action: 'reply', reason: 'pipeline-repair' }
      });
      trace.standards = recheck;
      if (recheck.pass) spoken = repaired;
    }
    if (!trace.standards?.pass) {
      trace.totalMs = nowMs() - startedAt;
      return { stage: 'standards', gate, thought, spoken, plan: null, trace };
    }
  }

  trace.totalMs = nowMs() - startedAt;
  return { stage: 'speaker', gate, thought, spoken, plan: spoken, trace, appraisal, recall };
}
