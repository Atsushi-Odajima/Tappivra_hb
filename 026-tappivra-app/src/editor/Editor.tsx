import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS } from '../domain/limits';
import { CommandError, historyApply, historyInit, historyRedo, historyUndo, type Command, type History } from '../domain/model';
import type { PreflightIssue } from '../domain/preflight';
import { rectsOverlap } from '../domain/rect';
import type { ProjectGraph, UUID } from '../domain/types';
import { ConflictError, type ExportKind, type Storage } from '../platform/storage';
import { ExportDialog } from './ExportDialog';
import { ImportDialog, type ImportedImage, type ImportSource } from './ImportDialog';
import { HotspotPanel, StepPanel } from './Panels';
import { PreviewDialog } from './PreviewDialog';
import { StageEditor, type Zoom } from './StageEditor';
import { StepList } from './StepList';
import { LOGO_SRC } from './ui';
import { useAssets } from './useAssets';

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
type ImportState = { sources: ImportSource[]; mode: 'add' | 'replace' | 'redact'; stepId?: UUID } | null;

const RECT_ERR: Record<string, string> = {
  'not-finite': '数値を入力してください',
  negative: '0以上の値にしてください',
  'too-small': '幅・高さは画像の1%以上にしてください',
  overflow: '画像の端からはみ出さないようにしてください',
};

