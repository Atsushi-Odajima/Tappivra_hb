import { LIMITS } from './limits';
import { round6 } from './ids';
import type { Rect } from './types';

export type RectError = 'not-finite' | 'negative' | 'too-small' | 'overflow';

export const RECT_ERROR_TEXT: Record<RectError, string> = {
  'not-finite': '数値を入力してください（NaN・Infinityは使えません）',
  negative: '0以上の値を入力してください',
  'too-small': '幅・高さは画像の1%以上にしてください',
  overflow: '画像の端からはみ出さないようにしてください',
};

/** 0〜1正規化矩形を検証。成功時は6桁へ正規化した矩形を返す。 */
export function validateRect(r: Rect): { ok: true; rect: Rect } | { ok: false; error: RectError } {
  const vals = [r.x, r.y, r.w, r.h];
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return { ok: false, error: 'not-finite' };
  const rect = { x: round6(r.x), y: round6(r.y), w: round6(r.w), h: round6(r.h) };
  if (rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0) {
    return { ok: false, error: rect.w <= 0 || rect.h <= 0 ? 'too-small' : 'negative' };
  }
  if (rect.w < LIMITS.minHotspotSize || rect.h < LIMITS.minHotspotSize) return { ok: false, error: 'too-small' };
  if (round6(rect.x + rect.w) > 1 || round6(rect.y + rect.h) > 1) return { ok: false, error: 'overflow' };
  return { ok: true, rect };
}

/** 端からはみ出さないように位置を丸め込む（キーボード移動用）。サイズは変更しない。 */
export function clampMove(r: Rect, dx: number, dy: number): Rect {
  const x = Math.min(Math.max(0, r.x + dx), 1 - r.w);
  const y = Math.min(Math.max(0, r.y + dy), 1 - r.h);
  return { x: round6(x), y: round6(y), w: r.w, h: r.h };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 01仕様 §08：object-fit: contain の描画画像領域 */
export function containBox(containerW: number, containerH: number, imageW: number, imageH: number) {
  if (imageW <= 0 || imageH <= 0 || containerW <= 0 || containerH <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const s = Math.min(containerW / imageW, containerH / imageH);
  const width = imageW * s;
  const height = imageH * s;
  return { left: (containerW - width) / 2, top: (containerH - height) / 2, width, height };
}

export function hotspotBox(box: { left: number; top: number; width: number; height: number }, r: Rect) {
  return { left: box.left + r.x * box.width, top: box.top + r.y * box.height, width: r.w * box.width, height: r.h * box.height };
}
