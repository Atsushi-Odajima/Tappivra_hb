import { useMemo, useRef, useState } from 'react';
import { runtimeCss, runtimeJs } from 'virtual:tappivra-viewer-runtime';
import { newId, nowIso } from '../domain/ids';
import { LIMITS, MiB } from '../domain/limits';
import { runPreflight, type PreflightIssue } from '../domain/preflight';
import type { ProjectGraph, UUID } from '../domain/types';
import { buildDemoHtml } from '../export/html';
import { buildDemoZip, buildProjectZip } from '../export/packages';
import { slugify, toDemoDocument } from '../export/publicDoc';
import { sha256Hex } from '../media/hash';
import type { ExportKind, Storage } from '../platform/storage';
import { formatBytes, Modal } from './ui';

type Phase = 'idle' | 'preparing' | 'packing' | 'saving' | 'done' | 'cancelled' | 'error';
const PHASE_TEXT: Record<Phase, string> = {
  idle: '',
  preparing: '画像を準備しています…',
  packing: 'ファイルを作成しています…',
  saving: '保存先を選んでください（保存が終わるまでお待ちください）…',
  done: '',
  cancelled: '書き出しを取り消しました。ファイルは作成していません。',
  error: '',
};
const PHASE_PCT: Record<Phase, number> = { idle: 0, preparing: 20, packing: 55, saving: 80, done: 100, cancelled: 0, error: 0 };

export function fileNameFor(kind: ExportKind, g: ProjectGraph, revision: number): string {
  const slug = slugify(g.project.name);
  if (kind === 'html') return `tappivra-demo_${slug}_r${revision}.html`;
  if (kind === 'demo-zip') return `${slug}.tappivra-demo.zip`;
  return `${slug}.tappivra-project.zip`;
}

