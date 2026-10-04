// 単独HTML用エントリー。ビルド時にIIFE化して配布HTMLへ内包する（module import・fetchなし）。
import { mountViewer } from './runtime';
import type { DemoDocument } from '../domain/types';

interface Payload {
  doc: DemoDocument;
  images: Record<string, string>;
}

function start() {
  const root = document.getElementById('tappivra-root');
  const data = document.getElementById('tappivra-data');
  if (!root || !data) return;
  let payload: Payload;
  try {
    payload = JSON.parse(data.textContent ?? '') as Payload;
  } catch {
    root.textContent = 'デモデータを読み込めませんでした。';
    return;
  }
  const ok =
    payload && payload.doc && payload.doc.format === 'tappivra-demo' && payload.doc.schemaVersion === 1 && Array.isArray(payload.doc.steps) && payload.images;
  if (!ok) {
    root.textContent = 'このデモの形式には対応していません。';
    return;
  }
  const images = payload.images;
  mountViewer(root, {
    doc: payload.doc,
    // data: URI以外は使わない
    imageUrl: (id) => (typeof images[id] === 'string' && images[id]!.startsWith('data:image/') ? images[id]! : ''),
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
