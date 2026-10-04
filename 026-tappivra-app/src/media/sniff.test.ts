// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makePng } from '../../tests/helpers/fixtures';
import { LIMITS, MESSAGES, MiB } from '../domain/limits';
import { maskPixels, outputSize } from './process';
import { precheckFile, precheckTotal, sniffImage } from './sniff';

const bytes = (...a: number[]) => new Uint8Array(a);
const ascii = (s: string) => new TextEncoder().encode(s);

function jpegHeader(w: number, h: number) {
  // SOI, APP0(16), SOF0
  return bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, ...new Array(9).fill(0));
}
function webp(chunk: string, body: number[]) {
  const b = new Uint8Array(40);
  b.set(ascii('RIFF'), 0);
  b.set(ascii('WEBP'), 8);
  b.set(ascii(chunk), 12);
  b.set(body, 16);
  return b;
}

describe('T02/T03 形式判定（拡張子を信用しない）', () => {
  it('PNG/JPEG/WebPの寸法を読む', () => {
    expect(sniffImage(makePng(30, 20))).toEqual({ mime: 'image/png', width: 30, height: 20 });
    expect(sniffImage(jpegHeader(1440, 900))).toEqual({ mime: 'image/jpeg', width: 1440, height: 900 });
    // VP8X 静止画 1440x900
    expect(sniffImage(webp('VP8X', [10, 0, 0, 0, 0, 0, 0, 0, 0x9f, 0x05, 0, 0x83, 0x03, 0]))).toEqual({ mime: 'image/webp', width: 1440, height: 900 });
  });
  it('GIF/SVG/HEIC/PDF/PNG名のHTML/不正バイトを拒否', () => {
    const cases = [
      ascii('GIF89a\x01\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'),
      ascii('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
      bytes(0, 0, 0, 0x18, ...ascii('ftypheic'), ...new Array(20).fill(0)),
      ascii('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj << >> endobj trailer'),
      ascii('<!doctype html><html><script>alert(1)</script></html>'),
      new Uint8Array(64).fill(0xab),
    ];
    for (const c of cases) expect(() => sniffImage(c)).toThrow(MESSAGES.unsupported);
  });
  it('アニメーション（APNG・アニメWebP）を拒否', () => {
    const apng = makePng(4, 4, [0, 0, 0], [{ type: 'acTL', data: new Uint8Array(8) }]);
    expect(() => sniffImage(apng)).toThrow(MESSAGES.unsupported);
    expect(() => sniffImage(webp('VP8X', [10, 0, 0, 0, 0x02, 0, 0, 0, 1, 0, 0, 1, 0, 0]))).toThrow(MESSAGES.unsupported);
  });
});

describe('T04 入力上限（全体を展開する前に判定）', () => {
  it('10MiBちょうどは通り、1byte超は拒否', async () => {
    const png = makePng(10, 10);
    const pad = (n: number) => {
      const b = new Uint8Array(n);
      b.set(png);
      return new Blob([b]);
    };
    await expect(precheckFile(pad(LIMITS.maxInputImageBytes))).resolves.toMatchObject({ mime: 'image/png' });
    await expect(precheckFile(pad(LIMITS.maxInputImageBytes + 1))).rejects.toThrow(MESSAGES.tooLarge);
  });
  it('16MPちょうどは通り、1pixel超は拒否（ヘッダーのみで判定）', async () => {
    const header = (w: number, h: number) => {
      const b = makePng(1, 1).slice(0, 33); // IHDRまで
      const dv = new DataView(b.buffer);
      dv.setUint32(16, w);
      dv.setUint32(20, h);
      return b;
    };
    const ok = header(4000, 4000);
    await expect(precheckFile(new Blob([ok, new Uint8Array(100)]))).resolves.toMatchObject({ width: 4000, height: 4000 });
    const ng = header(16_000_001, 1);
    await expect(precheckFile(new Blob([ng, new Uint8Array(100)]))).rejects.toThrow(MESSAGES.tooManyPixels);
  });
  it('合計80MiB超を拒否', () => {
    expect(() => precheckTotal([{ size: 40 * MiB }, { size: 40 * MiB }])).not.toThrow();
    expect(() => precheckTotal([{ size: 40 * MiB }, { size: 40 * MiB + 1 }])).toThrow(MESSAGES.totalTooLarge);
  });
});

describe('再エンコード寸法・黒塗り範囲', () => {
  it('長辺2560pxへ縮小', () => {
    expect(outputSize(4000, 2000)).toEqual({ width: 2560, height: 1280 });
    expect(outputSize(1440, 900)).toEqual({ width: 1440, height: 900 });
  });
  it('黒塗りは外側へ丸め、元ピクセルを残さない', () => {
    expect(maskPixels({ x: 0.1001, y: 0.2, w: 0.1, h: 0.1 }, 100, 100)).toEqual({ x: 10, y: 20, w: 11, h: 10 });
  });
});
