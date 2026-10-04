import type { AssetMime } from './limits';

export type UUID = string;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Project {
  id: UUID;
  schemaVersion: 1;
  name: string;
  description: string;
  locale: 'ja';
  revision: number;
  createdAt: string;
  updatedAt: string;
  entryStepId: UUID | null;
  stepOrder: UUID[];
  brand: { accentHex: string; productLabel: string };
  privateNotes: string;
  lastExportRevision?: number;
  lastBackupAt?: string;
}

export type StepKind = 'screen' | 'finish';

export interface Hotspot {
  id: UUID;
  stepId: UUID;
  label: string;
  helpText: string;
  rect: Rect;
  /** null = 未設定（書き出し前チェックでエラー） */
  targetStepId: UUID | null;
  order: number;
}

export interface Step {
  id: UUID;
  projectId: UUID;
  title: string;
  imageAssetId: UUID;
  description: string;
  altText: string;
  kind: StepKind;
  hotspots: Hotspot[];
  /** 「秘密情報を確認しました」を押した時点の画像hash。画像hashと一致する時のみ確認済み。 */
  redactionReviewedAssetHash?: string;
  /** 画像差し替え後に領域を確認した時点のrevision。未定義=要確認。 */
  layoutReviewedRevision?: number;
}

export interface AssetMeta {
  id: UUID;
  projectId: UUID;
  mime: AssetMime;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  createdAt: string;
}

export interface Asset extends AssetMeta {
  blob: Uint8Array;
}

export interface ExportRecord {
  id: UUID;
  projectId: UUID;
  projectRevision: number;
  kind: 'html' | 'demo-zip' | 'project-zip';
  createdAt: string;
  fileName: string;
  sha256: string;
  preflightSummary: string;
}

/** 編集モデル全体（SQLite projects.graph_json に保存される） */
export interface ProjectGraph {
  project: Project;
  steps: Record<UUID, Step>;
  assets: Record<UUID, AssetMeta>;
}

/** 公開用DemoDocument（privateNotes・パス・履歴・ExportRecordは含めない） */
export interface DemoHotspot {
  id: UUID;
  label: string;
  helpText: string;
  rect: Rect;
  targetStepId: UUID;
  order: number;
}

export interface DemoStep {
  id: UUID;
  title: string;
  description: string;
  altText: string;
  kind: StepKind;
  assetId: UUID;
  hotspots: DemoHotspot[];
}

export interface DemoAssetRef {
  id: UUID;
  path: string;
  mime: AssetMime;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

export interface DemoDocument {
  format: 'tappivra-demo';
  schemaVersion: 1;
  id: UUID;
  productLabel: string;
  title: string;
  locale: 'ja';
  startStepId: UUID;
  steps: DemoStep[];
  assets: DemoAssetRef[];
  theme: { accentHex: string };
  generatedAt: string;
}
