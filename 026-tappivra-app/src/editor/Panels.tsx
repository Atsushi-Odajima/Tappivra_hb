import { useEffect, useId, useState } from 'react';
import { adjacency, incomingLinks } from '../domain/model';
import { wouldCreateCycle } from '../domain/graph';
import { RECT_ERROR_TEXT, validateRect } from '../domain/rect';
import type { Command } from '../domain/model';
import type { Hotspot, ProjectGraph, Rect, Step, UUID } from '../domain/types';
import { TextField } from './ui';

type Dispatch = (c: Command) => string | null;

function pct(n: number) {
  return (Math.round(n * 10000) / 100).toString();
}

function RectFields({ rect, onCommit }: { rect: Rect; onCommit: (r: Rect) => string | null }) {
  const [vals, setVals] = useState({ x: pct(rect.x), y: pct(rect.y), w: pct(rect.w), h: pct(rect.h) });
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  useEffect(() => setVals({ x: pct(rect.x), y: pct(rect.y), w: pct(rect.w), h: pct(rect.h) }), [rect]);
  const commit = () => {
    const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));
    const r = { x: toNum(vals.x) / 100, y: toNum(vals.y) / 100, w: toNum(vals.w) / 100, h: toNum(vals.h) / 100 };
    const v = validateRect(r);
    if (!v.ok) return setErr(RECT_ERROR_TEXT[v.error]);
    const e = onCommit(v.rect);
    setErr(e);
  };
  const labels: Record<keyof typeof vals, string> = { x: 'X', y: 'Y', w: '幅', h: '高さ' };
  return (
    <fieldset className="panel-section" style={{ border: 'none', padding: 0, margin: 0 }} aria-describedby={err ? `${id}-err` : undefined}>
      <legend className="h-panel" style={{ marginBottom: 8 }}>位置・大きさ（%）</legend>
      <div className="coords">
        {(Object.keys(vals) as (keyof typeof vals)[]).map((k) => (
          <div className="field" key={k}>
            <label htmlFor={`${id}-${k}`}>{labels[k]}</label>
            <input
              id={`${id}-${k}`}
              name={k === 'x' ? 'rect' : undefined}
              className="input num"
              inputMode="decimal"
              value={vals[k]}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? `${id}-err` : undefined}
              onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && commit()}
            />
          </div>
        ))}
      </div>
      {err && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {err}
        </p>
      )}
    </fieldset>
  );
}

