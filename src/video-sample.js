// 视频 → 给模型看的东西：均匀抽几帧（当图片）+ 抽音轨（交给本地 ASR 转文字）。
//
// 为什么抽帧而不是"看视频"：模型只吃图片，视频只能降维成关键帧；
// 4~6 帧够回答"这视频在演什么"，不会得到"精确到秒"的理解。
//
// 依赖：ffmpeg（voice-core 的 resolveFfmpeg 负责定位）。这里只做两件事：
//   sampleFrames()  按场景变化优先、回退均匀采样，导出 count 张 jpg
//   extractAudio()  抽出 16kHz 单声道 wav（给 paraformer）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function runFfmpeg(ffmpeg, args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      // stderr 单独接管道：失败时要能把 ffmpeg 的真实原因带回来，
      // 只报退出码（比如 -13）根本没法定位。
      child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error: `ffmpeg 启动失败：${error?.message ?? error}` });
      return;
    }
    let stderr = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
    }
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      settle({ ok: false, error: `ffmpeg 超时（${Math.round(timeoutMs / 1000)}s）` });
    }, timeoutMs);
    child.on('error', (error) => settle({ ok: false, error: `ffmpeg 启动失败：${error?.message ?? error}` }));
    child.on('close', (code) => {
      if (code === 0) return settle({ ok: true });
      const tail = stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 200);
      settle({ ok: false, error: `ffmpeg 退出码 ${code}${tail ? `（${tail}）` : ''}` });
    });
  });
}

function makeTmpDir() {
  // 为什么不用 os.tmpdir()：本机上 %TEMP% 对派生进程的写权限不稳定，
  // ffmpeg 会直接 "Permission denied"（实测 -13）。桥接会通过环境变量指定
  // 一个确定可写的目录（工作区下的 state/media-tmp）。
  const base = process.env.QQB_MEDIA_TMP || os.tmpdir();
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch {}
  return fs.mkdtempSync(path.join(base, 'video-'));
}

/**
 * 从视频里抽帧。优先用场景变化选帧（内容差异大的地方更有信息量），
 * 抽不到再退化成均匀采样。
 *
 * @returns {{ok: boolean, frames?: Buffer[], error?: string, mode?: string}}
 */
export async function sampleFrames({ buffer, ffmpegPath, count = 4, maxLongEdge = 1280 } = {}) {
  if (!buffer?.length) return { ok: false, error: '没有视频数据' };
  const dir = makeTmpDir();
  const inFile = path.join(dir, 'in.mp4');
  fs.writeFileSync(inFile, buffer);
  const scale = `scale='min(${maxLongEdge},iw)':-2:flags=lanczos`;
  const readFrames = () => {
    try {
      return fs.readdirSync(dir)
        .filter((f) => /^f\d+\.jpg$/.test(f))
        .sort()
        .map((f) => fs.readFileSync(path.join(dir, f)));
    } catch {
      return [];
    }
  };
  try {
    // 1) 场景变化优先
    let run = await runFfmpeg(ffmpegPath, [
      '-v', 'error', '-y', '-i', inFile,
      '-vf', `select='gt(scene,0.15)',${scale}`,
      '-vsync', 'vfr', '-frames:v', String(count), '-q:v', '4',
      path.join(dir, 'f%02d.jpg')
    ]);
    let frames = run.ok ? readFrames() : [];
    let mode = 'scene';
    // 2) 场景检测抽不到（比如画面几乎不变）→ 均匀采样
    if (frames.length === 0) {
      for (const f of fs.readdirSync(dir)) {
        if (/^f\d+\.jpg$/.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
      }
      run = await runFfmpeg(ffmpegPath, [
        '-v', 'error', '-y', '-i', inFile,
        '-vf', `fps=1/2,${scale}`,
        '-frames:v', String(count), '-q:v', '4',
        path.join(dir, 'f%02d.jpg')
      ]);
      frames = run.ok ? readFrames() : [];
      mode = 'uniform';
    }
    if (!frames.length) return { ok: false, error: run.error || '抽不出帧' };
    return { ok: true, frames, mode };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/** 抽音轨成 16kHz 单声道 wav（给本地 ASR）。没有音轨时返回 ok:false。 */
export async function extractAudio({ buffer, ffmpegPath, timeoutMs = 60000 } = {}) {
  if (!buffer?.length) return { ok: false, error: '没有视频数据' };
  const dir = makeTmpDir();
  const inFile = path.join(dir, 'in.mp4');
  const wavFile = path.join(dir, 'a.wav');
  fs.writeFileSync(inFile, buffer);
  try {
    const run = await runFfmpeg(ffmpegPath, [
      '-v', 'error', '-y', '-i', inFile,
      '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wavFile
    ], { timeoutMs });
    if (!run.ok) return { ok: false, error: run.error };
    const wav = fs.readFileSync(wavFile);
    // 44 字节头 + 至少 0.2 秒数据才算有声音
    if (wav.length < 44 + 6400) return { ok: false, error: '音轨为空或过短' };
    return { ok: true, wav };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
