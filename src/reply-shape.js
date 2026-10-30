// 回复形态（气泡数 / 单条字数 / 条间间隔）：统一钳制，避免配置写坏把机器人变成刷屏机。
//
// 默认值 = 现有行为（closed-agent 分支：最多 5 条、单条 40 字、间隔 600~1400ms），
// 所以不配置时行为完全不变。

export const REPLY_LIMITS = {
  maxBubbles: { min: 1, max: 20 },
  maxChars: { min: 10, max: 300 },
  gapMinMs: { min: 200, max: 15000 },
  gapMaxMs: { min: 200, max: 15000 }
};

export const REPLY_DEFAULTS = {
  maxBubbles: 8,
  maxChars: 40,
  gapMinMs: 600,
  gapMaxMs: 1400
};

const clamp = (value, { min, max }, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * 从配置里取出回复形态并钳制到安全范围。
 * 兼容两种写法：role.reply.* 与 socialV2.send.*
 */
export function normalizeReplyShape(cfg = {}) {
  const reply = cfg.role?.reply ?? {};
  const send = cfg.socialV2?.send ?? {};

  const maxBubbles = clamp(
    reply.bubblesMax ?? send.burstMaxMessages,
    REPLY_LIMITS.maxBubbles,
    REPLY_DEFAULTS.maxBubbles
  );
  const maxChars = clamp(
    reply.bubbleMaxChars ?? send.maxReplyChars,
    REPLY_LIMITS.maxChars,
    REPLY_DEFAULTS.maxChars
  );
  const gapMinMs = clamp(
    reply.gapMinMs ?? send.burstIntervalMinMs,
    REPLY_LIMITS.gapMinMs,
    REPLY_DEFAULTS.gapMinMs
  );
  const gapMaxMs = Math.max(
    gapMinMs,
    clamp(reply.gapMaxMs ?? send.burstIntervalMaxMs, REPLY_LIMITS.gapMaxMs, REPLY_DEFAULTS.gapMaxMs)
  );

  return { maxBubbles, maxChars, gapMinMs, gapMaxMs };
}

/** 条间随机间隔（最后一条之后不该再等，由调用方控制）。 */
export function pickGapMs({ gapMinMs, gapMaxMs }, random = Math.random) {
  const min = Math.max(0, Number(gapMinMs) || 0);
  const max = Math.max(min, Number(gapMaxMs) || min);
  return min + Math.floor(random() * (max - min + 1));
}
