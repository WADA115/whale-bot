// Edge TTS（微软 Edge「大声朗读」的神经语音）客户端，供 qq-bridge 的语音合成使用。
//
// 关键点：2026 年起 Sec-MS-GEC token 换成了 **v2**（自定义 SHA256 + CS64 混合），
// 版本串也变成 `Sec-MS-GEC-Version: 2-<Chromium 版本>`；用旧算法/旧版本号一律 403。
// token 由 edge_token.py 用官方 drm.py 算出（需要 python），本脚本只负责 WebSocket 收发。
//
// 用法:
//   node tts-edge.mjs --voice zh-CN-XiaoyiNeural --out out.mp3 --text "在的，说吧" [--rate 0%]
//   也可以用 stdin 传文本（--text 省略时读 stdin）
//   token 缺失时自动调用 python 计算；可用 --token/--version 直接指定，或 DSH_PYTHON 指定解释器。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const voice = arg('voice', 'zh-CN-XiaoyiNeural');
const outFile = arg('out', path.join(ROOT, 'audio', `edge-${Date.now()}.mp3`));
const rate = arg('rate', '+0%');
const pitch = arg('pitch', '+0Hz');
// --format raw：输出 24kHz 16bit 单声道裸 PCM（供“变调拼旋律”脚本逐字处理，省掉 mp3 解码器）
const formatArg = arg('format', 'mp3');
const OUTPUT_FORMAT = formatArg === 'raw'
  ? 'riff-24khz-16bit-mono-pcm'
  : 'audio-24khz-48kbitrate-mono-mp3';
let text = arg('text');
if (!text) {
  text = fs.readFileSync(0, 'utf8');
}
text = String(text || '').trim();
if (!text) {
  console.error('没有文本');
  process.exit(2);
}

/** 找 python：显式 token 就不用找。 */
function findPython() {
  const candidates = [
    process.env.DSH_PYTHON,
    path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh'),
      'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
    'python',
    'python3',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 });
      return c;
    } catch {}
  }
  return null;
}

function computeToken() {
  const explicit = arg('token');
  if (explicit) return { token: explicit, version: arg('version', '2-143.0.3650.75') };
  const py = findPython();
  if (!py) throw new Error('找不到 python，无法计算 Sec-MS-GEC v2 token（可用 --token 直接指定）');
  const script = path.join(ROOT, 'tools', 'edge', 'edge_token.py');
  if (!fs.existsSync(script)) throw new Error(`缺少 token 脚本：${script}`);
  const token = execFileSync(py, [script], { encoding: 'utf8', timeout: 30000 }).trim();
  const version = execFileSync(py, [script, '--version'], { encoding: 'utf8', timeout: 30000 }).trim();
  if (!token || !version) throw new Error('token 计算失败');
  return { token, version };
}

const { token, version } = computeToken();

const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
  + `&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${version}&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}`;

const ws = new WebSocket(url, {
  headers: {
    Pragma: 'no-cache',
    'Cache-Control': 'no-cache',
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});
ws.binaryType = 'arraybuffer';

const chunks = [];
const timeout = setTimeout(() => {
  console.error('超时：15 秒内没收到完整音频');
  try { ws.close(); } catch {}
  process.exit(1);
}, 15000);

function dateHeader() { return new Date().toUTCString(); }

function sendConfig() {
  ws.send(
    `X-Timestamp:${dateHeader()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
    + JSON.stringify({ context: { synthesis: { audio: {
      metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
      outputFormat: OUTPUT_FORMAT,
    } } } }),
  );
}

/**
 * 标点停顿。
 *
 * 实测（2026-10）：消费者版 Edge 端点**不支持 `<break time>`** —— 加上之后服务端
 * 直接不返回音频，客户端只能等到超时。所以默认关闭，只有显式 --breaks on 才插入，
 * 方便以后端点支持了再打开。
 *
 * 现在改善"像念稿"靠的是：选更自然的音色 + 略慢语速 + 文本侧加口语气口。
 */
function buildSsmlText(raw) {
  const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (arg('breaks', 'off') !== 'on') return escaped;
  const commaMs = Number(arg('commaMs', '140')) || 140;
  const periodMs = Number(arg('periodMs', '260')) || 260;
  return escaped
    .replace(/([，,、;；])(?!\s*$)/g, `$1<break time='${commaMs}ms'/>`)
    .replace(/([。.!！?？])(?!\s*$)/g, `$1<break time='${periodMs}ms'/>`)
    .replace(/(…|\.{3,}|~|～)/g, `<break time='${commaMs}ms'/>$1`);
}

function sendSsml() {
  const body = buildSsmlText(text);
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>`
    + `<voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>${body}</prosody></voice></speak>`;
  ws.send(
    `X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\n`
    + `X-Timestamp:${dateHeader()}Z\r\nPath:ssml\r\n\r\n${ssml}`,
  );
}

ws.addEventListener('open', () => {
  sendConfig();
  setTimeout(sendSsml, 120);
});

ws.addEventListener('message', (event) => {
  if (typeof event.data === 'string') {
    if (/Path:\s*turn\.end/i.test(event.data)) {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      const audio = Buffer.concat(chunks);
      if (!audio.length) { console.error('没有收到音频数据'); process.exit(1); }
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, audio);
      console.log(`OK ${outFile} ${audio.length}`);
      process.exit(0);
    }
    return;
  }
  const buf = Buffer.from(event.data);
  const headerLen = buf.readUInt16BE(0);
  const header = buf.slice(2, 2 + headerLen).toString('utf8');
  if (/Path:\s*audio/i.test(header)) chunks.push(buf.slice(2 + headerLen));
});

ws.addEventListener('error', (e) => {
  clearTimeout(timeout);
  console.error('WebSocket 错误:', e?.message ?? e?.error?.message ?? 'unknown');
  process.exit(1);
});
