import { useState } from 'react';
import type { ProjectGraph, UUID } from '../domain/types';
import { getStorage } from '../platform';
import { Editor } from './Editor';
import { Library } from './Library';

export function App() {
  const [storage] = useState(getStorage);
  const [open, setOpen] = useState<ProjectGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openProject = async (id: UUID) => {
    try {
      setError(null);
      const g = await storage.loadProject(id);
      // 前回の編集で参照されなくなった画像を整理（保存済みグラフが参照する画像は残る）
      await storage.gcAssets(id, Object.keys(g.assets)).catch(() => undefined);
      setOpen(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      {storage.kind === 'mock' && (
        <aside className="banner" aria-label="開発用シェルの注意">
          <strong>開発用シェル：</strong>保存は明示mock（このタブのメモリーのみ。再読み込みで消えます）。Windows本体ではローカルDBへ保存されます。
        </aside>
      )}
      {error && (
        <aside aria-label="エラー">
          <p className="notice notice-err" role="alert">
            {error}
          </p>
        </aside>
      )}
      {open ? <Editor key={open.project.id} storage={storage} initial={open} onBack={() => setOpen(null)} /> : <Library storage={storage} onOpen={openProject} />}
    </>
  );
}
