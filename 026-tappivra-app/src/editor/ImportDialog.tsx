import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetMeta, Rect, UUID } from '../domain/types';
import { round6 } from '../domain/ids';
import { containBox } from '../domain/rect';
import { finalizeImage, openPendingImage, releasePending, type PendingImage } from '../media/pipeline';
import { ImageInputError, precheckTotal } from '../media/sniff';
import { Modal } from './ui';

export interface ImportedImage {
  meta: AssetMeta;
  bytes: Uint8Array;
  reviewedHash: string;
  title: string;
  altText: string;
}

export interface ImportSource {
  blob: Blob;
  name: string;
}

const REVIEW_TEXT = 'この画像に公開したくない情報がないか確認しました';

export function ImportDialog(props: {
  sources: ImportSource[];
  projectId: UUID;
  mode: 'add' | 'replace' | 'redact';
  startNumber: number;
  onImported: (img: ImportedImage) => Promise<void>;
  onClose: () => void;
}) {
  const { sources, mode } = props;
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<PendingImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [masks, setMasks] = useState<Rect[]>([]);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [hideMode, setHideMode] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [title, setTitle] = useState('');
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const pendingRef = useRef<PendingImage | null>(null);

  useEffect(() => {
    try {
      precheckTotal(sources.map((s) => s.blob));
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
  }, [sources]);

  // 1枚ずつ読み込む（元画像はメモリー上のみ）
  useEffect(() => {
    if (fatal) return;
    const src = sources[index];
    if (!src) return;
    let cancelled = false;
    setPending(null);
    setError(null);
    setMasks([]);
    setReviewed(false);
    // 元ファイル名は公開物に入れないため、既定の画面名に使わない
    setTitle(mode === 'add' ? `画面${props.startNumber + doneCount}` : '');
    setAlt('');
    openPendingImage(src.blob, src.name)
      .then((p) => {
        if (cancelled) return releasePending(p);
        pendingRef.current = p;
        setPending(p);
      })
      .catch((e) => !cancelled && setError(e instanceof ImageInputError ? e.message : '画像を読み込めませんでした。別の画像を選んでください'));
    return () => {
      cancelled = true;
      releasePending(pendingRef.current);
      pendingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, sources, fatal]);

  const layout = useCallback(() => {
    const st = stageRef.current;
    const cv = canvasRef.current;
    if (!st || !cv || !pending) return;
    const b = containBox(st.clientWidth, st.clientHeight, pending.bitmap.width, pending.bitmap.height);
    setBox(b);
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(b.width * dpr));
    cv.height = Math.max(1, Math.round(b.height * dpr));
    cv.style.left = `${b.left}px`;
    cv.style.top = `${b.top}px`;
    cv.style.width = `${b.width}px`;
    cv.style.height = `${b.height}px`;
    cv.getContext('2d')?.drawImage(pending.bitmap, 0, 0, cv.width, cv.height);
  }, [pending]);

  useEffect(() => {
    layout();
    const st = stageRef.current;
    if (!st) return;
    const ro = new ResizeObserver(layout);
    ro.observe(st);
    return () => ro.disconnect();
  }, [layout]);

  const toNorm = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left - box.left) / box.width;
    const y = (e.clientY - r.top - box.top) / box.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };
  const start = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (!hideMode || !pending || busy) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = toNorm(e);
    setDraft({ ...start.current, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = toNorm(e);
    const s = start.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => {
    if (draft && draft.w > 0.003 && draft.h > 0.003) setMasks((m) => [...m, { x: round6(draft.x), y: round6(draft.y), w: round6(draft.w), h: round6(draft.h) }]);
    start.current = null;
    setDraft(null);
  };

  const next = () => {
    releasePending(pendingRef.current);
    pendingRef.current = null;
    if (index + 1 >= sources.length) props.onClose();
    else setIndex(index + 1);
  };

  const save = async (markReviewed: boolean) => {
    if (!pending) return;
    if (mode === 'add' && (!title.trim() || !alt.trim())) {
      setError('画面名と代替テキストを入力してください');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const done = await finalizeImage(pending, masks, props.projectId);
      await props.onImported({ ...done, reviewedHash: markReviewed ? done.meta.sha256 : '', title: title.trim(), altText: alt.trim() });
      setDoneCount((c) => c + 1);
      next();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const heading = mode === 'add' ? '画像を確認して取り込む' : mode === 'replace' ? '画像を差し替える' : '画像の秘密情報を隠す';

  return (
    <Modal title={heading} onClose={props.onClose} wide closeLabel="キャンセル">
      {fatal ? (
        <p className="notice notice-err" role="alert">
          {fatal}
        </p>
      ) : (
        <div className="imp">
          <div className="imp-main" style={{ display: 'grid', gap: 12, gridTemplateRows: 'auto 1fr', minHeight: 0 }}>
            <p className="num" aria-live="polite">
              画像 {index + 1} / {sources.length}
              <span className="small muted truncate" style={{ display: 'inline-block', maxWidth: 240, verticalAlign: 'bottom', marginLeft: 8 }} title={sources[index]?.name}>
                {sources[index]?.name}
              </span>
              <span className="muted small">　画像は端末内でのみ処理されます。元ファイルは変更しません。</span>
            </p>
            <div
              ref={stageRef}
              className="imp-stage"
              data-testid="import-stage"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              aria-label="画像。隠すモードではドラッグで黒い四角を置けます"
            >
              {pending && <canvas ref={canvasRef} style={{ position: 'absolute' }} aria-hidden="true" />}
              {!pending && !error && <p style={{ padding: 24 }}>読み込み中…</p>}
              {[...masks, ...(draft ? [draft] : [])].map((m, i) => (
                <div
                  key={i}
                  className={i < masks.length ? 'imp-mask' : 'imp-draft'}
                  data-testid={i < masks.length ? 'mask' : undefined}
                  style={{ left: box.left + m.x * box.width, top: box.top + m.y * box.height, width: m.w * box.width, height: m.h * box.height }}
                />
              ))}
            </div>
          </div>
          <div className="imp-side">
            {error && (
              <p className="notice notice-err" role="alert">
                {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" aria-pressed={hideMode} onClick={() => setHideMode(!hideMode)}>
                隠す{hideMode ? '（オン）' : ''}
              </button>
              <button type="button" className="btn btn-secondary" disabled={masks.length === 0 || busy} onClick={() => setMasks((m) => m.slice(0, -1))}>
                1つ戻す
              </button>
            </div>
            <p className="small muted">
              黒塗りは画像へ焼き込まれ、保存後は元に戻せません（{masks.length}か所）。ぼかしや半透明では隠しません。自動検出は行いません。
            </p>
            {mode === 'add' && (
              <>
                <div className="field">
                  <label htmlFor="imp-title">画面名</label>
                  <input id="imp-title" className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="imp-alt">代替テキスト（画像の説明）</label>
                  <input id="imp-alt" className="input" value={alt} maxLength={240} onChange={(e) => setAlt(e.target.value)} />
                </div>
              </>
            )}
            <label className="check">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} disabled={!pending} />
              <span>{REVIEW_TEXT}</span>
            </label>
            <button type="button" className="btn btn-primary" disabled={!pending || !reviewed || busy} onClick={() => save(true)}>
              {busy ? '保存中…' : '確認して保存'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!pending || busy} onClick={() => save(false)}>
              確認せずに保存（書き出し前に要確認）
            </button>
            {sources.length > 1 && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={next}>
                この画像を取り込まない
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
