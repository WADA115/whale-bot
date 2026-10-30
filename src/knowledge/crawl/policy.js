import { URL } from 'node:url';

const ALLOWED_HOSTS = new Set([
  'api.bilibili.com',
  'www.bilibili.com',
  'tieba.baidu.com',
  'www.baidu.com'
]);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

let lastAt = 0;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertAllowed(urlString) {
  const url = new URL(String(urlString));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('host not allowed: ' + url.hostname);
  return url;
}

export async function politeFetch(url, { headers = {}, timeoutMs = 15000, minGapMs = 2000 } = {}) {
  assertAllowed(url);
  const wait = Math.max(0, minGapMs - (Date.now() - lastAt));
  if (wait) await sleep(wait);
  lastAt = Date.now();
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json,text/html;q=0.9,*/*;q=0.8', ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res;
}

export async function fetchJson(url, opts = {}) {
  const res = await politeFetch(url, { ...opts, headers: { referer: 'https://www.bilibili.com/', ...(opts.headers ?? {}) } });
  return res.json();
}

export async function fetchText(url, opts = {}) {
  const res = await politeFetch(url, opts);
  return res.text();
}

export function stripHtml(text) {
  return String(text ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
