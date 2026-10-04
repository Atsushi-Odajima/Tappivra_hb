import { LIMITS } from './limits';
import { newId, nowIso, round6 } from './ids';
import { clampMove, validateRect } from './rect';
import { wouldCreateCycle, type Adjacency } from './graph';
import type { AssetMeta, Hotspot, ProjectGraph, Rect, Step, StepKind, UUID } from './types';

export class CommandError extends Error {}

export function createProjectGraph(name: string): ProjectGraph {
  const t = nowIso();
  return {
    project: {
      id: newId(),
      schemaVersion: 1,
      name: name.trim().slice(0, 80) || '新しいデモ',
      description: '',
      locale: 'ja',
      revision: 1,
      createdAt: t,
      updatedAt: t,
      entryStepId: null,
      stepOrder: [],
      brand: { accentHex: '#2563EB', productLabel: '' },
      privateNotes: '',
    },
    steps: {},
    assets: {},
  };
}

export function adjacency(g: ProjectGraph): Adjacency {
  const adj: Adjacency = new Map();
  for (const id of g.project.stepOrder) {
    const s = g.steps[id];
    adj.set(id, s ? s.hotspots.map((h) => h.targetStepId).filter((t): t is UUID => !!t) : []);
  }
  return adj;
}

export function incomingLinks(g: ProjectGraph, stepId: UUID): { step: Step; hotspot: Hotspot }[] {
  const out: { step: Step; hotspot: Hotspot }[] = [];
  for (const id of g.project.stepOrder) {
    const s = g.steps[id];
    if (!s) continue;
    for (const h of s.hotspots) if (h.targetStepId === stepId) out.push({ step: s, hotspot: h });
  }
  return out;
}

export function assetRefCount(g: ProjectGraph, assetId: UUID): number {
  return Object.values(g.steps).filter((s) => s.imageAssetId === assetId).length;
}

export type Command =
  | { type: 'project/update'; patch: Partial<Pick<ProjectGraph['project'], 'name' | 'description' | 'privateNotes'>> & { productLabel?: string } }
  | { type: 'step/add'; asset: AssetMeta; title: string; altText: string; reviewedHash: string }
  | { type: 'step/update'; stepId: UUID; patch: Partial<Pick<Step, 'title' | 'description' | 'altText'>> }
  | { type: 'step/kind'; stepId: UUID; kind: StepKind }
  | { type: 'step/move'; stepId: UUID; delta: number }
  | { type: 'step/reorder'; stepId: UUID; toIndex: number }
  | { type: 'step/duplicate'; stepId: UUID }
  | { type: 'step/delete'; stepId: UUID; newEntryId?: UUID }
  | { type: 'step/setEntry'; stepId: UUID }
  | { type: 'step/replaceImage'; stepId: UUID; asset: AssetMeta; reviewedHash: string; keepLayout?: boolean }
  | { type: 'step/confirmLayout'; stepId: UUID; revision: number }
  | { type: 'hotspot/add'; stepId: UUID; rect?: Rect; hotspotId?: UUID }
  | { type: 'hotspot/update'; stepId: UUID; hotspotId: UUID; patch: Partial<Pick<Hotspot, 'label' | 'helpText' | 'order'>> }
  | { type: 'hotspot/rect'; stepId: UUID; hotspotId: UUID; rect: Rect }
  | { type: 'hotspot/nudge'; stepId: UUID; hotspotId: UUID; dx: number; dy: number }
  | { type: 'hotspot/target'; stepId: UUID; hotspotId: UUID; targetStepId: UUID | null }
  | { type: 'hotspot/delete'; stepId: UUID; hotspotId: UUID };

function sameSize(a: AssetMeta, b: AssetMeta): boolean {
  return a.width === b.width && a.height === b.height;
}

function touch(g: ProjectGraph): ProjectGraph {
  return { ...g, project: { ...g.project, updatedAt: nowIso() } };
}

function withStep(g: ProjectGraph, stepId: UUID, fn: (s: Step) => Step): ProjectGraph {
  const s = g.steps[stepId];
  if (!s) throw new CommandError('ステップが見つかりません');
  return { ...g, steps: { ...g.steps, [stepId]: fn(s) } };
}

function withHotspot(g: ProjectGraph, stepId: UUID, hotspotId: UUID, fn: (h: Hotspot) => Hotspot): ProjectGraph {
  return withStep(g, stepId, (s) => {
    if (!s.hotspots.some((h) => h.id === hotspotId)) throw new CommandError('クリック箇所が見つかりません');
    return { ...s, hotspots: s.hotspots.map((h) => (h.id === hotspotId ? fn(h) : h)) };
  });
}

