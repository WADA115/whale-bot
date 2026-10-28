// 检查更新：解析 GitHub Releases，比较版本号。
//
// 纯函数，供 /api/update/check 和测试共用；不发起网络请求（请求在 app.js 里做）。

/** 版本号比较：a > b 返回 1，相等 0，小于 -1。支持 v1.2.3 / 1.2.3-r1。 */
export function compareVersions(a, b) {
  const norm = (v) => String(v ?? '')
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const A = norm(a);
  const B = norm(b);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i += 1) {
    const x = A[i] ?? 0;
    const y = B[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * 解析 GitHub release JSON。
 * @returns {{latest:string, tag:string, url:string, name:string, notes:string, publishedAt:string}|null}
 */
export function parseRelease(release) {
  if (!release || typeof release !== 'object') return null;
  const tag = String(release.tag_name ?? '').trim();
  const latest = tag.replace(/^v/i, '');
  const url = String(release.html_url ?? '').trim();
  if (!latest || !url) return null;
  return {
    latest,
    tag,
    url,
    name: String(release.name ?? tag).slice(0, 80),
    notes: String(release.body ?? '').slice(0, 600),
    publishedAt: String(release.published_at ?? '')
  };
}

/** 结合本地版本给出结论。 */
export function buildUpdateResult(currentVersion, release) {
  const parsed = parseRelease(release);
  const current = String(currentVersion ?? '').replace(/^v/i, '') || '0.0.0';
  if (!parsed) {
    return { ok: true, current, latest: '', updateAvailable: false, error: '没有可用的发布信息' };
  }
  return {
    ok: true,
    current,
    latest: parsed.latest,
    updateAvailable: compareVersions(parsed.latest, current) > 0,
    url: parsed.url,
    name: parsed.name,
    notes: parsed.notes,
    publishedAt: parsed.publishedAt
  };
}
