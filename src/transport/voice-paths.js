import fs from 'node:fs';
import path from 'node:path';

export function createVoicePaths({
  root, getCfg, listAudioFiles, resolveAudioSource, safeJoinLibrary, audioExts
} = {}) {
  function voiceCfg() {
    const v = getCfg().socialV2?.voice ?? {};
    return {
      enabled: v.enabled !== false,
      dir: path.resolve(root, String(v.dir ?? 'audio')),
      maxSeconds: Number(v.maxSeconds) > 0 ? Number(v.maxSeconds) : 300,
      maxBytes: Number(v.maxBytes) > 0 ? Number(v.maxBytes) : 20 * 1024 * 1024,
      maxPerMinute: Number(v.maxPerMinute) >= 0 ? Number(v.maxPerMinute) : 2,
      maxPerHour: Number(v.maxPerHour) >= 0 ? Number(v.maxPerHour) : 10,
      allowAbsolutePath: v.allowAbsolutePath === true,
      defaultVolume: Number(v.defaultVolume) > 0 ? Number(v.defaultVolume) : 1,
      loudness: v.loudness || 'normal',
      ffmpegPath: process.env.FFMPEG_PATH || v.ffmpegPath || null,
      autoReadback: v.autoReadback !== false
    };
  }

  function voiceLibrary() {
    const dir = voiceCfg().dir;
    const files = listAudioFiles(dir);
    return files.map((f) => {
      let stat = null;
      try { stat = fs.statSync(f); } catch {}
      return { name: path.relative(dir, f).split(path.sep).join('/'), bytes: stat?.size ?? 0, mtimeMs: stat?.mtimeMs ?? 0 };
    });
  }

  function voicePathInsideLibrary(vc, absPath) {
    const rel = path.relative(vc.dir, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
    return safeJoinLibrary(vc.dir, rel);
  }

  function resolveVoicePathForV2(input) {
    const vc = voiceCfg();
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('缺少音频：给语音库里的文件名（可用 qq_list_voices 查看）');
    if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) throw new Error('语音只接受语音库里的本地文件；不接受 base64://、data: 或 http(s):// 来源');
    const isAbs = path.isAbsolute(raw) || /^file:\/\//i.test(raw) || raw.startsWith('~');
    let resolved = null;
    if (isAbs) {
      const r = resolveAudioSource(raw, {});
      const confined = r.path ? voicePathInsideLibrary(vc, r.path) : null;
      if (confined) resolved = { path: confined, via: `${r.via}+library-confined` };
      else throw new Error(`语音只能从语音库取文件（语音库目录：${path.basename(vc.dir)}）；即使是绝对路径也必须位于语音库之内（socialV2.voice.allowAbsolutePath 已不再放宽 AI 通道）。请把音频放进语音库，或用操作者通道（CLI / 控制台）发送库外文件。`);
    } else {
      const joined = safeJoinLibrary(vc.dir, raw);
      if (joined && fs.existsSync(joined) && fs.statSync(joined).isFile()) resolved = { path: joined, via: 'voice-dir-safe' };
      else if (!path.extname(raw)) {
        for (const ext of audioExts) {
          const cand = safeJoinLibrary(vc.dir, `${raw}${ext}`);
          if (cand && fs.existsSync(cand) && fs.statSync(cand).isFile()) { resolved = { path: cand, via: 'voice-dir-safe+ext' }; break; }
        }
        if (!resolved) {
          const looksLikeEscape = /(^|[\\/])\.\.([\\/]|$)/.test(raw) || path.isAbsolute(raw);
          if (looksLikeEscape) throw new Error('语音只能从语音库取文件：路径里出现了「..」或绝对路径，已拒绝（防止读到库外的本机文件）');
        }
      }
    }
    if (resolved) return { path: resolved.path, via: resolved.via, resolvedFrom: raw };
    const library = voiceLibrary();
    const hint = library.length ? `语音库里现有：${library.slice(0, 12).map((x) => x.name).join('、')}${library.length > 12 ? ` 等 ${library.length} 个` : ''}` : `语音库（${path.basename(vc.dir)}）目前是空的，先把音频文件放进去`;
    const want = path.basename(raw).toLowerCase();
    const wantNoExt = want.replace(/\.[^.]+$/, '');
    const fuzzyHits = library.filter((x) => {
      const base = path.basename(x.name).toLowerCase();
      return base === want || base.replace(/\.[^.]+$/, '') === wantNoExt;
    }).map((x) => x.name);
    const fuzzy = fuzzyHits.length ? `；近似匹配：${fuzzyHits.join('、')}` : '';
    throw new Error(`语音库里找不到「${raw}」${fuzzy}。${hint}`);
  }

  function resolveVoicePathForOperator(input) {
    const vc = voiceCfg();
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('缺少音频路径');
    if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) throw new Error('语音只接受本地文件；不接受 base64://、data: 或 http(s):// 来源');
    const r = resolveAudioSource(raw, { voiceDir: vc.dir });
    if (r.path) return { path: r.path, via: r.via, resolvedFrom: raw };
    const fuzzy = r.candidates?.length ? `；语音库近似匹配：${r.candidates.map((c) => path.basename(c.path)).join('、')}` : '';
    throw new Error(`找不到音频「${raw}」${fuzzy}`);
  }

  return { voiceCfg, voiceLibrary, voicePathInsideLibrary, resolveVoicePathForV2, resolveVoicePathForOperator };
}
