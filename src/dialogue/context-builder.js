// 对话上下文：把线程、记忆、群聊最近消息、黑话、情绪拼成 evidence。
export function createDialogueContext({
  threadStore, buildContextBlock, buildSlangContext, getSlangEntries,
  moodFor, cfg
} = {}) {
  function build(key, injection = null) {
    return {
      recall: () => {
        const snap = threadStore.snapshot(key);
        let block = '';
        try { block = buildContextBlock(key) || ''; } catch {}
        let slang = '';
        try { slang = buildSlangContext(getSlangEntries(), cfg.slang?.injectMax ?? 8) || ''; } catch {}
        const parts = [
          injection?.memory,
          injection?.recall,
          injection?.context,
          injection?.mood,
          injection?.emotion,
          slang,
          block
        ].filter(Boolean);
        const lines = parts.join('\n').split('\n').map((x) => x.trim()).filter(Boolean);
        return {
          lines: lines.slice(-80),
          evidence: [
            ...(snap.events ?? []).map((e) => `${e.sender?.name ?? ''}：${e.text ?? ''}`),
            injection?.context,
            injection?.memory,
            injection?.recall,
            ...(Array.isArray(injection?.knowledgeEvidence) ? injection.knowledgeEvidence : []),
            block
          ].filter(Boolean),
          facts: [],
          commitments: []
        };
      },
      appraise: () => {
        try {
          const m = moodFor(key);
          return { label: m.label(), valence: 0, arousal: 0.3, prompt: injection?.emotion || '' };
        } catch {
          return { label: '平静', valence: 0, arousal: 0.3, prompt: injection?.emotion || '' };
        }
      }
    };
  }
  return { build };
}
