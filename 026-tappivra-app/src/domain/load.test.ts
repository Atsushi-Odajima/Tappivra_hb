// T35（一部）：30ステップ・300ホットスポット境界の検査・変換・パッケージ化の所要時間
import { describe, expect, it } from 'vitest';
import { assetFor, makePng } from '../../tests/helpers/fixtures';
import { createProjectGraph } from './model';
import { newId } from './ids';
import { runPreflight } from './preflight';
import { toDemoDocument } from '../export/publicDoc';
import { buildDemoZip, parseDemoZip } from '../export/packages';
import type { Step } from './types';

describe('T35 30ステップ/300ホットスポット境界', () => {
  it('検査・公開変換・ZIP作成と再検証が完了する', async () => {
    const g = createProjectGraph('負荷');
    const images = new Map<string, Uint8Array>();
    const ids = Array.from({ length: 30 }, () => newId());
    ids.forEach((id, i) => {
      const png = makePng(64, 40, [i * 8, 10, 10]);
      const a = assetFor(g.project.id, png, 64, 40);
      images.set(a.id, png);
      g.assets[a.id] = a;
      const hotspots = i === 29 ? [] : Array.from({ length: 10 }, (_, k) => ({ id: newId(), stepId: id, label: `次へ${k}`, helpText: '', rect: { x: (k % 5) * 0.2, y: Math.floor(k / 5) * 0.5, w: 0.18, h: 0.4 }, targetStepId: ids[Math.min(29, i + 1 + (k % 3))]!, order: k }));
      const s: Step = { id, projectId: g.project.id, title: `画面${i + 1}`, imageAssetId: a.id, description: '', altText: `画面${i + 1}`, kind: i === 29 ? 'finish' : 'screen', hotspots, redactionReviewedAssetHash: a.sha256, layoutReviewedRevision: 0 };
      g.steps[id] = s;
      g.project.stepOrder.push(id);
    });
    g.project.entryStepId = ids[0]!;
    const t0 = performance.now();
    const pf = runPreflight(g);
    const t1 = performance.now();
    expect(pf.ok).toBe(true);
    const total = Object.values(g.steps).reduce((n, s) => n + s.hotspots.length, 0);
    expect(total).toBe(290);
    const doc = toDemoDocument(g, new Date().toISOString());
    const zip = buildDemoZip(doc, images);
    const parsed = await parseDemoZip(zip);
    const t2 = performance.now();
    expect(parsed.doc.steps).toHaveLength(30);
    console.log(`T35: preflight ${(t1 - t0).toFixed(1)}ms, convert+zip+parse ${(t2 - t1).toFixed(1)}ms, warnings=${pf.issues.length}`);
    expect(t1 - t0).toBeLessThan(500);
  });
});
