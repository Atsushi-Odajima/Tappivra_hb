import { useState } from 'react';
import { LIMITS } from '../domain/limits';
import type { ProjectGraph, UUID } from '../domain/types';

export function StepList(props: {
  graph: ProjectGraph;
  selectedStepId: UUID | null;
  thumbUrl: (assetId: UUID) => string | undefined;
  onSelect: (id: UUID) => void;
  onMove: (id: UUID, delta: number) => void;
  onReorder: (id: UUID, toIndex: number) => void;
  onAddImages: (files: File[]) => void;
}) {
  const { graph } = props;
  const order = graph.project.stepOrder;
  const [dragId, setDragId] = useState<UUID | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const full = order.length >= LIMITS.maxSteps;
  return (
    <nav className="ed-left" aria-label="ステップ">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 8px' }}>
        <h2 className="h-panel" style={{ fontSize: 18 }}>ステップ</h2>
        <span className="small muted num">{order.length}枚</span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {order.map((id, i) => {
          const s = graph.steps[id];
          if (!s) return null;
          const thumb = props.thumbUrl(s.imageAssetId);
          return (
            <li
              key={id}
              className={`step-row${overIdx === i ? ' drag-over' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragId(id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverIdx(i);
              }}
              onDragLeave={() => setOverIdx(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== id) props.onReorder(dragId, i);
                setDragId(null);
                setOverIdx(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverIdx(null);
              }}
            >
              <button type="button" className="step-item focusable" aria-current={props.selectedStepId === id} onClick={() => props.onSelect(id)} data-step-id={id}>
                {thumb ? <img className="step-thumb" src={thumb} alt="" /> : <span className="step-thumb" />}
                <span style={{ minWidth: 0 }}>
                  <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
                  {graph.project.entryStepId === id && <span className="badge">開始</span>}
                  {s.kind === 'finish' && <span className="badge">完了</span>}
                  <span className="step-title truncate" style={{ display: 'block' }} title={s.title}>
                    {s.title}
                  </span>
                </span>
              </button>
              <div className="step-ctrl">
                <span className="small muted" aria-hidden="true" title="ドラッグで並べ替え" style={{ cursor: 'grab', marginRight: 'auto', paddingLeft: 4 }}>
                  ⠿
                </span>
                <button type="button" className="btn btn-secondary" aria-label={`「${s.title}」を上へ`} disabled={i === 0} onClick={() => props.onMove(id, -1)}>
                  ↑
                </button>
                <button type="button" className="btn btn-secondary" aria-label={`「${s.title}」を下へ`} disabled={i === order.length - 1} onClick={() => props.onMove(id, 1)}>
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <label className={`btn btn-secondary${full ? ' disabled' : ''}`} style={{ marginTop: 8 }} aria-disabled={full}>
        ＋ 画像を追加
        <input
          type="file"
          className="visually-hidden"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={full}
          data-testid="add-images"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) props.onAddImages(files);
          }}
        />
      </label>
      {full && <p className="small muted">1プロジェクトは最大{LIMITS.maxSteps}ステップです。</p>}
    </nav>
  );
}
