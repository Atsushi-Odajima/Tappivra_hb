// 単独HTML（実ランタイムをesbuildでIIFE化して内包）をfile://で検証する。
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRuntimeStrings } from '../../build/viewerRuntimePlugin';
import { buildDemoHtml } from '../../src/export/html';
import { toDemoDocument } from '../../src/export/publicDoc';
import { buildFiveStepGraph, makePatternPng, sha } from '../helpers/fixtures';
import { SHOTS, TMP } from './util';

async function makeHtml(name: string, mutate?: (g: ReturnType<typeof buildFiveStepGraph>['graph']) => void) {
  const { graph, images } = buildFiveStepGraph();
  // 1440x900相当の比率の画像に差し替え（位置精度試験用）
  for (const a of Object.values(graph.assets)) {
    const png = makePatternPng(144, 90, (x, y) => (x % 16 < 8 !== y % 16 < 8 ? [230, 230, 230] : [250, 250, 250]));
    images.set(a.id, png);
    Object.assign(a, { width: 144, height: 90, byteLength: png.length, sha256: sha(png) });
  }
  mutate?.(graph);
  const doc = toDemoDocument(graph, new Date().toISOString());
  const html = await buildDemoHtml(doc, images, await buildRuntimeStrings());
  const file = path.join(TMP, name);
  writeFileSync(file, html);
  return { file, url: pathToFileURL(file).href, doc };
}

