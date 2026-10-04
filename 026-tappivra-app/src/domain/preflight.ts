import { analyzeGraph } from './graph';
import { LIMITS, MiB } from './limits';
import { adjacency } from './model';
import { rectsOverlap, validateRect, RECT_ERROR_TEXT } from './rect';
import type { ProjectGraph, UUID } from './types';

export type IssueLevel = 'error' | 'warning';
export type IssueField = 'title' | 'altText' | 'target' | 'label' | 'rect' | 'image' | 'layout' | 'project' | 'kind' | 'entry';

export interface PreflightIssue {
  level: IssueLevel;
  code: string;
  message: string;
  stepId?: UUID;
  hotspotId?: UUID;
  field: IssueField;
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
  imageBytes: number;
  estimatedHtmlBytes: number;
  estimatedZipBytes: number;
}

/** 単独HTMLの固定部分（ランタイム・CSS・JSON）の概算上限 */
export const HTML_OVERHEAD_BYTES = 256 * 1024;

export function runPreflight(g: ProjectGraph, overheadBytes = HTML_OVERHEAD_BYTES): PreflightResult {
  const issues: PreflightIssue[] = [];
  const err = (i: Omit<PreflightIssue, 'level'>) => issues.push({ level: 'error', ...i });
  const warn = (i: Omit<PreflightIssue, 'level'>) => issues.push({ level: 'warning', ...i });
  const order = g.project.stepOrder;
  const name = (id: UUID) => {
    const idx = order.indexOf(id);
    return `${String(idx + 1).padStart(2, '0')}「${g.steps[id]?.title ?? '不明'}」`;
  };

  if (order.length === 0) err({ code: 'no-steps', message: 'ステップがありません。画像を追加してください', field: 'project' });
  if (order.length > LIMITS.maxSteps) err({ code: 'too-many-steps', message: `ステップは最大${LIMITS.maxSteps}です`, field: 'project' });
  if (!g.project.entryStepId || !g.steps[g.project.entryStepId]) err({ code: 'no-entry', message: '開始画面が設定されていません', field: 'entry' });
  if (!order.some((id) => g.steps[id]?.kind === 'finish')) err({ code: 'no-finish', message: '完了画面（最後の画面）がありません。いずれかの画面を「完了画面」にしてください', field: 'kind' });
  if (order.length > LIMITS.iphoneRecommendedSteps) warn({ code: 'iphone-steps', message: `iPhone向けの推奨は${LIMITS.iphoneRecommendedSteps}ステップ以下です`, field: 'project' });

  for (const id of order) {
    const s = g.steps[id];
    if (!s) {
      err({ code: 'missing-step', message: `ステップ順に存在しないIDがあります（${id}）`, field: 'project' });
      continue;
    }
    const asset = g.assets[s.imageAssetId];
    if (!asset) err({ code: 'missing-asset', message: `${name(id)}の画像が見つかりません`, stepId: id, field: 'image' });
    else if (s.redactionReviewedAssetHash !== asset.sha256)
      err({ code: 'redaction-unreviewed', message: `${name(id)}の画像は公開前確認が済んでいません（要確認）`, stepId: id, field: 'image' });
    if (s.layoutReviewedRevision === undefined)
      err({ code: 'layout-unreviewed', message: `${name(id)}は画像差し替え後のクリック箇所が未確認です（要確認）`, stepId: id, field: 'layout' });
    if (!s.title.trim()) err({ code: 'title-missing', message: `${order.indexOf(id) + 1}番目の画面名がありません`, stepId: id, field: 'title' });
    if (!s.altText.trim()) err({ code: 'alt-missing', message: `${name(id)}の代替テキスト（画像の説明）がありません`, stepId: id, field: 'altText' });
    if (s.kind === 'screen' && s.hotspots.length === 0)
      err({ code: 'no-hotspot', message: `${name(id)}にクリック箇所がありません。追加するか完了画面にしてください`, stepId: id, field: 'kind' });
    if (s.hotspots.length > LIMITS.maxHotspotsPerStep) err({ code: 'too-many-hotspots', message: `${name(id)}のクリック箇所は最大${LIMITS.maxHotspotsPerStep}個です`, stepId: id, field: 'rect' });

    s.hotspots.forEach((h, i) => {
      const hs = { stepId: id, hotspotId: h.id };
      if (!h.label.trim()) err({ ...hs, code: 'label-missing', message: `${name(id)}のクリック箇所${i + 1}にボタン名がありません`, field: 'label' });
      const r = validateRect(h.rect);
      if (!r.ok) err({ ...hs, code: 'rect-invalid', message: `${name(id)}「${h.label}」：${RECT_ERROR_TEXT[r.error]}`, field: 'rect' });
      if (h.targetStepId === null) err({ ...hs, code: 'target-unset', message: `${name(id)}「${h.label}」の移動先が未設定です`, field: 'target' });
      else if (!g.steps[h.targetStepId] || !order.includes(h.targetStepId))
        err({ ...hs, code: 'target-missing', message: `${name(id)}「${h.label}」の移動先が存在しません（削除されたステップ）`, field: 'target' });
      for (const o of s.hotspots.slice(i + 1))
        if (rectsOverlap(h.rect, o.rect)) warn({ ...hs, code: 'overlap', message: `${name(id)}「${h.label}」と「${o.label}」が重なっています。順序を確認してください`, field: 'rect' });
    });
  }

  const report = analyzeGraph(
    order.filter((id) => g.steps[id]),
    adjacency(g),
    g.project.entryStepId,
    new Set(order.filter((id) => g.steps[id]?.kind === 'finish')),
  );
  for (const id of report.selfLoops) err({ code: 'self-loop', message: `${name(id)}が自分自身へ移動します（自己循環）`, stepId: id, field: 'target' });
  for (const cyc of report.cycles) err({ code: 'cycle', message: `循環があります：${cyc.map(name).join(' → ')} → ${name(cyc[0]!)}`, stepId: cyc[0], field: 'target' });
  if (g.project.entryStepId && g.steps[g.project.entryStepId]) {
    for (const id of report.unreachable) err({ code: 'unreachable', message: `${name(id)}へは開始画面からたどり着けません`, stepId: id, field: 'target' });
  }
  for (const id of report.deadEnds)
    if (!report.unreachable.includes(id) && g.steps[id]?.kind !== 'finish')
      err({ code: 'no-path-to-finish', message: `${name(id)}から完了画面へ到達する経路がありません`, stepId: id, field: 'target' });

  const used = new Set(order.map((id) => g.steps[id]?.imageAssetId).filter(Boolean) as UUID[]);
  const imageBytes = [...used].reduce((sum, a) => sum + (g.assets[a]?.byteLength ?? 0), 0);
  const estimatedHtmlBytes = Math.ceil(imageBytes / 3) * 4 + overheadBytes;
  const estimatedZipBytes = imageBytes + 64 * 1024;
  if (imageBytes > LIMITS.maxEncodedTotalBytes) err({ code: 'images-too-large', message: `画像の合計が${LIMITS.maxEncodedTotalBytes / MiB}MiBを超えています`, field: 'image' });
  const biggest = Math.max(estimatedHtmlBytes, estimatedZipBytes);
  if (biggest > LIMITS.maxDemoBytes) err({ code: 'demo-too-large', message: `閲覧データが${LIMITS.maxDemoBytes / MiB}MiBを超えます（約${(biggest / MiB).toFixed(1)}MiB）。画像を減らしてください`, field: 'image' });
  else if (biggest > LIMITS.warnDemoBytes) warn({ code: 'demo-large', message: `閲覧データが${LIMITS.warnDemoBytes / MiB}MiBを超えています（約${(biggest / MiB).toFixed(1)}MiB）。スマホでは開くのに時間がかかります`, field: 'image' });
  if (estimatedZipBytes > LIMITS.iphoneRecommendedBytes && biggest <= LIMITS.warnDemoBytes)
    warn({ code: 'iphone-bytes', message: 'iPhone向けの推奨容量（10MiB）を超えています', field: 'image' });

  return { ok: !issues.some((i) => i.level === 'error'), issues, imageBytes, estimatedHtmlBytes, estimatedZipBytes };
}
