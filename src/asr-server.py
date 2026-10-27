"""本地中文 ASR（sherpa-onnx + paraformer-zh-small）HTTP 服务。

为什么做成常驻服务而不是每次 spawn：
  桥接进程里 spawn 外部程序在本机会偶发 EPERM，而模型加载要 1~2 秒，
  常驻内存后每次识别只有几十毫秒。

接口：
  POST /asr   body: {"wav": "<本地 wav 路径>"}  或  {"pcm16": "<base64 PCM16LE 16kHz mono>"}
              → {"text": "识别结果"}
  GET  /health → {"ok": true}

启动：python asr-server.py [--port 3199]
"""
import argparse
import base64
import json
import os
import sys
import wave

import numpy as np
import sherpa_onnx
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL_DIR = os.path.join(ROOT, 'tools', 'asr', 'sherpa-onnx-paraformer-zh-small-2024-03-09')

_recognizer = None


def load_model():
    global _recognizer
    if _recognizer is not None:
        return _recognizer
    model = os.path.join(MODEL_DIR, 'model.int8.onnx')
    tokens = os.path.join(MODEL_DIR, 'tokens.txt')
    if not os.path.exists(model) or not os.path.exists(tokens):
        raise SystemExit(f'模型缺失：{MODEL_DIR}')
    _recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=model,
        tokens=tokens,
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        decoding_method='greedy_search',
        debug=False,
        provider='cpu',
    )
    return _recognizer


def resample_to_16k(samples, rate):
    if rate == 16000:
        return samples
    n_out = int(round(len(samples) * 16000 / rate))
    if n_out <= 1:
        return samples
    src_idx = np.linspace(0, len(samples) - 1, n_out)
    i0 = np.floor(src_idx).astype(np.int64)
    i1 = np.minimum(i0 + 1, len(samples) - 1)
    frac = (src_idx - i0).astype(np.float32)
    return (samples[i0] * (1 - frac) + samples[i1] * frac).astype(np.float32)


def read_wav_mono16(path):
    with wave.open(path, 'rb') as f:
        ch = f.getnchannels()
        width = f.getsampwidth()
        rate = f.getframerate()
        frames = f.readframes(f.getnframes())
    if width != 2:
        raise ValueError(f'只支持 16bit PCM，收到 {width * 8}bit')
    pcm = np.frombuffer(frames, dtype='<i2').astype(np.float32) / 32768.0
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)
    return resample_to_16k(pcm, rate)


def transcribe(samples):
    rec = load_model()
    stream = rec.create_stream()
    stream.accept_waveform(16000, samples)
    rec.decode_stream(stream)
    return (stream.result.text or '').strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # 静音访问日志
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('content-type', 'application/json; charset=utf-8')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/health'):
            return self._json(200, {'ok': True, 'model': os.path.basename(MODEL_DIR)})
        return self._json(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        if not self.path.startswith('/asr'):
            return self._json(404, {'ok': False, 'error': 'not found'})
        try:
            length = int(self.headers.get('content-length') or 0)
            raw = self.rfile.read(length) if length else b'{}'
            req = json.loads(raw.decode('utf-8') or '{}')
            if req.get('wav'):
                samples = read_wav_mono16(str(req['wav']))
            elif req.get('pcm16'):
                pcm = np.frombuffer(base64.b64decode(req['pcm16']), dtype='<i2').astype(np.float32) / 32768.0
                rate = int(req.get('rate') or 24000)
                samples = resample_to_16k(pcm, rate)
            else:
                return self._json(400, {'ok': False, 'error': 'need wav or pcm16'})
            if len(samples) < 1600:
                return self._json(200, {'ok': True, 'text': ''})
            text = transcribe(samples)
            return self._json(200, {'ok': True, 'text': text})
        except Exception as exc:  # noqa: BLE001
            return self._json(500, {'ok': False, 'error': str(exc)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=3199)
    ap.add_argument('--warmup', action='store_true', default=True)
    args = ap.parse_args()
    if args.warmup:
        load_model()
    srv = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'[asr] listening 127.0.0.1:{args.port} model={os.path.basename(MODEL_DIR)}', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
