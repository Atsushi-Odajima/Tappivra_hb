import { describe, expect, it } from 'vitest';
import { buildFiveStepGraph, makePng, assetFor } from '../../tests/helpers/fixtures';
import { analyzeGraph, wouldCreateCycle } from './graph';
import { applyCommand, CommandError, historyApply, historyInit, historyRedo, historyUndo, incomingLinks } from './model';
import { runPreflight } from './preflight';
import { clampMove, containBox, hotspotBox, validateRect } from './rect';
import { LIMITS, MiB } from './limits';
import { zProjectGraph } from './schema';

describe('T08 数値入力・矩形', () => {
  it('NaN/Infinity/負/0幅/端はみ出しを拒否する', () => {
    expect(validateRect({ x: NaN, y: 0, w: 0.1, h: 0.1 })).toEqual({ ok: false, error: 'not-finite' });
    expect(validateRect({ x: 0, y: Infinity, w: 0.1, h: 0.1 })).toEqual({ ok: false, error: 'not-finite' });
    expect(validateRect({ x: -0.01, y: 0, w: 0.1, h: 0.1 })).toMatchObject({ ok: false, error: 'negative' });
    expect(validateRect({ x: 0, y: 0, w: 0, h: 0.1 })).toMatchObject({ ok: false, error: 'too-small' });
    expect(validateRect({ x: 0, y: 0, w: 0.009, h: 0.1 })).toMatchObject({ ok: false, error: 'too-small' });
    expect(validateRect({ x: 0.95, y: 0, w: 0.1, h: 0.1 })).toMatchObject({ ok: false, error: 'overflow' });
  });
  it('小数は6桁に正規化し、端ちょうどは許可する', () => {
    const r = validateRect({ x: 0.1234567891, y: 0, w: 0.8765432109, h: 1 });
    expect(r).toEqual({ ok: true, rect: { x: 0.123457, y: 0, w: 0.876543, h: 1 } });
  });
  it('矢印移動は画面端で止まる', () => {
    expect(clampMove({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 0.02, 0.02)).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
    expect(clampMove({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, -0.005, 0)).toEqual({ x: 0.495, y: 0.5, w: 0.1, h: 0.1 });
  });
});

describe('T07 object-fit: contain の位置計算', () => {
  it('横長コンテナでは左右に余白', () => {
    const b = containBox(1000, 500, 1440, 900);
    expect(b.height).toBeCloseTo(500);
    expect(b.width).toBeCloseTo(800);
    expect(b.left).toBeCloseTo(100);
    expect(b.top).toBeCloseTo(0);
    const h = hotspotBox(b, { x: 0.736111, y: 0.133333, w: 0.159722, h: 0.062222 });
    // 元画像1440x900の(1060,120,230,56)を0.5555倍した位置
    expect(h.left).toBeCloseTo(100 + 1060 * (800 / 1440), 0);
    expect(h.top).toBeCloseTo(120 * (500 / 900), 0);
    expect(h.width).toBeCloseTo(230 * (800 / 1440), 0);
  });
  it('縦長コンテナ(390px)では上下に余白', () => {
    const b = containBox(390, 600, 1440, 900);
    expect(b.width).toBeCloseTo(390);
    expect(b.top).toBeCloseTo((600 - 243.75) / 2);
  });
});

describe('T11 循環・T12 到達性', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  it('自己リンク・2点循環・深い循環を検知', () => {
    expect(analyzeGraph(['a'], new Map([['a', ['a']]]), 'a', new Set()).selfLoops).toEqual(['a']);
    expect(analyzeGraph(['a', 'b'], new Map([['a', ['b']], ['b', ['a']]]), 'a', new Set()).cycles).toHaveLength(1);
    const deep = new Map(ids.map((id, i) => [id, [ids[(i + 1) % 5]!]]));
    expect(analyzeGraph(ids, deep, 'a', new Set()).cycles[0]).toHaveLength(5);
  });
  it('分岐と合流のDAGは許可', () => {
    const adj = new Map([
      ['a', ['b', 'c']],
      ['b', ['d']],
      ['c', ['d']],
      ['d', []],
    ]);
    const r = analyzeGraph(['a', 'b', 'c', 'd'], adj, 'a', new Set(['d']));
    expect(r).toEqual({ selfLoops: [], cycles: [], unreachable: [], deadEnds: [] });
  });
  it('未到達ノードと終了へ到達しない経路を検知', () => {
    const adj = new Map([
      ['a', ['b', 'c']],
      ['b', []],
      ['c', []],
      ['x', ['c']],
    ]);
    const r = analyzeGraph(['a', 'b', 'c', 'x'], adj, 'a', new Set(['c']));
    expect(r.unreachable).toEqual(['x']);
    expect(r.deadEnds).toEqual(['b']);
  });
  it('wouldCreateCycle', () => {
    const adj = new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
    ]);
    expect(wouldCreateCycle(adj, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(adj, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(adj, 'a', 'c')).toBe(false);
  });
  it('全枝がfinishへ到達する5ステップサンプルは合格', () => {
    const { graph } = buildFiveStepGraph();
    const r = runPreflight(graph);
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(zProjectGraph.safeParse(graph).success).toBe(true);
  });
  it('コマンドで循環リンクを作れない', () => {
    const { graph, ids } = buildFiveStepGraph();
    const hs = graph.steps[ids[4]!]!;
    const g2 = applyCommand(graph, { type: 'hotspot/add', stepId: hs.id });
    const h = g2.steps[ids[4]!]!.hotspots[0]!;
    expect(() => applyCommand(g2, { type: 'hotspot/target', stepId: ids[4]!, hotspotId: h.id, targetStepId: ids[0]! })).toThrow(CommandError);
    expect(() => applyCommand(g2, { type: 'hotspot/target', stepId: ids[4]!, hotspotId: h.id, targetStepId: ids[4]! })).toThrow(CommandError);
  });
});

describe('T09 並べ替え・複製', () => {
  it('順番変更でIDとリンクは変わらない', () => {
    const { graph, ids } = buildFiveStepGraph();
    const before = JSON.stringify(graph.steps);
    const g2 = applyCommand(applyCommand(graph, { type: 'step/move', stepId: ids[0]!, delta: 1 }), { type: 'step/reorder', stepId: ids[4]!, toIndex: 0 });
    expect(g2.project.stepOrder).toEqual([ids[4], ids[1], ids[0], ids[2], ids[3]]);
    expect(JSON.stringify(g2.steps)).toBe(before);
  });
  it('複製は新しいStep/Hotspot IDを作り、画像は共有、参照削除で他を壊さない', () => {
    const { graph, ids } = buildFiveStepGraph();
    const g2 = applyCommand(graph, { type: 'step/duplicate', stepId: ids[1]! });
    const copyId = g2.project.stepOrder[2]!;
    const copy = g2.steps[copyId]!;
    const orig = g2.steps[ids[1]!]!;
    expect(copyId).not.toBe(ids[1]);
    expect(copy.hotspots.map((h) => h.id)).not.toEqual(orig.hotspots.map((h) => h.id));
    expect(copy.hotspots.every((h) => h.stepId === copyId)).toBe(true);
    expect(copy.imageAssetId).toBe(orig.imageAssetId);
    const g3 = applyCommand(g2, { type: 'step/delete', stepId: copyId });
    expect(g3.assets[orig.imageAssetId]).toBeDefined();
    const g4 = applyCommand(g3, { type: 'step/delete', stepId: ids[2]! });
    expect(g4.assets[graph.steps[ids[2]!]!.imageAssetId]).toBeUndefined();
  });
});

describe('T10 削除', () => {
  it('入リンク数を数え、削除後は参照切れをエラーとして残す（無断で置き換えない）', () => {
    const { graph, ids } = buildFiveStepGraph();
    expect(incomingLinks(graph, ids[3]!)).toHaveLength(2);
    const g2 = applyCommand(graph, { type: 'step/delete', stepId: ids[3]! });
    expect(g2.steps[ids[1]!]!.hotspots[1]!.targetStepId).toBe(ids[3]);
    const r = runPreflight(g2);
    expect(r.ok).toBe(false);
    expect(r.issues.filter((i) => i.code === 'target-missing')).toHaveLength(2);
  });
  it('開始点の削除は代替選択が必要', () => {
    const { graph, ids } = buildFiveStepGraph();
    expect(() => applyCommand(graph, { type: 'step/delete', stepId: ids[0]! })).toThrow(/開始画面/);
    const g2 = applyCommand(graph, { type: 'step/delete', stepId: ids[0]!, newEntryId: ids[1]! });
    expect(g2.project.entryStepId).toBe(ids[1]);
  });
});

describe('T13 画像差し替え', () => {
  it('画像hashと領域確認を無効化し、再確認前は出力不可', () => {
    const { graph, ids } = buildFiveStepGraph();
    const png = makePng(40, 25, [1, 2, 3]);
    const a = assetFor(graph.project.id, png, 40, 25);
    const g2 = applyCommand(graph, { type: 'step/replaceImage', stepId: ids[0]!, asset: a, reviewedHash: '' });
    const s = g2.steps[ids[0]!]!;
    expect(s.hotspots).toHaveLength(1); // 領域は仮維持
    expect(s.layoutReviewedRevision).toBeUndefined();
    const codes = runPreflight(g2).issues.map((i) => i.code);
    expect(codes).toContain('layout-unreviewed');
    expect(codes).toContain('redaction-unreviewed');
    const g3 = applyCommand(g2, { type: 'step/replaceImage', stepId: ids[0]!, asset: a, reviewedHash: a.sha256 });
    const g4 = applyCommand(g3, { type: 'step/confirmLayout', stepId: ids[0]!, revision: 3 });
    expect(runPreflight(g4).ok).toBe(true);
  });
});

describe('T17 Undo/Redo', () => {
  it('追加・移動・削除を戻せる。上限50件', () => {
    const { graph, ids } = buildFiveStepGraph();
    let h = historyInit(graph);
    for (let i = 0; i < 60; i++) h = historyApply(h, { type: 'hotspot/nudge', stepId: ids[0]!, hotspotId: graph.steps[ids[0]!]!.hotspots[0]!.id, dx: i % 2 ? 0.005 : -0.005, dy: 0 });
    expect(h.past).toHaveLength(LIMITS.undoDepth);
    let u = h;
    for (let i = 0; i < 60; i++) u = historyUndo(u);
    expect(u.past).toHaveLength(0);
    expect(u.future).toHaveLength(50);
    h = historyInit(graph);
    h = historyApply(h, { type: 'hotspot/add', stepId: ids[0]! });
    h = historyApply(h, { type: 'step/move', stepId: ids[0]!, delta: 1 });
    h = historyApply(h, { type: 'step/delete', stepId: ids[2]! });
    const after = h.present;
    h = historyUndo(historyUndo(historyUndo(h)));
    expect(h.present).toBe(graph);
    h = historyRedo(historyRedo(historyRedo(h)));
    expect(h.present).toBe(after);
  });
});

describe('T25 公開前ゲート', () => {
  it('未確認画像・alt不足・リンク切れ・容量超過は不可、修正→合格', () => {
    const { graph, ids } = buildFiveStepGraph();
    const s0 = graph.steps[ids[0]!]!;
    const bad = {
      ...graph,
      steps: {
        ...graph.steps,
        [ids[0]!]: { ...s0, altText: ' ', redactionReviewedAssetHash: undefined, hotspots: [{ ...s0.hotspots[0]!, targetStepId: null }] },
      },
    };
    const codes = runPreflight(bad).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['alt-missing', 'redaction-unreviewed', 'target-unset']));
    const big = structuredClone(graph);
    for (const a of Object.values(big.assets)) a.byteLength = 5.5 * MiB;
    const rb = runPreflight(big);
    expect(rb.issues.map((i) => i.code)).toContain('demo-too-large');
    const warn = structuredClone(graph);
    for (const a of Object.values(warn.assets)) a.byteLength = 3.2 * MiB;
    const rw = runPreflight(warn);
    expect(rw.ok).toBe(true);
    expect(rw.issues.map((i) => i.code)).toContain('demo-large');
    expect(runPreflight(graph).ok).toBe(true);
  });
  it('完了画面なし・クリック箇所なしの画面はエラー', () => {
    const { graph, ids } = buildFiveStepGraph();
    const g2 = applyCommand(graph, { type: 'step/kind', stepId: ids[4]!, kind: 'screen' });
    const codes = runPreflight(g2).issues.map((i) => i.code);
    expect(codes).toContain('no-finish');
    expect(codes).toContain('no-hotspot');
  });
  it('上限：ステップ30・ホットスポット10', () => {
    const { graph, ids } = buildFiveStepGraph();
    let g = graph;
    for (let i = 0; i < 9; i++) g = applyCommand(g, { type: 'hotspot/add', stepId: ids[0]! });
    expect(() => applyCommand(g, { type: 'hotspot/add', stepId: ids[0]! })).toThrow(/最大10/);
    let g2 = graph;
    for (let i = 0; i < 25; i++) g2 = applyCommand(g2, { type: 'step/duplicate', stepId: ids[2]! });
    expect(g2.project.stepOrder).toHaveLength(30);
    expect(() => applyCommand(g2, { type: 'step/duplicate', stepId: ids[2]! })).toThrow(/最大30/);
  });
});

describe('T13 補足：同じ画像への黒塗り追加', () => {
  it('寸法が同じなら領域確認を維持、画像確認は新hashで判定', () => {
    const { graph, ids } = buildFiveStepGraph();
    const png = makePng(40, 25, [9, 9, 9]);
    const a = assetFor(graph.project.id, png, 40, 25);
    const g2 = applyCommand(graph, { type: 'step/replaceImage', stepId: ids[0]!, asset: a, reviewedHash: a.sha256, keepLayout: true });
    expect(g2.steps[ids[0]!]!.layoutReviewedRevision).toBe(0);
    expect(runPreflight(g2).ok).toBe(true);
    const b = assetFor(graph.project.id, makePng(80, 25), 80, 25);
    const g3 = applyCommand(graph, { type: 'step/replaceImage', stepId: ids[0]!, asset: b, reviewedHash: b.sha256, keepLayout: true });
    expect(g3.steps[ids[0]!]!.layoutReviewedRevision).toBeUndefined();
  });
});
