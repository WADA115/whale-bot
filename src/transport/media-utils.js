// 纯媒体工具：不碰网络、不读配置，只做字节/URL 判断。
export function mimeFromBuffer(buf) {
  if (!buf || buf.length < 12) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return 'image/jpeg';
}

export function mimeFromUrl(url, fallback = 'image/jpeg') {
  try {
    const pathname = new URL(String(url)).pathname.toLowerCase();
    if (pathname.endsWith('.png')) return 'image/png';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  } catch {}
  return fallback;
}

export function getImageDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) { offset += 1; continue; }
        const marker = buf[offset + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        const len = buf.readUInt16BE(offset + 2);
        if (len < 2) return null;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + len;
      }
    }
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fourcc = buf.toString('ascii', 12, 16);
      if (fourcc === 'VP8X' && buf.length >= 30) {
        return { width: 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16), height: 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16) };
      }
      if (fourcc === 'VP8L' && buf.length >= 25) {
        const bits = [buf[21], buf[22], buf[23], buf[24]];
        return { width: 1 + (((bits[1] & 0x3f) << 8) | bits[0]), height: 1 + (((bits[3] & 0x0f) << 10) | (bits[2] << 2) | ((bits[1] & 0xc0) >> 6)) };
      }
      if (fourcc === 'VP8 ' && buf.length >= 30) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
    }
  } catch {}
  return null;
}

export function base64FromMaybe(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (s.startsWith('base64://')) return s.slice('base64://'.length).replace(/\s/g, '');
  if (s.startsWith('data:image/')) {
    const idx = s.indexOf(',');
    if (idx >= 0) return s.slice(idx + 1).replace(/\s/g, '');
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(s)) return s.replace(/\s/g, '');
  return null;
}

export function isProbablySafeImageFileRef(file) {
  const s = String(file ?? '').trim();
  if (!s || s.length > 512) return false;
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  if (/[\\/]/.test(s)) return false;
  if (/^[a-zA-Z]:/.test(s)) return false;
  if (/^(file|https?|base64|data):/i.test(s)) return false;
  if (s.includes('..')) return false;
  return /^[\w.+=@-]+$/.test(s);
}
