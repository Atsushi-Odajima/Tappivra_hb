import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetMeta, UUID } from '../domain/types';
import type { Storage } from '../platform/storage';

/** 加工済み画像のbytesとobject URLをキャッシュする（元画像は扱わない） */
export function useAssets(storage: Storage, projectId: UUID | null, metas: Record<UUID, AssetMeta>) {
  const cache = useRef(new Map<UUID, { bytes: Uint8Array; url: string }>());
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback((meta: AssetMeta, bytes: Uint8Array) => {
    if (cache.current.has(meta.id)) return;
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: meta.mime }));
    cache.current.set(meta.id, { bytes, url });
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      for (const meta of Object.values(metas)) {
        if (cache.current.has(meta.id)) continue;
        try {
          const bytes = await storage.getAsset(projectId, meta.id);
          if (!cancelled) add(meta, bytes);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storage, projectId, metas, add]);

  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const v of c.values()) URL.revokeObjectURL(v.url);
      c.clear();
    };
  }, []);

  const url = useCallback((id: UUID | undefined) => (id ? cache.current.get(id)?.url : undefined), []);
  const bytes = useCallback((id: UUID) => cache.current.get(id)?.bytes, []);
  return { url, bytes, add, error };
}
