import { useCallback, useEffect, useState } from 'react';
import { createProjectGraph } from '../domain/model';
import type { UUID } from '../domain/types';
import { PackageError, parseProjectZip } from '../export/packages';
import { DELETE_ALL_PHRASE, type ProjectSummary, type Storage, type StorageUsage } from '../platform/storage';
import { buildSampleProject } from './sample';
import { formatBytes, formatDate, LOGO_SRC, Modal } from './ui';

function Thumb({ storage, projectId, assetId }: { storage: Storage; projectId: UUID; assetId?: UUID }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!assetId) return;
    let u: string | undefined;
    let cancelled = false;
    storage
      .getAsset(projectId, assetId)
      .then((b) => {
        if (cancelled) return;
        u = URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>]));
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [storage, projectId, assetId]);
  return url ? <img className="card-thumb" src={url} alt="" /> : <span className="card-thumb" />;
}

function DataDialog({ storage, onClose, onChanged, projects }: { storage: Storage; onClose: () => void; onChanged: () => void; projects: ProjectSummary[] }) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [phrase, setPhrase] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => storage.usage().then(setUsage).catch((e) => setMsg(String(e))), [storage]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Modal title="データとバックアップ" onClose={onClose}>
      <section className="panel-section">
        <h3 className="h-panel">保存量</h3>
        <p className="num table-text">
          {usage ? `${usage.projects}件のデモ／${formatBytes(usage.bytes)}` : '計算中…'}
        </p>
        <p className="small muted">保存場所：{usage?.location ?? '—'}</p>
        <p className="small muted">
          データはこのパソコンの中だけに保存されます。販売者のサーバーには元々データがありません。パソコンの故障・削除に備え、各デモの書き出しから「編集用バックアップZIP」を保存してください。
        </p>
        <p className="small muted">25件・500MiB程度を目安に、不要なデモはバックアップしてから削除してください。</p>
      </section>
      <section className="panel-section">
        <h3 className="h-panel">すべて削除</h3>
        <p className="small">
          このパソコンに保存した全てのデモ（{projects.length}件）、加工済み画像、書き出し記録を削除します。書き出し済みのHTML・ZIPファイルは削除されません。元に戻せません。
        </p>
        <div className="field">
          <label htmlFor="del-all">確認のため「{DELETE_ALL_PHRASE}」と入力してください</label>
          <input id="del-all" className="input" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
        </div>
        <button
          type="button"
          className="btn btn-danger"
          disabled={phrase !== DELETE_ALL_PHRASE}
          onClick={async () => {
            try {
              await storage.deleteAll(phrase);
              setPhrase('');
              setMsg('すべて削除しました');
              onChanged();
              void load();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          すべて削除する
        </button>
        {msg && <p role="status">{msg}</p>}
      </section>
    </Modal>
  );
}

export function Library({ storage, onOpen }: { storage: Storage; onOpen: (id: UUID) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [showData, setShowData] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(() => {
    storage
      .listProjects()
      .then((p) => setProjects(p.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))))
      .catch((e) => setMsg({ ok: false, text: String(e) }));
  }, [storage]);
  useEffect(reload, [reload]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const g = createProjectGraph(name);
    try {
      await storage.createProject(g, []);
      setCreating(false);
      setNewName('');
      onOpen(g.project.id);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const sample = async () => {
    setBusy('サンプルを準備しています…');
    try {
      const { graph, assets } = await buildSampleProject();
      await storage.createProject(graph, assets);
      onOpen(graph.project.id);
    } catch (e) {
      setMsg({ ok: false, text: `サンプルを作成できませんでした：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setBusy('編集ファイルを確認しています…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await parseProjectZip(bytes);
      await storage.createProject(
        r.graph,
        Object.values(r.graph.assets).map((meta) => ({ meta, bytes: r.images.get(meta.id)! })),
      );
      setMsg({ ok: true, text: `「${r.graph.project.name}」を新しいデモとして復元しました` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof PackageError ? e.message : `復元できませんでした：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const filtered = (projects ?? []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="lib">
      <header className="lib-top">
        <div className="lib-top-inner">
          <img className="lib-logo" src={LOGO_SRC} alt="Tappivra" width={132} height={33} />
          <div className="lib-search">
            <label htmlFor="lib-q" className="visually-hidden">
              デモを検索
            </label>
            <input id="lib-q" className="input" type="search" placeholder="デモ名で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            デモを作る
          </button>
        </div>
      </header>
      <main className="lib-main">
        <div className="lib-actions">
          <h1 className="h-screen" style={{ marginRight: 'auto' }}>
            デモ一覧
          </h1>
          <label className="btn btn-secondary">
            編集ファイルを開く
            <input
              type="file"
              className="visually-hidden"
              accept=".zip,application/zip"
              data-testid="open-project-zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void restore(f);
              }}
            />
          </label>
          <button type="button" className="btn btn-secondary" onClick={sample} disabled={!!busy}>
            サンプルで試す
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowData(true)}>
            データとバックアップ
          </button>
        </div>
        <div aria-live="polite">
          {busy && <p className="muted">{busy}</p>}
          {msg && (
            <p className={msg.ok ? 'status-ok' : 'notice notice-err'} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
            </p>
          )}
        </div>
        {projects === null ? (
          <div className="lib-grid" aria-busy="true">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : projects.length === 0 ? (
          <div className="empty">
            <p className="h-screen">最初の操作デモを作りましょう</p>
            <p className="muted">画面画像を5枚ほど用意してください。</p>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              デモを作る
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <p className="h-panel">一致するデモはありません</p>
            <button type="button" className="btn btn-secondary" onClick={() => setQuery('')}>
              検索条件をクリア
            </button>
          </div>
        ) : (
          <ul className="lib-grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {filtered.map((p) => (
              <li key={p.id} className="card">
                <button type="button" className="card-open" onClick={() => onOpen(p.id)} aria-label={`「${p.name}」を開く`}>
                  <Thumb storage={storage} projectId={p.id} assetId={p.thumbAssetId} />
                  <span className="card-body">
                    <span className="h-panel truncate" title={p.name}>
                      {p.name}
                    </span>
                    <span className="table-text muted num">
                      {p.stepCount}ステップ・更新 {formatDate(p.updatedAt)}
                    </span>
                    <span className="small muted">バックアップ：{p.lastBackupAt ? formatDate(p.lastBackupAt) : '未作成'}</span>
                  </span>
                </button>
                <div className="card-foot">
                  <button type="button" className="btn btn-danger btn-small" onClick={() => setDeleting(p)}>
                    削除…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      {creating && (
        <Modal
          title="デモを作る"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
                やめる
              </button>
              <button type="button" className="btn btn-primary" onClick={create} disabled={!newName.trim()}>
                作成して編集
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="new-name">デモ名（1〜80字）</label>
            <input
              id="new-name"
              className="input"
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void create()}
            />
          </div>
          <p className="small muted">このパソコンのTappivra専用データベースに保存されます。画像はこの後の画面で取り込みます。</p>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="デモを削除"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setDeleting(null)} data-autofocus>
                やめる
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await storage.deleteProject(deleting.id).catch((e) => setMsg({ ok: false, text: String(e) }));
                  setDeleting(null);
                  reload();
                }}
              >
                「{deleting.name}」を削除
              </button>
            </>
          }
        >
          <p>
            「{deleting.name}」（{deleting.stepCount}ステップ）と、その加工済み画像をこのパソコンから削除します。元に戻せません。書き出し済みのファイルは削除されません。
          </p>
        </Modal>
      )}
      {showData && <DataDialog storage={storage} projects={projects ?? []} onClose={() => setShowData(false)} onChanged={reload} />}
    </div>
  );
}
