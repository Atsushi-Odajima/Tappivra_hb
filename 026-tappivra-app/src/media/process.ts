import { LIMITS, MESSAGES, type AssetMime, type InputMime } from '../domain/limits';
import type { Rect } from '../domain/types';
import { ImageInputError } from './sniff';

export interface EncodedImage {
  bytes: Uint8Array;
  mime: AssetMime;
  width: number;
  height: number;
}

/** 画像をデコード（EXIFの向きを反映）。元ファイルのbytesは保持しない。 */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageInputError(MESSAGES.decodeFailed);
  }
}

export function outputSize(w: number, h: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= LIMITS.maxEncodedLongEdge) return { width: w, height: h };
  const s = LIMITS.maxEncodedLongEdge / long;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** 正規化矩形→ピクセル矩形（外側へ丸めて元ピクセルを残さない） */
export function maskPixels(r: Rect, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(r.x * width + 1e-9));
  const y0 = Math.max(0, Math.floor(r.y * height + 1e-9));
  const x1 = Math.min(width, Math.ceil((r.x + r.w) * width - 1e-9));
  const y1 = Math.min(height, Math.ceil((r.y + r.h) * height - 1e-9));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function outputMime(input: InputMime): AssetMime {
  return input === 'image/jpeg' ? 'image/jpeg' : 'image/png';
}

/**
 * 黒塗りを焼き込み、PNG/JPEGへ再エンコードする。
 * Canvasへ描いた後に黒100%で塗るため、出力ファイルには塗った箇所の元ピクセルは残らない。
 * EXIF・元ファイル名・パスは再エンコードで除去される（入力メタデータを引き継がない）。
 */
export async function burnAndEncode(source: CanvasImageSource & { width: number; height: number }, masks: Rect[], mime: AssetMime): Promise<EncodedImage> {
  const { width, height } = outputSize(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: mime === 'image/png' });
  if (!ctx) throw new ImageInputError(MESSAGES.decodeFailed);
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  for (const m of masks) {
    const p = maskPixels(m, width, height);
    if (p.w > 0 && p.h > 0) ctx.fillRect(p.x, p.y, p.w, p.h);
  }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.92));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new ImageInputError(MESSAGES.decodeFailed);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > LIMITS.maxInputImageBytes) throw new ImageInputError('加工後の画像が大きすぎます。画像を縮小してから追加してください');
  return { bytes, mime, width, height };
}
