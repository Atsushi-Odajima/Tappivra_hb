import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createProjectGraph } from '../../src/domain/model';
import { newId } from '../../src/domain/ids';
import type { AssetMeta, Hotspot, ProjectGraph, Step } from '../../src/domain/types';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

/** 単色RGBのPNG（テスト用） */
export function makePng(w: number, h: number, rgb: [number, number, number] = [200, 30, 30], extraChunks: { type: string; data: Uint8Array }[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extraChunks.map((c) => chunk(c.type, c.data)),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function sha(b: Uint8Array) {
  return createHash('sha256').update(b).digest('hex');
}

export function assetFor(projectId: string, bytes: Uint8Array, w: number, h: number): AssetMeta {
  return { id: newId(), projectId, mime: 'image/png', width: w, height: h, byteLength: bytes.length, sha256: sha(bytes), createdAt: new Date().toISOString() };
}

/** 一覧→新規作成→(入力例|保存完了)→終了 の5画面（分岐と合流を含むDAG） */
export function buildFiveStepGraph(): { graph: ProjectGraph; images: Map<string, Uint8Array>; ids: string[] } {
  const g = createProjectGraph('新規案件の登録デモ');
  g.project.privateNotes = 'DO_NOT_EXPORT_PRIVATE_NOTE_TAPPIVRA';
  const images = new Map<string, Uint8Array>();
  const ids = Array.from({ length: 5 }, () => newId());
  const titles = ['一覧', '新規作成', '入力例', '保存完了', '終了案内'];
  const links: [number, number][][] = [[[0, 1]], [[1, 2], [1, 3]], [[2, 3]], [[3, 4]], []];
  ids.forEach((id, i) => {
    const png = makePng(40, 25, [10 * i, 100, 200]);
    const a = assetFor(g.project.id, png, 40, 25);
    images.set(a.id, png);
    g.assets[a.id] = a;
    const hotspots: Hotspot[] = links[i]!.map(([, to], k) => ({
      id: newId(),
      stepId: id,
      label: `${titles[to]}へ`,
      helpText: '',
      rect: { x: 0.1 + k * 0.4, y: 0.6, w: 0.3, h: 0.1 },
      targetStepId: ids[to]!,
      order: k,
    }));
    const step: Step = {
      id,
      projectId: g.project.id,
      title: titles[i]!,
      imageAssetId: a.id,
      description: `${titles[i]}の説明`,
      altText: `架空のサンプル業務画面：${titles[i]}`,
      kind: i === 4 ? 'finish' : 'screen',
      hotspots,
      redactionReviewedAssetHash: a.sha256,
      layoutReviewedRevision: 0,
    };
    g.steps[id] = step;
    g.project.stepOrder.push(id);
  });
  g.project.entryStepId = ids[0]!;
  return { graph: g, images, ids };
}

/** 画素ごとの色を指定できるPNG（秘密領域パターン試験用） */
export function makePatternPng(w: number, h: number, color: (x: number, y: number) => [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(color(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', new Uint8Array(deflateSync(raw))), pngChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
export const pngChunk = chunk;
