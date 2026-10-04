// Windows本体（Tauri）用。Rust側rusqliteのアプリ専用DBへ保存する。
// IPCはプロジェクト単位の限定コマンドのみ（任意SQL・任意パス・shellなし）。
import { invoke } from '@tauri-apps/api/core';
import type { AssetMeta, ExportRecord, ProjectGraph, UUID } from '../domain/types';
import { ConflictError, StorageError, type ExportKind, type ProjectSummary, type SaveFileResult, type Storage, type StorageUsage } from './storage';

async function call<T>(cmd: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]): Promise<T> {
  try {
    return await invoke<T>(cmd, args, options);
  } catch (e) {
    const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
    if (msg.startsWith('CONFLICT')) throw new ConflictError();
    throw new StorageError(msg.replace(/^[A-Z_]+: /, ''));
  }
}

const enc = (s: string) => encodeURIComponent(s);

export class TauriStorage implements Storage {
  readonly kind = 'tauri' as const;

  listProjects() {
    return call<ProjectSummary[]>('list_projects');
  }
  async loadProject(id: UUID) {
    const r = await call<{ revision: number; graphJson: string }>('load_project', { projectId: id });
    const g = JSON.parse(r.graphJson) as ProjectGraph;
    g.project.revision = r.revision;
    return g;
  }
  async createProject(graph: ProjectGraph, assets: { meta: AssetMeta; bytes: Uint8Array }[]) {
    // 1回のIPC・1トランザクションで登録する：[u32le JSON長][JSON][画像bytes...]
    const header = new TextEncoder().encode(
      JSON.stringify({ graphJson: JSON.stringify(graph), assets: assets.map((a) => ({ meta: a.meta, length: a.bytes.length })) }),
    );
    const total = 4 + header.length + assets.reduce((n, a) => n + a.bytes.length, 0);
    const body = new Uint8Array(total);
    new DataView(body.buffer).setUint32(0, header.length, true);
    body.set(header, 4);
    let o = 4 + header.length;
    for (const a of assets) {
      body.set(a.bytes, o);
      o += a.bytes.length;
    }
    return call<number>('create_project', body);
  }
  saveProject(graph: ProjectGraph, expectedRevision: number) {
    return call<number>('save_project', { projectId: graph.project.id, expectedRevision, graphJson: JSON.stringify(graph) });
  }
  async putAsset(meta: AssetMeta, bytes: Uint8Array) {
    await call('put_asset', bytes, { headers: { 'x-tappivra-meta': enc(JSON.stringify(meta)) } });
  }
  async getAsset(projectId: UUID, assetId: UUID) {
    const buf = await call<ArrayBuffer | number[]>('get_asset', { projectId, assetId });
    return buf instanceof ArrayBuffer ? new Uint8Array(buf) : Uint8Array.from(buf);
  }
  async gcAssets(projectId: UUID, keep: UUID[]) {
    await call('gc_assets', { projectId, keep });
  }
  async deleteProject(id: UUID) {
    await call('delete_project', { projectId: id });
  }
  async deleteAll(confirmText: string) {
    await call('delete_all', { confirmText });
  }
  usage() {
    return call<StorageUsage>('storage_usage');
  }
  async recordExport(rec: ExportRecord) {
    await call('record_export', { projectId: rec.projectId, recordJson: JSON.stringify(rec) });
  }
  saveFile(kind: ExportKind, suggestedName: string, bytes: Uint8Array) {
    return call<SaveFileResult>('save_export', bytes, { headers: { 'x-tappivra-kind': kind, 'x-tappivra-name': enc(suggestedName) } });
  }
}
