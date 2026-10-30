import fs from 'node:fs';
import path from 'node:path';
import { readSecret } from '../secrets.js';

const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_TIMEOUT = 30000;

export function loadToolsConfig(root = process.cwd()) {
  let raw = {};
  try {
    const text = fs.readFileSync(path.join(root, 'config.json'), 'utf8');
    const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    raw = parsed?.webSearch && typeof parsed.webSearch === 'object' ? parsed.webSearch : {};
  } catch {}
  return {
    apiKey: String(raw.apiKey || process.env[raw.apiKeyEnv || 'DEEPSEEK_API_KEY'] || readSecret(root) || '').trim(),
    baseURL: String(raw.baseURL || DEFAULT_BASE).replace(/\/+$/, ''),
    timeoutMs: Math.max(5000, Math.min(120000, Number(raw.timeoutMs) || DEFAULT_TIMEOUT))
  };
}

async function postJson(url, body, { apiKey, timeoutMs }) {
  if (!apiKey) throw new Error('no DeepSeek API key');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(text);
      detail = String(parsed?.error?.message || parsed?.error || '').slice(0, 200);
    } catch {}
    const error = new Error(`deepseek tools HTTP ${res.status}${detail ? ': ' + detail : ''}`);
    error.status = res.status;
    throw error;
  }
  try { return JSON.parse(text); } catch { throw new Error('deepseek tools bad JSON'); }
}

export function normalizeSearchResults(data, limit = 10) {
  const list = Array.isArray(data?.results) ? data.results : [];
  return list.slice(0, Math.max(1, Math.min(50, Number(limit) || 10))).map((r) => ({
    title: String(r?.title ?? '').trim(),
    url: String(r?.url ?? '').trim(),
    snippet: String(r?.snippet ?? '').trim(),
    summary: String(r?.summary ?? '').trim(),
    content: String(r?.content ?? '').trim(),
    score: Number(r?.rerank_score) || 0,
    authority: Number(r?.authority) || 0,
    date: r?.date ?? null,
    siteName: r?.site_name ?? ''
  })).filter((r) => r.url);
}

export async function searchWeb(query, { count = 10, needContent = true, config = loadToolsConfig() } = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('query 为空');
  if (q.length > 128) throw new Error('query 超过 128 字');
  const body = {
    query: q,
    count: Math.max(1, Math.min(50, Number(count) || 10)),
    need_content: needContent === true
  };
  const data = await postJson(`${config.baseURL}/tools/search`, body, config);
  return normalizeSearchResults(data, count);
}

export async function fetchPage(url, { config = loadToolsConfig() } = {}) {
  const target = new URL(String(url ?? ''));
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('只允许 http/https');
  if (target.username || target.password) throw new Error('URL 不能含凭据');
  const data = await postJson(`${config.baseURL}/tools/fetch`, { url: target.toString() }, config);
  return { title: String(data?.title ?? '').trim(), content: String(data?.content ?? '').trim(), url: target.toString() };
}
