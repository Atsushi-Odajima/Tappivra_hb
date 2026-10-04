// Web開発シェル用の明示mock保存（メモリーのみ。再読み込みで消える）。
// Windows本体ではtauriStorageを使用する。E2E試験用に失敗注入を持つ。
import type { AssetMeta, ExportRecord, ProjectGraph, UUID } from '../domain/types';
import { sha256Hex } from '../media/hash';
import { ConflictError, DELETE_ALL_PHRASE, StorageError, type ExportKind, type SaveFileResult, type Storage } from './storage';

interface Row {
  revision: number;
  graphJson: string;
  updatedAt: string;
}

export interface MockControls {
  failNextSave: number;
  saveDelayMs: number;
  cancelNextFileSave: boolean;
  failNextFileSave: boolean;
}

export class MockStorage implements Storage {
  readonly kind = 'mock' as const;
  private projects = new Map<UUID, Row>();
  private assets = new Map<UUID, { projectId: UUID; meta: AssetMeta; bytes: Uint8Array }>();
  private exports: ExportRecord[] = [];
  controls: MockControls = { failNextSave: 0, saveDelayMs: 30, cancelNextFileSave: false, failNextFileSave: false };
  /** 保存（ダウンロード）したファイル。E2Eの検査用 */
  savedFiles: { kind: ExportKind; name: string; bytes: Uint8Array }[] = [];

  private delay() {
    return new Promise((r) => setTimeout(r, this.controls.saveDelayMs));
  }

  async listProjects() {
    return [...this.projects.entries()].map(([id, r]) => {
      const g = JSON.parse(r.graphJson) as ProjectGraph;
      const first = g.project.stepOrder[0];
      return {
        id,
        name: g.project.name,
        revision: r.revision,
        updatedAt: r.updatedAt,
        stepCount: g.project.stepOrder.length,
        lastBackupAt: g.project.lastBackupAt,
        thumbAssetId: first ? g.steps[first]?.imageAssetId : undefined,
      };
    });
  }

  async loadProject(id: UUID) {
    const r = this.projects.get(id);
    if (!r) throw new StorageError('プロジェクトが見つかりません');
    const g = JSON.parse(r.graphJson) as ProjectGraph;
    g.project.revision = r.revision;
    return g;
  }

  async createProject(graph: ProjectGraph, assets: { meta: AssetMeta; bytes: Uint8Array }[]) {
    await this.delay();
    if (this.projects.has(graph.project.id)) throw new StorageError('同じIDのプロジェクトが既にあります');
    for (const a of assets) if ((await sha256Hex(a.bytes)) !== a.meta.sha256) throw new StorageError('画像のハッシュが一致しません');
    for (const a of assets) this.assets.set(a.meta.id, { projectId: graph.project.id, meta: a.meta, bytes: a.bytes.slice() });
    this.projects.set(graph.project.id, { revision: 1, graphJson: JSON.stringify({ ...graph, project: { ...graph.project, revision: 1 } }), updatedAt: new Date().toISOString() });
    return 1;
  }

  async saveProject(graph: ProjectGraph, expectedRevision: number) {
    await this.delay();
    if (this.controls.failNextSave > 0) {
      this.controls.failNextSave--;
      throw new StorageError('ディスクに書き込めませんでした（模擬）');
    }
    const r = this.projects.get(graph.project.id);
    if (!r) throw new StorageError('プロジェクトが見つかりません');
    if (r.revision !== expectedRevision) throw new ConflictError();
    for (const aid of Object.keys(graph.assets)) {
      const a = this.assets.get(aid);
      if (!a || a.projectId !== graph.project.id) throw new StorageError('画像の所属が不正です');
    }
    const revision = r.revision + 1;
    this.projects.set(graph.project.id, { revision, graphJson: JSON.stringify({ ...graph, project: { ...graph.project, revision } }), updatedAt: new Date().toISOString() });
    return revision;
  }

  async putAsset(meta: AssetMeta, bytes: Uint8Array) {
    await this.delay();
    if (!this.projects.has(meta.projectId)) throw new StorageError('プロジェクトが見つかりません');
    if ((await sha256Hex(bytes)) !== meta.sha256) throw new StorageError('画像のハッシュが一致しません');
    this.assets.set(meta.id, { projectId: meta.projectId, meta, bytes: bytes.slice() });
  }

  async getAsset(projectId: UUID, assetId: UUID) {
    const a = this.assets.get(assetId);
    if (!a || a.projectId !== projectId) throw new StorageError('画像が見つかりません');
    return a.bytes;
  }

  async gcAssets(projectId: UUID, keep: UUID[]) {
    for (const [id, a] of this.assets) if (a.projectId === projectId && !keep.includes(id)) this.assets.delete(id);
  }

  async deleteProject(id: UUID) {
    this.projects.delete(id);
    for (const [aid, a] of this.assets) if (a.projectId === id) this.assets.delete(aid);
    this.exports = this.exports.filter((e) => e.projectId !== id);
  }

  async deleteAll(confirmText: string) {
    if (confirmText !== DELETE_ALL_PHRASE) throw new StorageError('確認の文字が一致しません');
    this.projects.clear();
    this.assets.clear();
    this.exports = [];
  }

  async usage() {
    let bytes = 0;
    for (const r of this.projects.values()) bytes += r.graphJson.length;
    for (const a of this.assets.values()) bytes += a.bytes.length;
    return { projects: this.projects.size, bytes, location: 'ブラウザーのメモリー（開発用mock。再読み込みで消えます）' };
  }

  async recordExport(rec: ExportRecord) {
    this.exports.push(rec);
  }

  async saveFile(kind: ExportKind, suggestedName: string, bytes: Uint8Array): Promise<SaveFileResult> {
    await this.delay();
    if (this.controls.cancelNextFileSave) {
      this.controls.cancelNextFileSave = false;
      return { saved: false };
    }
    if (this.controls.failNextFileSave) {
      this.controls.failNextFileSave = false;
      throw new StorageError('保存先に書き込めませんでした（模擬：書込権限なし）');
    }
    this.savedFiles.push({ kind, name: suggestedName, bytes: bytes.slice() });
    const type = kind === 'html' ? 'text/html' : 'application/zip';
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { saved: true, fileName: suggestedName };
  }
}
