import { analyzeGraph } from '../domain/graph';
import { newId } from '../domain/ids';
import { MESSAGES } from '../domain/limits';
import { checkJsonShape, peekFormat, zDemoDocument, zProjectZipManifest } from '../domain/schema';
import type { AssetMeta, DemoDocument, ProjectGraph, Step, UUID } from '../domain/types';
import { sha256Hex } from '../media/hash';
import { sniffImage } from '../media/sniff';
import { buildZip, readZipSafely, ZipSafetyError } from './zip';

export class PackageError extends Error {}

export const HOW_TO_OPEN = `Tappivra 閲覧用データ（tappivra-demo）

■ パソコンで見る
  作成者から「.html」ファイルも受け取っている場合は、そのHTMLをEdge/Chrome/Firefoxで開いてください。
  このZIPはパソコンでは直接再生できません。

■ iPhone・Androidで見る
  作成者が案内するTappivra ViewerのURL（HTTPS）をSafari/Chromeで開き、
  「閲覧データを開く」からこのZIPファイルを選んでください。
  データは端末内で読み込まれ、どこにも送信されません。

■ ご注意
  これは画面画像を切り替える説明用デモです。実際のアプリの操作・登録・決済は行われません。
  このZIPに含まれるのは manifest.json と加工済み画像（media/）だけです。
`;

const extOf = (mime: string) => (mime === 'image/png' ? 'png' : 'jpg');
const enc = (v: unknown) => JSON.stringify(v, null, 2);

function parseJsonEntry(files: Map<string, Uint8Array>, name: string): unknown {
  const raw = files.get(name);
  if (!raw) throw new PackageError(`${name}がありません`);
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new PackageError(`${name}を読み込めません`);
  }
  const shape = checkJsonShape(v);
  if (shape) throw new PackageError(shape);
  return v;
}

async function verifyImage(bytes: Uint8Array | undefined, meta: { mime: string; width: number; height: number; byteLength: number; sha256: string }) {
  if (!bytes) throw new PackageError('画像ファイルが見つかりません');
  if (bytes.length !== meta.byteLength) throw new PackageError('画像の容量が一致しません');
  if ((await sha256Hex(bytes)) !== meta.sha256) throw new PackageError('画像のチェックサム（sha256）が一致しません');
  let s;
  try {
    s = sniffImage(bytes.subarray(0, 64 * 1024));
  } catch {
    throw new PackageError('画像の形式が不正です');
  }
  if (s.mime !== meta.mime || s.width !== meta.width || s.height !== meta.height) throw new PackageError('画像の形式・寸法が記録と一致しません');
}

// ---------------- 閲覧ZIP ----------------
export function buildDemoZip(doc: DemoDocument, images: Map<UUID, Uint8Array>): Uint8Array {
  const files: Record<string, Uint8Array | string> = { 'manifest.json': enc(doc), 'HOW_TO_OPEN.txt': HOW_TO_OPEN };
  for (const a of doc.assets) {
    const b = images.get(a.id);
    if (!b) throw new PackageError('画像が見つかりません');
    files[a.path] = b;
  }
  return buildZip(files, new Date(doc.generatedAt));
}

export interface ParsedDemo {
  doc: DemoDocument;
  images: Map<UUID, { bytes: Uint8Array; mime: string }>;
}

/** 閲覧ZIPの検証。PWAはこの形式だけを受け付け、ZIP内のHTML/JSは読まない。 */
export async function parseDemoZip(bytes: Uint8Array): Promise<ParsedDemo> {
  let files: Map<string, Uint8Array>;
  try {
    files = readZipSafely(bytes);
  } catch (e) {
    if (e instanceof ZipSafetyError) throw new PackageError(e.message);
    throw e;
  }
  if (!files.has('manifest.json')) throw new PackageError(MESSAGES.notDemo);
  const raw = parseJsonEntry(files, 'manifest.json');
  const { format, schemaVersion } = peekFormat(raw);
  if (format === 'tappivra-project') throw new PackageError('これは編集用バックアップZIPです。閲覧用ZIP（.tappivra-demo.zip）を選んでください');
  if (format !== 'tappivra-demo') throw new PackageError(MESSAGES.notDemo);
  if (typeof schemaVersion === 'number' && schemaVersion > 1) throw new PackageError(MESSAGES.futureSchema);
  const parsed = zDemoDocument.safeParse(raw);
  if (!parsed.success) throw new PackageError(`閲覧データの内容が不正です（${parsed.error.issues[0]?.path.join('.') ?? ''}）`);
  const doc = parsed.data as DemoDocument;
  const stepIds = new Set(doc.steps.map((s) => s.id));
  const assetIds = new Set(doc.assets.map((a) => a.id));
  if (stepIds.size !== doc.steps.length || assetIds.size !== doc.assets.length) throw new PackageError('IDが重複しています');
  if (!stepIds.has(doc.startStepId)) throw new PackageError('開始画面が見つかりません');
  for (const a of doc.assets) if (a.path !== `media/${a.id}.${extOf(a.mime)}`) throw new PackageError('画像パスが不正です');
  for (const s of doc.steps) {
    if (!assetIds.has(s.assetId)) throw new PackageError('画像の参照が不正です');
    for (const h of s.hotspots) {
      if (!stepIds.has(h.targetStepId)) throw new PackageError('移動先が存在しません');
      if (h.rect.x + h.rect.w > 1.000001 || h.rect.y + h.rect.h > 1.000001 || h.rect.w <= 0 || h.rect.h <= 0) throw new PackageError('クリック箇所の座標が不正です');
    }
  }
  const adj = new Map(doc.steps.map((s) => [s.id, s.hotspots.map((h) => h.targetStepId)]));
  const rep = analyzeGraph([...stepIds], adj, doc.startStepId, new Set(doc.steps.filter((s) => s.kind === 'finish').map((s) => s.id)));
  if (rep.selfLoops.length || rep.cycles.length) throw new PackageError('閲覧データに循環があります');
  const images = new Map<UUID, { bytes: Uint8Array; mime: string }>();
  for (const a of doc.assets) {
    const b = files.get(a.path);
    await verifyImage(b, a);
    images.set(a.id, { bytes: b!, mime: a.mime });
  }
  return { doc, images };
}