export function HotspotPanel({ graph, step, hotspot, dispatch, onClose }: { graph: ProjectGraph; step: Step; hotspot: Hotspot; dispatch: Dispatch; onClose: () => void }) {
  const selId = useId();
  const [targetErr, setTargetErr] = useState<string | null>(null);
  const adj = adjacency(graph);
  adj.set(step.id, step.hotspots.filter((h) => h.id !== hotspot.id).map((h) => h.targetStepId).filter((t): t is UUID => !!t));
  const order = graph.project.stepOrder;
  const targetMissing = hotspot.targetStepId !== null && !graph.steps[hotspot.targetStepId];
  return (
    <>
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h-screen" style={{ fontSize: 20 }}>クリック箇所</h2>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            画面の設定へ
          </button>
        </div>
        <TextField key={`l-${hotspot.id}`} name="label" label="ボタン名" required maxLength={60} value={hotspot.label} onCommit={(v) => dispatch({ type: 'hotspot/update', stepId: step.id, hotspotId: hotspot.id, patch: { label: v.trim() } }) ?? undefined} />
        <TextField key={`h-${hotspot.id}`} label="案内文" multiline maxLength={180} value={hotspot.helpText} onCommit={(v) => dispatch({ type: 'hotspot/update', stepId: step.id, hotspotId: hotspot.id, patch: { helpText: v } }) ?? undefined} />
        <div className="field">
          <label htmlFor={selId}>移動先</label>
          <select
            id={selId}
            name="target"
            className="select"
            value={hotspot.targetStepId ?? ''}
            aria-invalid={hotspot.targetStepId === null || targetMissing || targetErr ? true : undefined}
            aria-describedby={`${selId}-msg`}
            onChange={(e) => setTargetErr(dispatch({ type: 'hotspot/target', stepId: step.id, hotspotId: hotspot.id, targetStepId: e.target.value || null }))}
          >
            <option value="">（未設定）</option>
            {targetMissing && <option value={hotspot.targetStepId!}>（削除されたステップ）</option>}
            {order.map((sid, i) => {
              const s = graph.steps[sid];
              if (!s || sid === step.id) return null;
              const cyc = wouldCreateCycle(adj, step.id, sid);
              return (
                <option key={sid} value={sid} disabled={cyc}>
                  {String(i + 1).padStart(2, '0')} {s.title}
                  {cyc ? '（循環になるため選べません）' : ''}
                </option>
              );
            })}
          </select>
          <p id={`${selId}-msg`} className={targetErr || hotspot.targetStepId === null || targetMissing ? 'field-error' : 'field-hint'}>
            {targetErr ?? (hotspot.targetStepId === null ? '移動先が未設定です' : targetMissing ? '移動先のステップが削除されています。選び直してください' : 'このボタンを押すと移動する画面')}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${selId}-order`}>順序（重なった時の優先・読み上げ順）</label>
          <input
            id={`${selId}-order`}
            className="input num"
            type="number"
            min={0}
            max={9}
            value={hotspot.order}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 0) dispatch({ type: 'hotspot/update', stepId: step.id, hotspotId: hotspot.id, patch: { order: n } });
            }}
          />
        </div>
      </div>
      <RectFields rect={hotspot.rect} onCommit={(r) => dispatch({ type: 'hotspot/rect', stepId: step.id, hotspotId: hotspot.id, rect: r })} />
      <div className="panel-section">
        <button type="button" className="btn btn-danger" onClick={() => dispatch({ type: 'hotspot/delete', stepId: step.id, hotspotId: hotspot.id })}>
          このクリック箇所を削除
        </button>
      </div>
    </>
  );
}

export function StepPanel(props: {
  graph: ProjectGraph;
  step: Step;
  revision: number;
  dispatch: Dispatch;
  onReplace: () => void;
  onRedact: () => void;
  onDeleted: () => void;
}) {
  const { graph, step, dispatch } = props;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newEntry, setNewEntry] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  const asset = graph.assets[step.imageAssetId];
  const reviewed = asset && step.redactionReviewedAssetHash === asset.sha256;
  const incoming = incomingLinks(graph, step.id);
  const isEntry = graph.project.entryStepId === step.id;
  const others = graph.project.stepOrder.filter((s) => s !== step.id);
  useEffect(() => {
    setConfirmDelete(false);
    setMsg(null);
  }, [step.id]);

  return (
    <>
      <div className="panel-section">
        <h2 className="h-screen" style={{ fontSize: 20 }}>画面の設定</h2>
        <TextField key={`t-${step.id}`} name="title" label="画面名" required maxLength={60} value={step.title} onCommit={(v) => dispatch({ type: 'step/update', stepId: step.id, patch: { title: v.trim() } }) ?? undefined} />
        <TextField key={`d-${step.id}`} label="説明（閲覧者に表示）" multiline maxLength={400} value={step.description} onCommit={(v) => dispatch({ type: 'step/update', stepId: step.id, patch: { description: v } }) ?? undefined} />
        <TextField
          key={`a-${step.id}`}
          name="altText"
          label="代替テキスト（画像の説明）"
          maxLength={240}
          value={step.altText}
          error={step.altText.trim() ? undefined : '代替テキストを入力してください'}
          onCommit={(v) => dispatch({ type: 'step/update', stepId: step.id, patch: { altText: v.trim() } }) ?? undefined}
        />
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className="label" style={{ fontSize: 14, fontWeight: 600 }}>画面の種類</legend>
          <label className="check">
            <input type="radio" name={`${id}-kind`} checked={step.kind === 'screen'} onChange={() => dispatch({ type: 'step/kind', stepId: step.id, kind: 'screen' })} />
            通常の画面（クリック箇所で次へ）
          </label>
          <label className="check">
            <input type="radio" name={`${id}-kind`} data-field="kind" checked={step.kind === 'finish'} onChange={() => dispatch({ type: 'step/kind', stepId: step.id, kind: 'finish' })} />
            完了画面（デモの終わり）
          </label>
        </fieldset>
        {isEntry ? (
          <p className="small muted">この画面が開始画面です。</p>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'step/setEntry', stepId: step.id })}>
            開始画面にする
          </button>
        )}
      </div>
      <div className="panel-section">
        <h3 className="h-panel">画像</h3>
        {reviewed ? (
          <p className="small status-ok">公開前の確認済み</p>
        ) : (
          <p className="small status-err" data-field="image">公開前の確認が必要です（要確認）</p>
        )}
        <button type="button" className="btn btn-secondary" name="image" onClick={props.onRedact}>
          {reviewed ? '隠す範囲を追加する' : '画像を確認する'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={props.onReplace}>
          画像を差し替える
        </button>
        {step.layoutReviewedRevision === undefined && (
          <div className="notice notice-warn">
            <p className="small">画像を差し替えました。全てのクリック箇所の位置を確認してから、下のボタンを押してください。</p>
            <button type="button" name="layout" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => dispatch({ type: 'step/confirmLayout', stepId: step.id, revision: props.revision })}>
              領域を確認しました
            </button>
          </div>
        )}
      </div>
      <div className="panel-section">
        <button type="button" className="btn btn-secondary" onClick={() => setMsg(dispatch({ type: 'step/duplicate', stepId: step.id }))}>
          この画面を複製
        </button>
        {!confirmDelete ? (
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            この画面を削除…
          </button>
        ) : (
          <div className="notice notice-err" role="alert">
            <p className="small">
              「{step.title}」を削除します。この画面へのリンクが{incoming.length}件あります。
              {incoming.length > 0 && '削除後、リンク元は「移動先なし」のエラーになり、書き出し前に選び直す必要があります。'}
            </p>
            {isEntry && others.length > 0 && (
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor={`${id}-entry`}>新しい開始画面</label>
                <select id={`${id}-entry`} className="select" value={newEntry} onChange={(e) => setNewEntry(e.target.value)}>
                  <option value="">選んでください</option>
                  {others.map((sid) => (
                    <option key={sid} value={sid}>
                      {graph.steps[sid]?.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-danger"
                disabled={isEntry && others.length > 0 && !newEntry}
                onClick={() => {
                  const e = dispatch({ type: 'step/delete', stepId: step.id, newEntryId: newEntry || undefined });
                  if (e) setMsg(e);
                  else props.onDeleted();
                }}
              >
                削除する
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
                やめる
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p className="field-error" role="alert">
            {msg}
          </p>
        )}
      </div>
    </>
  );
}
