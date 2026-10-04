import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS, MESSAGES, MiB } from '../domain/limits';
import { PackageError, parseDemoZip, type ParsedDemo } from '../export/packages';
import { mountViewer, type ViewerHandle } from '../viewer/runtime';
import { deleteAllSaved, deleteSaved, listSaved, loadSaved, saveDemo, type SavedDemoMeta } from './deviceStore';

const BASE = import.meta.env.BASE_URL;

interface Opened extends ParsedDemo {
  bytes: Uint8Array;
  urls: Map<string, string>;
  savedMeta?: SavedDemoMeta;
}

function DemoView({ demo, onClose, onSave, info }: { demo: Opened; onClose: () => void; onSave: () => void; info: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<ViewerHandle | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    handle.current = mountViewer(ref.current, { doc: demo.doc, imageUrl: (id) => demo.urls.get(id) ?? '' });
    return () => handle.current?.destroy();
  }, [demo]);
  return (
    <div className="pwa-demo">
      <div className="pwa-demo-bar">
        <button type="button" className="tv-btn tv-btn-secondary" onClick={onClose}>
          ← 一覧へ
        </button>
        <img src={`${BASE}brand/logo_horizontal.svg`} alt="Tappivra Viewer" width={120} height={30} className="pwa-logo" />
        {!demo.savedMeta && (
          <button type="button" className="tv-btn tv-btn-secondary" onClick={onSave}>
            この端末へ保存
          </button>
        )}
      </div>
      <div className="pwa-save">
        {demo.savedMeta && <p className="pwa-small">この端末に保存済み（保存した版：{new Date(demo.savedMeta.savedAt).toLocaleString()}）</p>}
        {info && (
          <p className="pwa-small" role="status">
            {info}
          </p>
        )}
      </div>
      <div ref={ref} />
    </div>
  );
}