export function Editor({ storage, initial, onBack }: { storage: Storage; initial: ProjectGraph; onBack: () => void }) {
  const [hist, setHist] = useState<History>(() => historyInit(initial));
  const histRef = useRef(hist);
  histRef.current = hist;
  const g = hist.present;
  const [savedRevision, setSavedRevision] = useState(initial.project.revision);
  const revRef = useRef(initial.project.revision);
  const savedGraphRef = useRef<ProjectGraph>(initial);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<UUID | null>(initial.project.stepOrder[0] ?? null);
  const [selectedHotspotId, setSelectedHotspotId] = useState<UUID | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [importState, setImportState] = useState<ImportState>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [cmdMsg, setCmdMsg] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);
  const assets = useAssets(storage, g.project.id, g.assets);
  const savingRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const blocked = status === 'conflict';

  // ---- 自動保存（最終編集800ms後。保存済みはコミット完了時のみ） ----
  const saveNow = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (savingRef.current || blocked) return;
    const graph = histRef.current.present;
    if (graph === savedGraphRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      const exp = revRef.current;
      const rev = await storage.saveProject({ ...graph, project: { ...graph.project, revision: exp } }, exp);
      revRef.current = rev;
      savedGraphRef.current = graph;
      setSavedRevision(rev);
      setSaveError(null);
      if (histRef.current.present === graph) setStatus('saved');
      else {
        setStatus('dirty');
        timer.current = window.setTimeout(() => void saveNow(), LIMITS.autosaveDelayMs);
      }
    } catch (e) {
      if (e instanceof ConflictError) {
        setStatus('conflict');
        setSaveError(e.message);
      } else {
        setStatus('error');
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      savingRef.current = false;
    }
  }, [storage, blocked]);

  useEffect(() => {
    if (g === savedGraphRef.current || blocked) return;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveNow(), LIMITS.autosaveDelayMs);
    return () => window.clearTimeout(timer.current);
  }, [g, saveNow, blocked]);

  const dispatch = useCallback(
    (c: Command): string | null => {
      if (blocked) return '競合のため編集できません。読み込み直してください';
      try {
        const next = historyApply(histRef.current, c);
        histRef.current = next;
        setHist(next);
        setCmdMsg(null);
        return null;
      } catch (e) {
        const m = e instanceof CommandError ? (RECT_ERR[e.message] ?? e.message) : String(e);
        setCmdMsg(m);
        return m;
      }
    },
    [blocked],
  );

  /** 書き出し記録など、Undo対象外のメタ情報更新 */
  const patchMeta = (patch: Partial<ProjectGraph['project']>) => {
    const h = histRef.current;
    const next = { ...h, present: { ...h.present, project: { ...h.present.project, ...patch } } };
    histRef.current = next;
    setHist(next);
  };

  const undo = useCallback(() => {
    if (blocked) return;
    const n = historyUndo(histRef.current);
    histRef.current = n;
    setHist(n);
  }, [blocked]);
  const redo = useCallback(() => {
    if (blocked) return;
    const n = historyRedo(histRef.current);
    histRef.current = n;
    setHist(n);
  }, [blocked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || showExport || showPreview || importState) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveNow, showExport, showPreview, importState]);

  // 選択の整合
  const step = selectedStepId ? g.steps[selectedStepId] : undefined;
  useEffect(() => {
    if (!step && g.project.stepOrder.length) setSelectedStepId(g.project.stepOrder[0]!);
    if (step && selectedHotspotId && !step.hotspots.some((h) => h.id === selectedHotspotId)) setSelectedHotspotId(null);
  }, [g, step, selectedHotspotId]);
  const hotspot = step?.hotspots.find((h) => h.id === selectedHotspotId);

  useEffect(() => {
    if (!focusField) return;
    const id = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.ed-right [name="${focusField}"], .ed-right [data-field="${focusField}"]`);
      el?.focus();
      setFocusField(null);
    }, 50);
    return () => window.clearTimeout(id);
  }, [focusField, selectedStepId, selectedHotspotId]);

  const overlapping = useMemo(() => {
    const s = new Set<UUID>();
    if (step)
      for (const a of step.hotspots) for (const b of step.hotspots) if (a.id !== b.id && rectsOverlap(a.rect, b.rect)) s.add(a.id);
    return s;
  }, [step]);

  const onImported = async (img: ImportedImage) => {
    await storage.putAsset(img.meta, img.bytes);
    assets.add(img.meta, img.bytes);
    const st = importState;
    if (st?.mode === 'add') {
      const err = dispatch({ type: 'step/add', asset: img.meta, title: img.title, altText: img.altText, reviewedHash: img.reviewedHash });
      if (err) throw new Error(err);
      const newest = histRef.current.present.project.stepOrder.at(-1);
      if (newest) setSelectedStepId(newest);
    } else if (st?.stepId) {
      const err = dispatch({ type: 'step/replaceImage', stepId: st.stepId, asset: img.meta, reviewedHash: img.reviewedHash, keepLayout: st.mode === 'redact' });
      if (err) throw new Error(err);
    }
  };

  const openRedact = (mode: 'replace' | 'redact') => {
    if (!step) return;
    if (mode === 'redact') {
      const meta = g.assets[step.imageAssetId];
      const bytes = assets.bytes(step.imageAssetId);
      if (!meta || !bytes) return;
      setImportState({ mode, stepId: step.id, sources: [{ blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: meta.mime }), name: step.title }] });
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) setImportState({ mode, stepId: step.id, sources: [{ blob: f, name: f.name }] });
      };
      input.click();
    }
  };

  const back = async () => {
    if (histRef.current.present !== savedGraphRef.current && !blocked) await saveNow();
    if (histRef.current.present !== savedGraphRef.current && !window.confirm('保存できていない変更があります。編集画面を閉じますか？')) return;
    // 現在保存済みのグラフが参照しない画像を整理（Undo履歴はここで破棄される）
    await storage.gcAssets(g.project.id, Object.keys(savedGraphRef.current.assets)).catch(() => undefined);
    onBack();
  };

  const gotoIssue = (i: PreflightIssue) => {
    setShowExport(false);
    if (i.stepId) setSelectedStepId(i.stepId);
    setSelectedHotspotId(i.hotspotId ?? null);
    setRightOpen(true);
    setFocusField(i.field);
  };

  const onExported = (kind: ExportKind, revision: number) => {
    if (kind === 'project-zip') patchMeta({ lastBackupAt: new Date().toISOString() });
    else patchMeta({ lastExportRevision: revision });
  };

  const saveText =
    status === 'saved' ? '保存済み' : status === 'saving' ? '保存中…' : status === 'dirty' ? '未保存の変更' : status === 'conflict' ? '競合しました' : '保存できませんでした';

  return (
    <>
      <main className="narrow-msg" aria-label="画面幅の案内">
        <img src={LOGO_SRC} alt="Tappivra" width={132} />
        <p className="h-screen">編集はPCで行ってください</p>
        <p>Tappivraの編集は幅1024px以上の画面が必要です。スマホでは閲覧用ビューアーでデモを見られます（編集はできません）。</p>
        <button type="button" className="btn btn-secondary" onClick={back}>
          ライブラリーへ戻る
        </button>
      </main>
      <div className="ed ed-only">
        <div aria-live="polite" className="visually-hidden">
          {cmdMsg ?? ''}
        </div>
        <header className="ed-top" style={{ gridRow: 2 }}>
          <button type="button" className="btn btn-secondary btn-small" onClick={back}>
            ← 戻る
          </button>
          <img className="ed-logo" src={LOGO_SRC} alt="Tappivra" />
          <div className="ed-name">
            <label htmlFor="ed-name" className="visually-hidden">
              デモ名
            </label>
            <input
              id="ed-name"
              key={g.project.name}
              className="input"
              defaultValue={g.project.name}
              maxLength={80}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== g.project.name) dispatch({ type: 'project/update', patch: { name: v } });
                else e.target.value = g.project.name;
              }}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
            />
            <span className={`ed-save ${status === 'saved' ? 'status-ok' : status === 'error' || status === 'conflict' ? 'status-err' : 'muted'}`} role="status" data-testid="save-status">
              {saveText}
            </span>
            {status === 'error' && (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void saveNow()}>
                もう一度保存
              </button>
            )}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setShowPreview(true)} disabled={g.project.stepOrder.length === 0}>
            プレビュー
          </button>
          <button type="button" className="btn btn-primary" onClick={async () => {
              await saveNow();
              setShowExport(true);
            }}
            disabled={blocked}
          >
            書き出し
          </button>
        </header>
        {(status === 'error' || status === 'conflict') && (
          <div className="banner" role="alert" aria-label="保存エラー" style={{ gridRow: 1, color: 'var(--error)', background: 'var(--error-soft)' }}>
            {status === 'conflict' ? `${saveError ?? ''}　古い編集内容での上書きはしません。` : `保存できませんでした：${saveError ?? ''}　直前に保存できた内容は保持されています。`}
            {status === 'conflict' && (
              <button type="button" className="btn btn-secondary btn-small" style={{ marginLeft: 12 }} onClick={onBack}>
                ライブラリーへ戻って読み込み直す
              </button>
            )}
          </div>
        )}
        <div className="ed-body" style={{ gridRow: 3 }}>
          <StepList
            graph={g}
            selectedStepId={selectedStepId}
            thumbUrl={assets.url}
            onSelect={(id) => {
              setSelectedStepId(id);
              setSelectedHotspotId(null);
            }}
            onMove={(id, d) => dispatch({ type: 'step/move', stepId: id, delta: d })}
            onReorder={(id, i) => dispatch({ type: 'step/reorder', stepId: id, toIndex: i })}
            onAddImages={(files) => setImportState({ mode: 'add', sources: files.map((f) => ({ blob: f, name: f.name })) })}
          />
          <main className="ed-center">
            <h1 className="h-screen">画面の押せる場所を指定</h1>
            <div className="ed-toolbar">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!step || step.hotspots.length >= LIMITS.maxHotspotsPerStep || blocked}
                onClick={() => {
                  if (!step) return;
                  const before = new Set(step.hotspots.map((h) => h.id));
                  if (!dispatch({ type: 'hotspot/add', stepId: step.id })) {
                    const added = histRef.current.present.steps[step.id]?.hotspots.find((h) => !before.has(h.id));
                    if (added) {
                      setSelectedHotspotId(added.id);
                      setRightOpen(true);
                    }
                  }
                }}
              >
                ＋ クリック箇所を追加
              </button>
              <button type="button" className="btn btn-secondary" disabled={!step} onClick={() => openRedact('redact')}>
                隠す
              </button>
              <button type="button" className="btn btn-secondary" disabled={hist.past.length === 0 || blocked} onClick={undo} aria-label={`元に戻す（残り${hist.past.length}）`}>
                元に戻す
              </button>
              <button type="button" className="btn btn-secondary" disabled={hist.future.length === 0 || blocked} onClick={redo}>
                やり直す
              </button>
              <span className="spacer" />
              <label htmlFor="ed-zoom" className="visually-hidden">
                表示倍率
              </label>
              <select id="ed-zoom" className="select" style={{ width: 120 }} value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : (Number(e.target.value) as Zoom))}>
                {[25, 50, 75, 100, 150].map((z) => (
                  <option key={z} value={z}>
                    {z}%
                  </option>
                ))}
                <option value="fit">フィット</option>
              </select>
              <button type="button" className="btn btn-secondary" onClick={() => setZoom('fit')} aria-pressed={zoom === 'fit'}>
                フィット
              </button>
              <button type="button" className="btn btn-secondary pc-only" onClick={() => setRightOpen(true)}>
                プロパティ
              </button>
            </div>
            {step ? (
              <StageEditor
                step={step}
                asset={g.assets[step.imageAssetId]}
                url={assets.url(step.imageAssetId)}
                zoom={zoom}
                selectedHotspotId={selectedHotspotId}
                overlapping={overlapping}
                onSelect={setSelectedHotspotId}
                onCommitRect={(id, rect) => dispatch({ type: 'hotspot/rect', stepId: step.id, hotspotId: id, rect })}
                onNudge={(id, dx, dy) => dispatch({ type: 'hotspot/nudge', stepId: step.id, hotspotId: id, dx, dy })}
              />
            ) : (
              <div className="stage-wrap" style={{ display: 'grid', placeItems: 'center' }}>
                <p className="muted">{g.project.stepOrder.length ? '左のステップを選択してください' : '左の「画像を追加」から画面画像を取り込んでください'}</p>
              </div>
            )}
            <div className="small muted">
              <p>画像は端末内で処理されます。</p>
              {hotspot && step && (
                <p style={{ color: 'var(--ink)' }}>
                  選択した領域 → {hotspot.targetStepId && g.steps[hotspot.targetStepId] ? `ステップ${String(g.project.stepOrder.indexOf(hotspot.targetStepId) + 1).padStart(2, '0')}「${g.steps[hotspot.targetStepId]!.title}」` : '移動先未設定'}
                </p>
              )}
              {overlapping.size > 0 && <p className="status-warn">クリック箇所が重なっています。順序を確認してください。</p>}
              {cmdMsg && (
                <p className="field-error" role="alert">
                  {cmdMsg}
                </p>
              )}
            </div>
          </main>
          <aside className={`ed-right${rightOpen ? ' open' : ''}`} aria-label="プロパティ">
            <button type="button" className="btn btn-secondary btn-small ed-right-close" onClick={() => setRightOpen(false)}>
              パネルを閉じる
            </button>
            {step && hotspot ? (
              <HotspotPanel graph={g} step={step} hotspot={hotspot} dispatch={dispatch} onClose={() => setSelectedHotspotId(null)} />
            ) : step ? (
              <StepPanel
                graph={g}
                step={step}
                revision={savedRevision}
                dispatch={dispatch}
                onReplace={() => openRedact('replace')}
                onRedact={() => openRedact('redact')}
                onDeleted={() => setSelectedStepId(null)}
              />
            ) : (
              <p className="muted">左のステップを選択してください</p>
            )}
            <div className="panel-section">
              <h3 className="h-panel">内部メモ</h3>
              <p className="small muted">閲覧用データには含まれません（編集用バックアップZIPには含まれます）。</p>
              <label htmlFor="ed-notes" className="visually-hidden">
                内部メモ
              </label>
              <textarea
                id="ed-notes"
                key={`n-${g.project.privateNotes.length}`}
                className="textarea"
                maxLength={2000}
                defaultValue={g.project.privateNotes}
                onBlur={(e) => e.target.value !== g.project.privateNotes && dispatch({ type: 'project/update', patch: { privateNotes: e.target.value } })}
              />
            </div>
          </aside>
        </div>
      </div>
      {importState && (
        <ImportDialog
          sources={importState.sources}
          mode={importState.mode}
          projectId={g.project.id}
          startNumber={g.project.stepOrder.length + 1}
          onImported={onImported}
          onClose={() => setImportState(null)}
        />
      )}
      {showPreview && <PreviewDialog graph={g} url={assets.url} onClose={() => setShowPreview(false)} />}
      {showExport && (
        <ExportDialog
          graph={g}
          revision={savedRevision}
          storage={storage}
          getBytes={assets.bytes}
          onGoto={gotoIssue}
          onExported={onExported}
          onClose={() => setShowExport(false)}
        />
      )}
    </>
  );
}