// ---------------- 編集ZIP ----------------
export function buildProjectZip(g: ProjectGraph, images: Map<UUID, Uint8Array>, exportedAt: string): Uint8Array {
  const media = Object.values(g.assets).map((a) => ({ assetId: a.id, path: `media/${a.id}.${extOf(a.mime)}` }));
  const manifest = { format: 'tappivra-project', schemaVersion: 1, exportedAt, containsPrivateNotes: true, graph: g, media };
  const files: Record<string, Uint8Array | string> = { 'manifest.json': enc(manifest) };
  for (const m of media) {
    const b = images.get(m.assetId);
    if (!b) throw new PackageError('画像が見つかりません');
    files[m.path] = b;
  }
  return buildZip(files, new Date(exportedAt));
}

export interface RestoredProject {
  graph: ProjectGraph;
  images: Map<UUID, Uint8Array>;
  /** 旧ID→新ID（検証用） */
  idMap: Map<UUID, UUID>;
}

/** 編集ZIPを検証し、新しいproject UUID（および全ID）として復元する。既存IDは上書きしない。 */
export async function parseProjectZip(bytes: Uint8Array): Promise<RestoredProject> {
  let files: Map<string, Uint8Array>;
  try {
    files = readZipSafely(bytes);
  } catch (e) {
    if (e instanceof ZipSafetyError) throw new PackageError(e.message);
    throw e;
  }
  const raw = parseJsonEntry(files, 'manifest.json');
  const { format, schemaVersion } = peekFormat(raw);
  if (format === 'tappivra-demo') throw new PackageError('これは閲覧用ZIPです。編集用バックアップZIP（.tappivra-project.zip）を選んでください');
  if (format !== 'tappivra-project') throw new PackageError('Tappivraの編集用ZIPではありません');
  if (typeof schemaVersion === 'number' && schemaVersion > 1) throw new PackageError(MESSAGES.futureSchema);
  const parsed = zProjectZipManifest.safeParse(raw);
  if (!parsed.success) throw new PackageError(`編集データの内容が不正です（${parsed.error.issues[0]?.path.join('.') ?? ''}）`);
  const m = parsed.data;
  const g = m.graph as ProjectGraph;
  // 整合性
  for (const [k, s] of Object.entries(g.steps)) {
    if (k !== s.id || s.projectId !== g.project.id) throw new PackageError('ステップIDが不正です');
    if (!g.assets[s.imageAssetId]) throw new PackageError('画像の参照が不正です');
    for (const h of s.hotspots) if (h.stepId !== s.id) throw new PackageError('クリック箇所の所属が不正です');
  }
  if (g.project.stepOrder.some((id) => !g.steps[id]) || new Set(g.project.stepOrder).size !== g.project.stepOrder.length) throw new PackageError('ステップ順が不正です');
  for (const [k, a] of Object.entries(g.assets)) if (k !== a.id || a.projectId !== g.project.id) throw new PackageError('画像IDが不正です');

  const idMap = new Map<UUID, UUID>();
  const map = (id: UUID) => {
    let n = idMap.get(id);
    if (!n) idMap.set(id, (n = newId()));
    return n;
  };
  const pid = map(g.project.id);
  const images = new Map<UUID, Uint8Array>();
  const assets: Record<UUID, AssetMeta> = {};
  for (const a of Object.values(g.assets)) {
    const entry = m.media.find((x) => x.assetId === a.id);
    if (!entry || entry.path !== `media/${a.id}.${extOf(a.mime)}`) throw new PackageError('画像パスが不正です');
    const b = files.get(entry.path);
    await verifyImage(b, a);
    const nid = map(a.id);
    assets[nid] = { ...a, id: nid, projectId: pid };
    images.set(nid, b!);
  }
  const steps: Record<UUID, Step> = {};
  for (const s of Object.values(g.steps)) {
    const nid = map(s.id);
    steps[nid] = {
      ...s,
      id: nid,
      projectId: pid,
      imageAssetId: map(s.imageAssetId),
      hotspots: s.hotspots.map((h) => ({
        ...h,
        id: map(h.id),
        stepId: nid,
        // 存在しない遷移先はそのまま新IDへ（復元後の書き出し前チェックで検出される）
        targetStepId: h.targetStepId === null ? null : map(h.targetStepId),
      })),
    };
  }
  const t = new Date().toISOString();
  const graph: ProjectGraph = {
    project: {
      ...g.project,
      id: pid,
      revision: 1,
      createdAt: t,
      updatedAt: t,
      entryStepId: g.project.entryStepId ? map(g.project.entryStepId) : null,
      stepOrder: g.project.stepOrder.map(map),
      lastExportRevision: undefined,
    },
    steps,
    assets,
  };
  if (graph.project.lastExportRevision === undefined) delete graph.project.lastExportRevision;
  return { graph, images, idMap };
}