export function ViewerApp() {
  const [demo, setDemo] = useState<Opened | null>(null);
  const [saved, setSaved] = useState<SavedDemoMeta[]>([]);
  const [storageOk, setStorageOk] = useState(true);
  const [busy, setBusy] = useState<{ text: string; cancel?: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingLarge, setPendingLarge] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const token = useRef(0);

  const refresh = useCallback(() => {
    listSaved()
      .then((l) => {
        setSaved(l);
        setStorageOk(true);
      })
      .catch(() => setStorageOk(false));
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    // Service Workerはアプリシェルのみをキャッシュ。更新は次回読み込みで反映（強制リロードしない）
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker
        .register(`${BASE}sw.js`, { scope: BASE })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            w?.addEventListener('statechange', () => {
              if (w.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true);
            });
          });
        })
        .catch(() => undefined);
    }
  }, []);

  const closeDemo = () => {
    if (demo) for (const u of demo.urls.values()) URL.revokeObjectURL(u);
    setDemo(null);
    refresh();
  };

  const openBytes = async (bytes: Uint8Array, savedMeta?: SavedDemoMeta) => {
    const my = ++token.current;
    setError(null);
    setInfo(null);
    setBusy({ text: '閲覧データを確認しています…', cancel: () => (token.current++, setBusy(null)) });
    try {
      const parsed = await parseDemoZip(bytes);
      if (my !== token.current) return;
      const urls = new Map<string, string>();
      for (const [id, img] of parsed.images) urls.set(id, URL.createObjectURL(new Blob([img.bytes as Uint8Array<ArrayBuffer>], { type: img.mime })));
      // 実デコードの確認
      for (const [id, u] of urls) {
        const ok = await new Promise<boolean>((res) => {
          const im = new Image();
          im.onload = () => res(true);
          im.onerror = () => res(false);
          im.src = u;
        });
        if (!ok) {
          for (const x of urls.values()) URL.revokeObjectURL(x);
          throw new PackageError(`画像を表示できません（${id.slice(0, 8)}）`);
        }
      }
      if (my !== token.current) return;
      setDemo({ ...parsed, bytes, urls, savedMeta });
    } catch (e) {
      if (my !== token.current) return;
      setError(e instanceof PackageError ? e.message : MESSAGES.notDemo);
    } finally {
      if (my === token.current) setBusy(null);
    }
  };

  const onFile = async (f: File) => {
    setError(null);
    if (f.size > LIMITS.maxDemoBytes) {
      setError(`閲覧データが大きすぎます（上限${LIMITS.maxDemoBytes / MiB}MiB）`);
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (f.size > LIMITS.iphoneRecommendedBytes) {
      setPendingLarge({ bytes, name: f.name });
      return;
    }
    await openBytes(bytes);
  };

  const saveToDevice = async () => {
    if (!demo) return;
    const meta: SavedDemoMeta = { id: demo.doc.id, title: demo.doc.title, savedAt: new Date().toISOString(), generatedAt: demo.doc.generatedAt, byteLength: demo.bytes.length };
    try {
      await saveDemo(meta, demo.bytes);
      setDemo({ ...demo, savedMeta: meta });
      setInfo('この端末に保存しました。ブラウザーやOSの操作・容量不足で消えることがあります。バックアップではありません。');
    } catch {
      setInfo(MESSAGES.storageFull);
    }
  };

  if (demo) return <DemoView demo={demo} onClose={closeDemo} onSave={saveToDevice} info={info} />;

  return (
    <div className="pwa-home">
      <header className="pwa-header">
        <img src={`${BASE}brand/logo_horizontal.svg`} alt="Tappivra" width={160} height={40} className="pwa-logo" />
      </header>
      <main className="pwa-main">
        <h1 className="pwa-h1">デモを見る</h1>
        <p className="pwa-muted">作成者から受け取った閲覧用ZIP（.tappivra-demo.zip）を選んでください。データは端末内で読み込み、どこにも送信しません。登録・ログインは不要です。</p>
        {updateReady && <p className="pwa-small" role="status">新しいバージョンがあります。次にこのページを開いたときに反映されます。</p>}
        <div className="pwa-actions">
          <label className="tv-btn tv-btn-primary pwa-file">
            閲覧データを開く
            <input
              type="file"
              accept=".zip,application/zip"
              className="tv-visually-hidden"
              data-testid="open-demo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onFile(f);
              }}
            />
          </label>
          <button
            type="button"
            className="tv-btn tv-btn-secondary"
            onClick={async () => {
              try {
                const r = await fetch(`${BASE}samples/quickstart.tappivra-demo.zip`);
                if (!r.ok) throw new Error();
                await openBytes(new Uint8Array(await r.arrayBuffer()));
              } catch {
                setError('サンプルを読み込めませんでした。');
              }
            }}
          >
            サンプル
          </button>
        </div>
        <div aria-live="polite">
          {busy && (
            <div className="pwa-busy">
              <p>{busy.text}</p>
              {busy.cancel && (
                <button type="button" className="tv-btn tv-btn-secondary" onClick={busy.cancel}>
                  取消
                </button>
              )}
            </div>
          )}
          {error && (
            <p className="pwa-error" role="alert">
              {error}
            </p>
          )}
        </div>
        {pendingLarge && (
          <div className="pwa-warn" role="alert">
            <p>このデータは{(pendingLarge.bytes.length / MiB).toFixed(1)}MiBあり、iPhone向けの推奨（10MiB）を超えています。開くのに時間がかかったり、表示できない場合があります。</p>
            <div className="pwa-actions">
              <button
                type="button"
                className="tv-btn tv-btn-primary"
                onClick={() => {
                  const b = pendingLarge.bytes;
                  setPendingLarge(null);
                  void openBytes(b);
                }}
              >
                開く
              </button>
              <button type="button" className="tv-btn tv-btn-secondary" onClick={() => setPendingLarge(null)}>
                やめる
              </button>
            </div>
          </div>
        )}
        <section className="pwa-saved" aria-labelledby="saved-h">
          <h2 id="saved-h" className="pwa-h2">
            この端末に保存したデモ
          </h2>
          {!storageOk ? (
            <p className="pwa-muted">{MESSAGES.storageFull}</p>
          ) : saved.length === 0 ? (
            <p className="pwa-muted">まだありません。デモを開いて「この端末へ保存」を押すと、次回から通信なしで開けます。</p>
          ) : (
            <>
              <ul className="pwa-list">
                {saved.map((s) => (
                  <li key={s.id} className="pwa-item">
                    <button type="button" className="pwa-open" onClick={async () => openBytes(await loadSaved(s.id), s)}>
                      <span className="pwa-item-title">{s.title}</span>
                      <span className="pwa-small">保存した版：{new Date(s.savedAt).toLocaleString()}</span>
                    </button>
                    <button
                      type="button"
                      className="tv-btn tv-btn-secondary"
                      aria-label={`「${s.title}」を端末から削除`}
                      onClick={async () => {
                        if (!window.confirm(`「${s.title}」をこの端末から削除しますか？`)) return;
                        await deleteSaved(s.id);
                        refresh();
                      }}
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="tv-btn tv-btn-secondary pwa-danger"
                onClick={async () => {
                  if (!window.confirm('この端末に保存した全てのデモを削除しますか？')) return;
                  await deleteAllSaved();
                  refresh();
                }}
              >
                すべて削除
              </button>
            </>
          )}
          <p className="pwa-small">端末への保存はバックアップではありません。ブラウザーやOSの削除・容量不足で失われることがあります。作成者からの最新版の自動取得・期限設定・パスワード保護はありません。</p>
        </section>
        <section className="pwa-help">
          <h2 className="pwa-h2">ホーム画面に追加するには</h2>
          <p className="pwa-muted">iPhoneはSafariの共有メニュー、AndroidはChromeのメニューにある「ホーム画面に追加」を使います（ブラウザーの機能です）。</p>
          <p className="pwa-small">Tappivra Viewerは閲覧専用です。デモの編集はWindows版のTappivraで行います。</p>
        </section>
      </main>
    </div>
  );
}
