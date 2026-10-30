// 语音发送预算：按会话分钟/小时限流。
export function createVoiceBudget({ now = () => Date.now() } = {}) {
  const times = new Map();

  function check(scopeKey, cfgV) {
    const at = now();
    const bucket = times.get(scopeKey) ?? [];
    const inMinute = bucket.filter((t) => at - t < 60000);
    const inHour = bucket.filter((t) => at - t < 3600000);
    if (cfgV.maxPerMinute > 0 && inMinute.length + 1 > cfgV.maxPerMinute) {
      throw new Error(`语音发送频率超限（每分钟最多 ${cfgV.maxPerMinute} 条），请稍后再试`);
    }
    if (cfgV.maxPerHour > 0 && inHour.length + 1 > cfgV.maxPerHour) {
      throw new Error(`语音发送频率超限（每小时最多 ${cfgV.maxPerHour} 条），请稍后再试`);
    }
  }

  function commit(scopeKey, at = now()) {
    const bucket = (times.get(scopeKey) ?? []).filter((t) => at - t < 3600000);
    bucket.push(at);
    times.set(scopeKey, bucket);
  }

  return { check, commit };
}
