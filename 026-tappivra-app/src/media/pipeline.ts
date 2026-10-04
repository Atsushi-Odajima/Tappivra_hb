import { newId, nowIso } from '../domain/ids';
import type { AssetMeta, Rect, UUID } from '../domain/types';
import { sha256Hex } from './hash';
import { burnAndEncode, decodeImage, outputMime } from './process';
import { precheckFile, type SniffResult } from './sniff';

export interface PendingImage {
  /** 元ファイル名はUI表示のみ。公開物・DBには保存しない */
  displayName: string;
  file: Blob;
  sniff: SniffResult;
  bitmap: ImageBitmap;
}

export async function openPendingImage(file: File | Blob, displayName: string): Promise<PendingImage> {
  const sniff = await precheckFile(file);
  const bitmap = await decodeImage(file);
  return { displayName, file, sniff, bitmap };
}

export function releasePending(p: PendingImage | null | undefined) {
  try {
    p?.bitmap.close();
  } catch {
    /* already closed */
  }
}

/** 黒塗りを焼き込み、加工済み画像のメタ情報とbytesを返す（元画像は含まない） */
export async function finalizeImage(p: PendingImage, masks: Rect[], projectId: UUID): Promise<{ meta: AssetMeta; bytes: Uint8Array }> {
  const enc = await burnAndEncode(p.bitmap, masks, outputMime(p.sniff.mime));
  const sha256 = await sha256Hex(enc.bytes);
  return {
    meta: {
      id: newId(),
      projectId,
      mime: enc.mime,
      width: enc.width,
      height: enc.height,
      byteLength: enc.bytes.length,
      sha256,
      createdAt: nowIso(),
    },
    bytes: enc.bytes,
  };
}
