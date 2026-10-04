import type { AssetMeta, ExportRecord, ProjectGraph, UUID } from '../domain/types';

export interface ProjectSummary {
  id: UUID;
  name: string;
  revision: number;
  updatedAt: string;
  stepCount: number;
  lastBackupAt?: string;
  thumbAssetId?: UUID;
}

export interface StorageUsage {
  projects: number;
  bytes: number;
  location: string;
}

export type ExportKind = 'html' | 'demo-zip' | 'project-zip';

export interface SaveFileResult {
  saved: boolean;
  fileName?: string;
}

export class ConflictError extends Error {
  constructor() {
    super('他の画面・古い編集内容と競合しました。最新の内容を読み込み直してください');
  }
}
export class StorageError extends Error {}

export interface Storage {
  readonly kind: 'tauri' | 'mock';
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: UUID): Promise<ProjectGraph>;
  /** 新規プロジェクトと画像を1トランザクションで登録 */
  createProject(graph: ProjectGraph, assets: { meta: AssetMeta; bytes: Uint8Array }[]): Promise<number>;
  /** expectedRevisionが現在のDBと一致するときだけ保存し、新しいrevisionを返す */
  saveProject(graph: ProjectGraph, expectedRevision: number): Promise<number>;
  putAsset(meta: AssetMeta, bytes: Uint8Array): Promise<void>;
  getAsset(projectId: UUID, assetId: UUID): Promise<Uint8Array>;
  gcAssets(projectId: UUID, keep: UUID[]): Promise<void>;
  deleteProject(id: UUID): Promise<void>;
  deleteAll(confirmText: string): Promise<void>;
  usage(): Promise<StorageUsage>;
  recordExport(rec: ExportRecord): Promise<void>;
  /** ユーザーがダイアログで選んだ場所へ保存（tmp→rename）。キャンセル時saved=false */
  saveFile(kind: ExportKind, suggestedName: string, bytes: Uint8Array): Promise<SaveFileResult>;
}

export const DELETE_ALL_PHRASE = 'すべて削除';
