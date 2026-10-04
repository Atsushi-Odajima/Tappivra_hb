import { z } from 'zod';
import { LIMITS, TEXT_LIMITS } from './limits';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const zUuid = z.string().regex(UUID_RE, 'UUIDではありません');
const zIso = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), '日時が不正です');
const zSha = z.string().regex(/^[0-9a-f]{64}$/);
const zHex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const text = (range: readonly [number, number]) => z.string().min(range[0]).max(range[1]);
const unit = z.number().finite().min(0).max(1);

export const zRect = z.strictObject({ x: unit, y: unit, w: unit, h: unit });
export const zAssetMime = z.enum(['image/png', 'image/jpeg']);

export const zHotspot = z.strictObject({
  id: zUuid,
  stepId: zUuid,
  label: text(TEXT_LIMITS.hotspotLabel),
  helpText: text(TEXT_LIMITS.hotspotHelp),
  rect: zRect,
  targetStepId: zUuid.nullable(),
  order: z.number().int().min(0),
});

export const zStep = z.strictObject({
  id: zUuid,
  projectId: zUuid,
  title: text(TEXT_LIMITS.stepTitle),
  imageAssetId: zUuid,
  description: text(TEXT_LIMITS.stepDescription),
  // 編集中は空も許す（書き出し前チェックでエラー化）
  altText: z.string().max(TEXT_LIMITS.altText[1]),
  kind: z.enum(['screen', 'finish']),
  hotspots: z.array(zHotspot).max(LIMITS.maxHotspotsPerStep),
  redactionReviewedAssetHash: zSha.optional(),
  layoutReviewedRevision: z.number().int().min(0).optional(),
});

export const zProject = z.strictObject({
  id: zUuid,
  schemaVersion: z.literal(1),
  name: text(TEXT_LIMITS.projectName),
  description: text(TEXT_LIMITS.projectDescription),
  locale: z.literal('ja'),
  revision: z.number().int().min(1),
  createdAt: zIso,
  updatedAt: zIso,
  entryStepId: zUuid.nullable(),
  stepOrder: z.array(zUuid).max(LIMITS.maxSteps),
  brand: z.strictObject({ accentHex: zHex, productLabel: text(TEXT_LIMITS.productLabel) }),
  privateNotes: text(TEXT_LIMITS.privateNotes),
  lastExportRevision: z.number().int().min(0).optional(),
  lastBackupAt: zIso.optional(),
});

export const zAssetMeta = z.strictObject({
  id: zUuid,
  projectId: zUuid,
  mime: zAssetMime,
  width: z.number().int().min(1).max(LIMITS.maxEncodedLongEdge),
  height: z.number().int().min(1).max(LIMITS.maxEncodedLongEdge),
  byteLength: z.number().int().min(1).max(LIMITS.maxInputImageBytes),
  sha256: zSha,
  createdAt: zIso,
});

export const zProjectGraph = z.strictObject({
  project: zProject,
  steps: z.record(zUuid, zStep),
  assets: z.record(zUuid, zAssetMeta),
});

// ---- 公開用 ----
export const zDemoHotspot = z.strictObject({
  id: zUuid,
  label: text(TEXT_LIMITS.hotspotLabel),
  helpText: text(TEXT_LIMITS.hotspotHelp),
  rect: zRect,
  targetStepId: zUuid,
  order: z.number().int().min(0),
});

export const zDemoStep = z.strictObject({
  id: zUuid,
  title: text(TEXT_LIMITS.stepTitle),
  description: text(TEXT_LIMITS.stepDescription),
  altText: text(TEXT_LIMITS.altText),
  kind: z.enum(['screen', 'finish']),
  assetId: zUuid,
  hotspots: z.array(zDemoHotspot).max(LIMITS.maxHotspotsPerStep),
});

export const zDemoAssetRef = z.strictObject({
  id: zUuid,
  path: z.string().regex(/^media\/[0-9a-f-]{36}\.(png|jpg)$/),
  mime: zAssetMime,
  width: z.number().int().min(1).max(LIMITS.maxEncodedLongEdge),
  height: z.number().int().min(1).max(LIMITS.maxEncodedLongEdge),
  byteLength: z.number().int().min(1).max(LIMITS.maxInputImageBytes),
  sha256: zSha,
});

export const zDemoDocument = z.strictObject({
  format: z.literal('tappivra-demo'),
  schemaVersion: z.literal(1),
  id: zUuid,
  productLabel: text(TEXT_LIMITS.productLabel),
  title: text(TEXT_LIMITS.projectName),
  locale: z.literal('ja'),
  startStepId: zUuid,
  steps: z.array(zDemoStep).min(1).max(LIMITS.maxSteps),
  assets: z.array(zDemoAssetRef).min(1).max(LIMITS.maxSteps),
  theme: z.strictObject({ accentHex: zHex }),
  generatedAt: zIso,
});

export const zProjectZipManifest = z.strictObject({
  format: z.literal('tappivra-project'),
  schemaVersion: z.literal(1),
  exportedAt: zIso,
  containsPrivateNotes: z.literal(true),
  graph: zProjectGraph,
  media: z.array(z.strictObject({ assetId: zUuid, path: z.string().regex(/^media\/[0-9a-f-]{36}\.(png|jpg)$/) })),
});

/** JSONの深さ・文字列長を検証（スキーマ検証の前段） */
export function checkJsonShape(value: unknown, maxDepth = LIMITS.jsonMaxDepth, maxStr = LIMITS.jsonMaxStringLength): string | null {
  const walk = (v: unknown, depth: number): string | null => {
    if (depth > maxDepth) return 'JSONの階層が深すぎます';
    if (typeof v === 'string') return v.length > maxStr ? '文字列が長すぎます' : null;
    if (Array.isArray(v)) {
      for (const x of v) {
        const e = walk(x, depth + 1);
        if (e) return e;
      }
      return null;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k.length > 200) return 'キーが長すぎます';
        const e = walk(x, depth + 1);
        if (e) return e;
      }
    }
    return null;
  };
  return walk(value, 0);
}

/** format/schemaVersionの事前判定（未来版を区別するため） */
export function peekFormat(v: unknown): { format?: unknown; schemaVersion?: unknown } {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return { format: o.format, schemaVersion: o.schemaVersion };
  }
  return {};
}
