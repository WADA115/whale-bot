// 统一的 chat 调用：给 gate/判断器/识图共用，不把 key 写进日志。
export async function callChat({ baseURL, apiKey, model, system, user, maxTokens = 400, temperature = 0, timeoutMs = 15000, images = [] } = {}) {
  if (!apiKey) throw new Error('no-api-key');
  const content = Array.isArray(images) && images.length
    ? [
      { type: 'text', text: String(user ?? '') },
      ...images.slice(0, 3).map((b64) => ({ type: 'image_url', image_url: { url: String(b64) } }))
    ]
    : String(user ?? '');
  const res = await fetch(`${String(baseURL).replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
      max_tokens: maxTokens,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error('http ' + res.status);
  const json = await res.json();
  const msg = json?.choices?.[0]?.message ?? {};
  return { content: String(msg.content ?? ''), reasoning: String(msg.reasoning_content ?? '') };
}

/**
 * 本地 Ollama 原生接口。比 OpenAI 兼容层更可靠：
 * - Qwen3 的 thinking 单独放在 message.thinking，正文在 message.content
 * - 视觉图片用 images: [base64]，不要 data: 前缀
 */
export async function callOllama({
  baseURL = 'http://127.0.0.1:11434',
  model,
  system = '',
  user,
  images = [],
  maxTokens = 400,
  temperature = 0.3,
  timeoutMs = 60000,
  numCtx = 8192
} = {}) {
  if (!model) throw new Error('no-local-model');
  const endpoint = `${String(baseURL).replace(/\/+$/, '').replace(/\/v1$/, '')}/api/chat`;
  const noThink = /^qwen3/i.test(String(model)) && !/no_think/i.test(String(system ?? ''));
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: String(system) + (noThink ? '\n/no_think' : '') }] : []),
      { role: 'user', content: String(user ?? ''), ...(Array.isArray(images) && images.length ? { images: images.slice(0, 3) } : {}) }
    ],
    stream: false,
    options: { num_ctx: numCtx, num_predict: maxTokens, temperature }
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('local http ' + res.status + (detail ? ': ' + detail.slice(0, 200) : ''));
  }
  const json = await res.json();
  return {
    content: String(json?.message?.content ?? '').trim(),
    reasoning: String(json?.message?.thinking ?? '')
  };
}

/** 本地 embedding（bge-m3）。input 可以是字符串或字符串数组。 */
export async function callOllamaEmbed({
  baseURL = 'http://127.0.0.1:11434',
  model = 'bge-m3',
  input,
  timeoutMs = 30000
} = {}) {
  const texts = Array.isArray(input) ? input.map(String) : [String(input ?? '')];
  if (!texts.length) return [];
  const endpoint = `${String(baseURL).replace(/\/+$/, '').replace(/\/v1$/, '')}/api/embed`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error('local embed http ' + res.status);
  const json = await res.json();
  const list = Array.isArray(json?.embeddings) ? json.embeddings : [];
  return list.map((v) => (Array.isArray(v) ? v.map(Number) : []));
}
