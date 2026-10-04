import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectGraph, UUID } from '../domain/types';
import { toDemoDocument } from '../export/publicDoc';
import { mountViewer, type ViewerHandle } from '../viewer/runtime';
import '../viewer/viewer.css';
import { Modal } from './ui';

/** 編集グラフ→公開用データ変換を通し、実際の閲覧ランタイムで表示する。未設定のリンクは除外して表示。 */
export function previewDocument(g: ProjectGraph) {
  const valid = new Set(g.project.stepOrder.filter((id) => g.steps[id] && g.assets[g.steps[id]!.imageAssetId]));
  const steps: ProjectGraph['steps'] = {};
  let skipped = 0;
  for (const id of valid) {
    const s = g.steps[id]!;
    const hs = s.hotspots.filter((h) => h.targetStepId && valid.has(h.targetStepId) && h.targetStepId !== id);
    skipped += s.hotspots.length - hs.length;
    steps[id] = { ...s, hotspots: hs };
  }
  const entry = g.project.entryStepId && valid.has(g.project.entryStepId) ? g.project.entryStepId : [...valid][0];
  if (!entry) return { doc: null, skipped };
  const doc = toDemoDocument({ ...g, project: { ...g.project, entryStepId: entry, stepOrder: [...valid] }, steps }, new Date().toISOString());
  return { doc, skipped };
}

export function PreviewDialog({ graph, url, onClose }: { graph: ProjectGraph; url: (id: UUID) => string | undefined; onClose: () => void }) {
  const [mode, setMode] = useState<'pc' | 'mobile'>('pc');
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<ViewerHandle | null>(null);
  const { doc, skipped } = useMemo(() => previewDocument(graph), [graph]);
  useEffect(() => {
    if (!ref.current || !doc) return;
    handle.current = mountViewer(ref.current, { doc, imageUrl: (id) => url(id) ?? '' });
    return () => handle.current?.destroy();
  }, [doc, url]);
  useEffect(() => {
    handle.current?.relayout();
  }, [mode]);
  return (
    <Modal
      title="閲覧プレビュー"
      onClose={onClose}
      wide
      headExtra={
        <div role="group" aria-label="表示幅" style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button type="button" className="btn btn-secondary btn-small" aria-pressed={mode === 'pc'} onClick={() => setMode('pc')}>
            PC
          </button>
          <button type="button" className="btn btn-secondary btn-small" aria-pressed={mode === 'mobile'} onClick={() => setMode('mobile')}>
            スマホ 390px
          </button>
        </div>
      }
    >
      {skipped > 0 && <p className="notice notice-warn small">移動先が未設定・不正なクリック箇所{skipped}件はプレビューに表示していません（書き出し前チェックでエラーになります）。</p>}
      {doc ? (
        <div className={`pv-frame ${mode}`} style={{ height: 'calc(100vh - 220px)' }} data-testid="preview-frame">
          <div ref={ref} style={{ minHeight: '100%' }} />
        </div>
      ) : (
        <p>表示できる画面がありません。画像を追加してください。</p>
      )}
    </Modal>
  );
}