test.describe('standalone HTML (file://, Chromium)', () => {
  test('T07 ホットスポット位置：余白あり・幅/回転/DPR違いで誤差1px以内、代替ボタンも同じ遷移', async ({ browser }) => {
    const { url } = await makeHtml('position.html');
    const cases = [
      { width: 1280, height: 800, dpr: 1 },
      { width: 1280, height: 600, dpr: 1 }, // 72vh制限で左右余白
      { width: 390, height: 844, dpr: 3 }, // 縦
      { width: 844, height: 390, dpr: 3 }, // 横（回転）
      { width: 768, height: 1024, dpr: 2 },
      { width: 1024, height: 768, dpr: 1.5 },
      { width: 360, height: 740, dpr: 2 },
      { width: 430, height: 932, dpr: 3 },
    ];
    for (const c of cases) {
      const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dpr });
      const page = await ctx.newPage();
      await page.goto(url);
      const result = await page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>('.tv-img')!;
        const stage = document.querySelector<HTMLElement>('.tv-stage')!;
        const hs = document.querySelector<HTMLElement>('.tv-hotspot')!;
        const sr = stage.getBoundingClientRect();
        const nw = 144;
        const nh = 90;
        const s = Math.min(stage.clientWidth / nw, stage.clientHeight / nh);
        const rw = nw * s;
        const rh = nh * s;
        const left = sr.left + stage.clientLeft + (stage.clientWidth - rw) / 2;
        const top = sr.top + stage.clientTop + (stage.clientHeight - rh) / 2;
        const r = hs.getBoundingClientRect();
        // fixtureの最初のホットスポット rect = {x:0.1,y:0.6,w:0.3,h:0.1}
        const exp = { l: left + 0.1 * rw, t: top + 0.6 * rh, w: 0.3 * rw, h: 0.1 * rh };
        return { dl: Math.abs(r.left - exp.l), dt: Math.abs(r.top - exp.t), dw: Math.abs(r.width - exp.w), dh: Math.abs(r.height - exp.h), letterbox: { x: (stage.clientWidth - rw) / 2, y: (stage.clientHeight - rh) / 2 }, imgFit: getComputedStyle(img).objectFit };
      });
      expect(result.imgFit).toBe('contain');
      for (const k of ['dl', 'dt', 'dw', 'dh'] as const) expect(result[k], `${JSON.stringify(c)} ${k}`).toBeLessThanOrEqual(1);
      if (c.width === 1280 && c.height === 600) expect(result.letterbox.x).toBeGreaterThan(10);
      const alt = page.locator('.tv-alt').first();
      expect((await alt.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (c.width === 390) await page.screenshot({ path: path.join(SHOTS, 'G-html-390.png'), fullPage: true });
      await ctx.close();
    }
  });

  test('T07 リサイズ（回転）後に再計算', async ({ page }) => {
    const { url } = await makeHtml('resize.html');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    const w1 = (await page.locator('.tv-hotspot').first().boundingBox())!.width;
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => (await page.locator('.tv-hotspot').first().boundingBox())!.width).not.toBeCloseTo(w1, 0);
  });

  test('T19 タイトルの</script>・HTML・引用符・Unicode区切りは文字として表示しJSを実行しない', async ({ page }) => {
    const evil = '</script><img src=x onerror="window.__pwned=1;alert(1)">"\'  &<b>';
    const { url } = await makeHtml('xss.html', (g) => {
      g.project.name = evil.slice(0, 80);
      g.steps[g.project.stepOrder[0]!]!.title = '<img src=y onerror=alert(2)>';
      g.steps[g.project.stepOrder[0]!]!.description = '<script>alert(3)</script>';
    });
    const dialogs: string[] = [];
    const violations: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    page.on('console', (m) => m.type() === 'error' && violations.push(m.text()));
    await page.goto(url);
    await expect(page.locator('.tv-title')).toHaveText(evil.slice(0, 80));
    await expect(page.locator('.tv-step-title')).toContainText('<img src=y onerror=alert(2)>');
    await expect(page.locator('.tv-desc')).toHaveText('<script>alert(3)</script>');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialogs).toEqual([]);
    expect(await page.locator('img[src="x"], img[src="y"], b').count()).toBe(0);
    expect(violations.filter((v) => /Content Security Policy/.test(v))).toEqual([]);
  });

  test('T20 オフライン file:// で画像・分岐・戻る、外部通信0件、fetch/module不使用', async ({ browser }) => {
    const { url, file } = await makeHtml('offline.html');
    const ctx = await browser.newContext({ offline: true });
    const page = await ctx.newPage();
    const req: string[] = [];
    page.on('request', (r) => req.push(r.url()));
    await page.goto(url);
    await expect(page.locator('.tv-img')).toHaveJSProperty('naturalWidth', 144);
    await page.getByRole('button', { name: '新規作成へ' }).last().click();
    await page.getByRole('button', { name: '入力例へ' }).last().click();
    await page.getByRole('button', { name: '戻る' }).click();
    await page.getByRole('button', { name: '保存完了へ' }).last().click();
    await page.getByRole('button', { name: '終了案内へ' }).last().click();
    await expect(page.locator('.tv-finish-text')).toBeVisible();
    await page.getByRole('button', { name: '最初から' }).first().click();
    await expect(page.locator('.tv-step-title')).toContainText('一覧');
    expect(req.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'))).toEqual([]);
    const src = (await import('node:fs')).readFileSync(file, 'utf8');
    expect(src).not.toMatch(/type="module"|\bfetch\(|https?:\/\/(?!www\.w3\.org)/);
    await ctx.close();
  });

  test('T34 閲覧HTMLのaxe・キーボード操作・reduced motion', async ({ browser }) => {
    const { url } = await makeHtml('a11y.html');
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(url);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(',')}`)).toEqual([]);
    await page.keyboard.press('Tab'); // 目次
    await expect(page.getByRole('button', { name: '目次' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: '目次' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: '目次' })).toBeHidden();
    await page.keyboard.press('Tab'); // ホットスポット
    await expect(page.locator('.tv-hotspot').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.tv-step-title')).toBeFocused();
    await expect(page.locator('.tv-step-title')).toContainText('新規作成');
    expect(await page.locator('.tv-hotspot').first().evaluate((e) => getComputedStyle(e).transitionDuration)).toBe('0s');
    await ctx.close();
  });
});