/** 純粋関数：コマンドを適用した新しいグラフを返す。失敗時はCommandError。 */
export function applyCommand(g: ProjectGraph, c: Command): ProjectGraph {
  switch (c.type) {
    case 'project/update': {
      const { productLabel, ...rest } = c.patch;
      const project = { ...g.project, ...rest };
      if (productLabel !== undefined) project.brand = { ...project.brand, productLabel: productLabel.slice(0, 60) };
      if (rest.name !== undefined && (rest.name.trim().length < 1 || rest.name.length > 80)) throw new CommandError('デモ名は1〜80字です');
      return touch({ ...g, project });
    }
    case 'step/add': {
      if (g.project.stepOrder.length >= LIMITS.maxSteps) throw new CommandError(`1プロジェクトは最大${LIMITS.maxSteps}ステップです`);
      const id = newId();
      const step: Step = {
        id,
        projectId: g.project.id,
        title: c.title.slice(0, 60) || `画面${g.project.stepOrder.length + 1}`,
        imageAssetId: c.asset.id,
        description: '',
        altText: c.altText.slice(0, 240),
        kind: 'screen',
        hotspots: [],
        redactionReviewedAssetHash: c.reviewedHash === c.asset.sha256 ? c.asset.sha256 : undefined,
        layoutReviewedRevision: 0,
      };
      return touch({
        ...g,
        project: { ...g.project, stepOrder: [...g.project.stepOrder, id], entryStepId: g.project.entryStepId ?? id },
        steps: { ...g.steps, [id]: step },
        assets: { ...g.assets, [c.asset.id]: c.asset },
      });
    }
    case 'step/update':
      return touch(withStep(g, c.stepId, (s) => ({ ...s, ...c.patch })));
    case 'step/kind':
      return touch(withStep(g, c.stepId, (s) => ({ ...s, kind: c.kind })));
    case 'step/move': {
      const order = [...g.project.stepOrder];
      const i = order.indexOf(c.stepId);
      const j = i + c.delta;
      if (i < 0 || j < 0 || j >= order.length) return g;
      [order[i], order[j]] = [order[j]!, order[i]!];
      return touch({ ...g, project: { ...g.project, stepOrder: order } });
    }
    case 'step/reorder': {
      const order = g.project.stepOrder.filter((x) => x !== c.stepId);
      if (order.length === g.project.stepOrder.length) throw new CommandError('ステップが見つかりません');
      order.splice(Math.max(0, Math.min(order.length, c.toIndex)), 0, c.stepId);
      return touch({ ...g, project: { ...g.project, stepOrder: order } });
    }
    case 'step/duplicate': {
      if (g.project.stepOrder.length >= LIMITS.maxSteps) throw new CommandError(`1プロジェクトは最大${LIMITS.maxSteps}ステップです`);
      const src = g.steps[c.stepId];
      if (!src) throw new CommandError('ステップが見つかりません');
      const id = newId();
      // 画像は共有（参照数で削除判定）。Step/HotspotのIDは新規。遷移先は同じステップを指す。
      const copy: Step = {
        ...src,
        id,
        title: `${src.title.slice(0, 55)}のコピー`,
        hotspots: src.hotspots.map((h) => ({ ...h, id: newId(), stepId: id })),
      };
      const order = [...g.project.stepOrder];
      order.splice(order.indexOf(c.stepId) + 1, 0, id);
      return touch({ ...g, project: { ...g.project, stepOrder: order }, steps: { ...g.steps, [id]: copy } });
    }
    case 'step/delete': {
      const target = g.steps[c.stepId];
      if (!target) throw new CommandError('ステップが見つかりません');
      let entry = g.project.entryStepId;
      if (entry === c.stepId) {
        const remaining = g.project.stepOrder.filter((x) => x !== c.stepId);
        if (remaining.length > 0) {
          if (!c.newEntryId || !remaining.includes(c.newEntryId)) throw new CommandError('開始画面を削除する前に、新しい開始画面を選んでください');
          entry = c.newEntryId;
        } else entry = null;
      }
      const steps = { ...g.steps };
      delete steps[c.stepId];
      // 参照元は黙って置き換えない：targetStepIdは残し、書き出し前チェックで「存在しないID」エラーにする。
      const assets = { ...g.assets };
      if (!Object.values(steps).some((s) => s.imageAssetId === target.imageAssetId)) delete assets[target.imageAssetId];
      return touch({ ...g, project: { ...g.project, entryStepId: entry, stepOrder: g.project.stepOrder.filter((x) => x !== c.stepId) }, steps, assets });
    }
    case 'step/setEntry':
      if (!g.steps[c.stepId]) throw new CommandError('ステップが見つかりません');
      return touch({ ...g, project: { ...g.project, entryStepId: c.stepId } });
    case 'step/replaceImage': {
      const old = g.steps[c.stepId];
      if (!old) throw new CommandError('ステップが見つかりません');
      const next = withStep(g, c.stepId, (s) => ({
        ...s,
        imageAssetId: c.asset.id,
        redactionReviewedAssetHash: c.reviewedHash === c.asset.sha256 ? c.asset.sha256 : undefined,
        // 既存領域は仮維持するが、全領域の再確認まで出力を止める（同じ画像への黒塗り追加は寸法不変のため維持）
        layoutReviewedRevision: c.keepLayout && old.imageAssetId in g.assets && sameSize(g.assets[old.imageAssetId]!, c.asset) ? s.layoutReviewedRevision : s.hotspots.length > 0 ? undefined : 0,
      }));
      const assets = { ...next.assets, [c.asset.id]: c.asset };
      if (!Object.values(next.steps).some((s) => s.imageAssetId === old.imageAssetId)) delete assets[old.imageAssetId];
      return touch({ ...next, assets });
    }
    case 'step/confirmLayout':
      return touch(withStep(g, c.stepId, (s) => ({ ...s, layoutReviewedRevision: c.revision })));
    case 'hotspot/add': {
      const s = g.steps[c.stepId];
      if (!s) throw new CommandError('ステップが見つかりません');
      if (s.hotspots.length >= LIMITS.maxHotspotsPerStep) throw new CommandError(`1画面のクリック箇所は最大${LIMITS.maxHotspotsPerStep}個です`);
      const r = validateRect(c.rect ?? { x: 0.4, y: 0.4, w: 0.2, h: 0.08 });
      if (!r.ok) throw new CommandError('領域が不正です');
      const h: Hotspot = {
        id: c.hotspotId ?? newId(),
        stepId: s.id,
        label: `ボタン${s.hotspots.length + 1}`,
        helpText: '',
        rect: r.rect,
        targetStepId: null,
        order: s.hotspots.length,
      };
      return touch(withStep(g, c.stepId, (st) => ({ ...st, hotspots: [...st.hotspots, h] })));
    }
    case 'hotspot/update':
      return touch(withHotspot(g, c.stepId, c.hotspotId, (h) => ({ ...h, ...c.patch })));
    case 'hotspot/rect': {
      const r = validateRect(c.rect);
      if (!r.ok) throw new CommandError(r.error);
      return touch(withHotspot(g, c.stepId, c.hotspotId, (h) => ({ ...h, rect: r.rect })));
    }
    case 'hotspot/nudge':
      return touch(withHotspot(g, c.stepId, c.hotspotId, (h) => ({ ...h, rect: clampMove(h.rect, round6(c.dx), round6(c.dy)) })));
    case 'hotspot/target': {
      if (c.targetStepId !== null) {
        if (!g.steps[c.targetStepId]) throw new CommandError('移動先のステップが存在しません');
        const adj = adjacency(g);
        // 自分のホットスポットを除いた上で循環判定
        const s = g.steps[c.stepId];
        adj.set(c.stepId, (s?.hotspots ?? []).filter((h) => h.id !== c.hotspotId).map((h) => h.targetStepId).filter((t): t is UUID => !!t));
        if (wouldCreateCycle(adj, c.stepId, c.targetStepId)) throw new CommandError('この移動先は循環（同じ画面へ戻る経路）になるため選べません');
      }
      return touch(withHotspot(g, c.stepId, c.hotspotId, (h) => ({ ...h, targetStepId: c.targetStepId })));
    }
    case 'hotspot/delete':
      return touch(withStep(g, c.stepId, (s) => ({ ...s, hotspots: s.hotspots.filter((h) => h.id !== c.hotspotId).map((h, i) => ({ ...h, order: i })) })));
  }
}

// ---- Undo/Redo（編集モデルのみ、上限50件） ----
export interface History {
  present: ProjectGraph;
  past: ProjectGraph[];
  future: ProjectGraph[];
}

export function historyInit(g: ProjectGraph): History {
  return { present: g, past: [], future: [] };
}

export function historyApply(h: History, c: Command): History {
  const next = applyCommand(h.present, c);
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  while (past.length > LIMITS.undoDepth) past.shift();
  return { present: next, past, future: [] };
}

export function historyUndo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { present: prev, past: h.past.slice(0, -1), future: [h.present, ...h.future] };
}

export function historyRedo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { present: next, past: [...h.past, h.present], future: h.future.slice(1) };
}
