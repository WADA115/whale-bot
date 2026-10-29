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