export function ExportDialog(props: {
  graph: ProjectGraph;
  revision: number;
  storage: Storage;
  getBytes: (id: UUID) => Uint8Array | undefined;
  onGoto: (issue: PreflightIssue) => void;
  onExported: (kind: ExportKind, revision: number) => void;
  onClose: () => void;
}) {
  // 書き出し開始時点のsnapshotを固定（ダイアログ表示中は編集できない）
  const [snapshot] = useState(props.graph);
  const [revision] = useState(props.revision);
  const pf = useMemo(() => runPreflight(snapshot, runtimeJs.length + runtimeCss.length + 32 * 1024), [snapshot]);
  const [kind, setKind] = useState<ExportKind>(pf.ok ? 'html' : 'project-zip');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const errors = pf.issues.filter((i) => i.level === 'error');
  const warnings = pf.issues.filter((i) => i.level === 'warning');
  const publicKind = kind !== 'project-zip';
  const blocked = publicKind && !pf.ok;
  const busy = phase === 'preparing' || phase === 'packing' || phase === 'saving';

  const run = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setResult(null);
    setError(null);
    const check = () => {
      if (ac.signal.aborted) throw new DOMException('cancelled', 'AbortError');
    };
    try {
      setPhase('preparing');
      const images = new Map<UUID, Uint8Array>();
      const needed = publicKind ? new Set(snapshot.project.stepOrder.map((id) => snapshot.steps[id]!.imageAssetId)) : new Set(Object.keys(snapshot.assets));
      for (const id of needed) {
        const b = props.getBytes(id) ?? (await props.storage.getAsset(snapshot.project.id, id));
        images.set(id, b);
        check();
      }
      setPhase('packing');
      await new Promise((r) => setTimeout(r, 0));
      const t = nowIso();
      let bytes: Uint8Array;
      if (kind === 'html') {
        const doc = toDemoDocument(snapshot, t);
        bytes = new TextEncoder().encode(await buildDemoHtml(doc, images, { js: runtimeJs, css: runtimeCss }));
      } else if (kind === 'demo-zip') {
        bytes = buildDemoZip(toDemoDocument(snapshot, t), images);
      } else {
        bytes = buildProjectZip({ ...snapshot, project: { ...snapshot.project, revision, lastBackupAt: t } }, images, t);
      }
      const max = kind === 'project-zip' ? LIMITS.maxProjectZipBytes : LIMITS.maxDemoBytes;
      if (bytes.length > max) throw new Error(`ファイルが上限（${max / MiB}MiB）を超えました（${formatBytes(bytes.length)}）。画像を減らしてください`);
      check();
      setPhase('saving');
      const name = fileNameFor(kind, snapshot, revision);
      const saved = await props.storage.saveFile(kind, name, bytes);
      if (!saved.saved) {
        setPhase('cancelled');
        return;
      }
      await props.storage
        .recordExport({
          id: newId(),
          projectId: snapshot.project.id,
          projectRevision: revision,
          kind,
          createdAt: t,
          fileName: saved.fileName ?? name,
          sha256: await sha256Hex(bytes),
          preflightSummary: `errors=${errors.length};warnings=${warnings.length}`,
        })
        .catch(() => undefined);
      setPhase('done');
      setResult(`保存しました：${saved.fileName ?? name}（${formatBytes(bytes.length)}）`);
      props.onExported(kind, revision);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setPhase('cancelled');
      else {
        setPhase('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <Modal title="書き出し前チェック" onClose={busy ? () => abort.current?.abort() : props.onClose} closeLabel={busy ? '取消' : '閉じる'} wide>
      <section className="panel-section" aria-labelledby="ex-scope">
        <h3 id="ex-scope" className="h-panel">データ範囲</h3>
        <p className="table-text">
          閲覧用（HTML・閲覧ZIP）に含めるもの：{snapshot.project.stepOrder.length}画面の加工済み画像、画面名・説明・代替テキスト、クリック箇所と案内文。
        </p>
        <p className="table-text">含めないもの：内部メモ、元の画像、ファイル名・保存場所、編集履歴、書き出し記録。</p>
        <p className="small muted">画面名や説明文に個人情報が含まれていないかも確認してください。自動検出は行いません。</p>
      </section>
      <section className="panel-section" aria-labelledby="ex-check">
        <h3 id="ex-check" className="h-panel">検査項目</h3>
        {pf.ok ? (
          <p className="status-ok">書き出しの準備ができました</p>
        ) : (
          <p className="status-err">{errors.length}件の要確認があります。修正すると閲覧用データを書き出せます。</p>
        )}
        {pf.issues.length > 0 && (
          <ul className="issues" data-testid="issues">
            {pf.issues.map((i, n) => (
              <li key={n} className={`issue${i.level === 'error' ? ' issue-err' : ''}`} data-code={i.code}>
                <span className={i.level === 'error' ? 'status-err' : 'status-warn'}>
                  {i.level === 'error' ? '要確認：' : '注意：'}
                  {i.message}
                </span>
                {(i.stepId || i.field === 'kind' || i.field === 'entry') && (
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => props.onGoto(i)} disabled={busy}>
                    該当箇所へ
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel-section" aria-labelledby="ex-size">
        <h3 id="ex-size" className="h-panel">容量</h3>
        <p className="table-text num">
          画像合計 {formatBytes(pf.imageBytes)}／HTMLの見込み {formatBytes(pf.estimatedHtmlBytes)}（上限 {LIMITS.maxDemoBytes / MiB}MiB、{LIMITS.warnDemoBytes / MiB}MiB超で警告）
        </p>
      </section>
      <section className="panel-section" aria-labelledby="ex-format">
        <h3 id="ex-format" className="h-panel">形式</h3>
        <div className="formats" role="radiogroup" aria-labelledby="ex-format">
          <label className="format">
            <input type="radio" name="kind" checked={kind === 'html'} onChange={() => setKind('html')} disabled={busy} />
            <span>
              <strong>閲覧用HTML</strong>（パソコンでダブルクリックして開く。1ファイル・通信なし）
              {!pf.ok && <span className="field-error small">要確認をすべて解消すると選べます</span>}
            </span>
          </label>
          <label className="format">
            <input type="radio" name="kind" checked={kind === 'demo-zip'} onChange={() => setKind('demo-zip')} disabled={busy} />
            <span>
              <strong>閲覧用ZIP</strong>（iPhone・AndroidでTappivra Viewerから開く）
              {!pf.ok && <span className="field-error small">要確認をすべて解消すると選べます</span>}
            </span>
          </label>
          <label className="format">
            <input type="radio" name="kind" checked={kind === 'project-zip'} onChange={() => setKind('project-zip')} disabled={busy} />
            <span>
              <strong>編集用バックアップZIP</strong>（再編集用。未完成でも保存できます）
              <span className="small status-warn" style={{ display: 'block' }}>
                内部メモを含みます。顧客配布用ではありません。
              </span>
            </span>
          </label>
        </div>
        <p className="small muted">閲覧用には元画像ではなく加工済み画像だけを入れ、内部メモは含めません。</p>
      </section>
      <section aria-live="polite" style={{ display: 'grid', gap: 8 }}>
        {busy && (
          <>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={PHASE_PCT[phase]}>
              <div style={{ width: `${PHASE_PCT[phase]}%` }} />
            </div>
            <p className="small">{PHASE_TEXT[phase]}</p>
          </>
        )}
        {phase === 'cancelled' && <p className="small muted">{PHASE_TEXT.cancelled}</p>}
        {result && (
          <p className="status-ok" data-testid="export-result">
            {result}
          </p>
        )}
        {error && (
          <p className="notice notice-err" role="alert">
            保存できませんでした：{error}
          </p>
        )}
      </section>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {busy ? (
          <button type="button" className="btn btn-secondary" onClick={() => abort.current?.abort()} disabled={phase === 'saving'}>
            取消
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy || blocked}>
          {kind === 'project-zip' ? 'バックアップを保存' : '書き出して保存'}
        </button>
      </div>
    </Modal>
  );
}
