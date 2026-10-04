import { LIMITS, MESSAGES, type InputMime } from '../domain/limits';

export interface SniffResult {
  mime: InputMime;
  width: number;
  height: number;
}

export class ImageInputError extends Error {}

const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/**
 * 先頭バイト（最大64KiB）から形式と寸法を判定する。拡張子・MIMEは信用しない。
 * 全体をデコードせずに寸法上限を検査するため、ヘッダーだけで判断する。
 */
export function sniffImage(head: Uint8Array): SniffResult {
  if (head.length >= 24 && u32be(head, 0) === 0x89504e47 && u32be(head, 4) === 0x0d0a1a0a) {
    if (ascii(head, 12, 4) !== 'IHDR') throw new ImageInputError(MESSAGES.unsupported);
    // APNG（acTL）はアニメーションのため拒否
    let o = 8;
    while (o + 8 <= head.length) {
      const len = u32be(head, o);
      const type = ascii(head, o + 4, 4);
      if (type === 'acTL') throw new ImageInputError(MESSAGES.unsupported);
      if (type === 'IDAT' || type === 'IEND') break;
      o += 12 + len;
    }
    return { mime: 'image/png', width: u32be(head, 16), height: u32be(head, 20) };
  }
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    let o = 2;
    while (o + 9 < head.length) {
      if (head[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = head[o + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        o += marker === 0xff ? 1 : 2;
        continue;
      }
      const len = u16be(head, o + 2);
      // SOF0..SOF15（DHT/JPG/DACを除く）
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: u16be(head, o + 5), width: u16be(head, o + 7) };
      }
      if (marker === 0xda) break;
      o += 2 + len;
    }
    throw new ImageInputError(MESSAGES.decodeFailed);
  }
  if (head.length >= 30 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    const chunk = ascii(head, 12, 4);
    if (chunk === 'VP8X') {
      const flags = head[20]!;
      if (flags & 0x02) throw new ImageInputError(MESSAGES.unsupported); // アニメーション
      return { mime: 'image/webp', width: u24le(head, 24) + 1, height: u24le(head, 27) + 1 };
    }
    if (chunk === 'VP8 ') {
      if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) throw new ImageInputError(MESSAGES.decodeFailed);
      return { mime: 'image/webp', width: u16le(head, 26) & 0x3fff, height: u16le(head, 28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      if (head[20] !== 0x2f) throw new ImageInputError(MESSAGES.decodeFailed);
      const b = head[21]! | (head[22]! << 8) | (head[23]! << 16) | (head[24]! << 24);
      return { mime: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
    }
    throw new ImageInputError(MESSAGES.unsupported);
  }
  throw new ImageInputError(MESSAGES.unsupported);
}

/** ファイル1枚の事前検査（容量→ヘッダー→ピクセル数）。全体を読み込む前に判定する。 */
export async function precheckFile(file: Blob): Promise<SniffResult> {
  if (file.size > LIMITS.maxInputImageBytes) throw new ImageInputError(MESSAGES.tooLarge);
  if (file.size < 16) throw new ImageInputError(MESSAGES.unsupported);
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const r = sniffImage(head);
  if (!(r.width > 0 && r.height > 0)) throw new ImageInputError(MESSAGES.decodeFailed);
  if (r.width * r.height > LIMITS.maxInputImagePixels) throw new ImageInputError(MESSAGES.tooManyPixels);
  return r;
}

export function precheckTotal(files: { size: number }[]): void {
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > LIMITS.maxInputTotalBytes) throw new ImageInputError(MESSAGES.totalTooLarge);
}
