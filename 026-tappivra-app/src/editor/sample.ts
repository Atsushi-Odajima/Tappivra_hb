// samples/sample_project_spec.json（架空の仕様テスト資料）を、実際の取り込み処理
// （形式検査→デコード→再エンコード→sha256）に通してTappivraの編集プロジェクトへ変換する。
import { createProjectGraph } from '../domain/model';
import { newId } from '../domain/ids';
import type { AssetMeta, ProjectGraph, Step } from '../domain/types';
import { sha256Hex } from '../media/hash';
import { finalizeImage, openPendingImage, releasePending } from '../media/pipeline';

interface FixtureSpec {
  fixtureFormat: 'tappivra-spec-sample';
  projectTitle: string;
  entryFixtureId: string;
  privateNotesTestSentinel: string;
  steps: {
    fixtureId: string;
    title: string;
    image: string;
    kind: 'screen' | 'finish';
    altText: string;
    sha256: string;
    hotspots: { label: string; target: string; rect: { x: number; y: number; w: number; h: number } }[];
  }[];
}

const DESCRIPTIONS: Record<string, string> = {
  'step-01': '「新規作成」から始めます。画面の青枠、または下のボタンを押すと、次の画面へ進みます。',
  'step-02': '入力例を見るか、保存後の画面へ進むかを選べます。',
  'step-03': '項目を入力した状態の例です。',
  'step-04': '保存が完了した状態の例です。',
  'step-05': '操作説明はここまでです。',
};
const HELP: Record<string, string> = { 新規作成を開く: '新しい案件を登録します。' };

export async function buildSampleProject(base = '/samples/'): Promise<{ graph: ProjectGraph; assets: { meta: AssetMeta; bytes: Uint8Array }[] }> {
  const spec = (await (await fetch(`${base}sample_project_spec.json`)).json()) as FixtureSpec;
  if (spec.fixtureFormat !== 'tappivra-spec-sample') throw new Error('サンプル資料の形式が違います');
  const g = createProjectGraph(spec.projectTitle);
  g.project.privateNotes = `内部メモ（サンプル）：${spec.privateNotesTestSentinel}`;
  g.project.description = '架空のサンプル業務画面で作った操作デモです。';
  const idOf = new Map(spec.steps.map((s) => [s.fixtureId, newId()]));
  const assets: { meta: AssetMeta; bytes: Uint8Array }[] = [];
  for (const s of spec.steps) {
    const raw = new Uint8Array(await (await fetch(`${base}${s.image}`)).arrayBuffer());
    if ((await sha256Hex(raw)) !== s.sha256) throw new Error(`サンプル画像のハッシュが資料と一致しません：${s.image}`);
    const pending = await openPendingImage(new Blob([raw], { type: 'image/png' }), s.image);
    try {
      const done = await finalizeImage(pending, [], g.project.id);
      assets.push(done);
      const id = idOf.get(s.fixtureId)!;
      const step: Step = {
        id,
        projectId: g.project.id,
        title: s.title,
        imageAssetId: done.meta.id,
        description: DESCRIPTIONS[s.fixtureId] ?? '',
        altText: s.altText,
        kind: s.kind,
        hotspots: s.hotspots.map((h, i) => ({
          id: newId(),
          stepId: id,
          label: h.label,
          helpText: HELP[h.label] ?? '',
          rect: { ...h.rect },
          targetStepId: idOf.get(h.target) ?? null,
          order: i,
        })),
        // 架空サンプル（秘密情報なし）として公開前確認済みで登録する
        redactionReviewedAssetHash: done.meta.sha256,
        layoutReviewedRevision: 0,
      };
      g.steps[id] = step;
      g.assets[done.meta.id] = done.meta;
      g.project.stepOrder.push(id);
    } finally {
      releasePending(pending);
    }
  }
  g.project.entryStepId = idOf.get(spec.entryFixtureId) ?? null;
  return { graph: g, assets };
}
