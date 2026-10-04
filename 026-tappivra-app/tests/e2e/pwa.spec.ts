// 閲覧PWA（vite previewで /viewer/ を配信）をChromiumのモバイル模擬で検証する。
// これはiPhone/Android実機試験ではない（T29/T30は未実施）。
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildDemoZip, buildProjectZip } from '../../src/export/packages';
import { toDemoDocument } from '../../src/export/publicDoc';
import { buildFiveStepGraph } from '../helpers/fixtures';
import { SHOTS, TMP } from './util';

function files() {
  const { graph, images } = buildFiveStepGraph();
  const doc = toDemoDocument(graph, new Date().toISOString());
  const demo = path.join(TMP, 'pwa.tappivra-demo.zip');
  const proj = path.join(TMP, 'pwa.tappivra-project.zip');
  writeFileSync(demo, buildDemoZip(doc, images));
  writeFileSync(proj, buildProjectZip(graph, images, new Date().toISOString()));
  const junk = path.join(TMP, 'junk.zip');
  writeFileSync(junk, Buffer.from('this is not a zip at all, just text pretending'));
  return { demo, proj, junk, doc };
}

test.describe('viewer PWA (Chromium mobile emulation)', () => {
  test('T28(模擬) manifest・アイコン・初回2操作', async ({ page, request }) => {
    await page.goto('/viewer/');
    await expect(page.getByText('閲覧データを開く')).toBeVisible();
    await expect(page.getByRole('button', { name: 'サンプル' })).toBeVisible();
    const m = await (await request.get('/viewer/manifest.webmanifest')).json();
    expect(m).toMatchObject({ name: 'Tappivra Viewer', short_name: 'Tappivra', display: 'standalone', background_color: '#FFFFFF', theme_color: '#FFFFFF', scope: '/viewer/', start_url: '/viewer/' });
    expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    for (const i of m.icons) expect((await request.get(i.src)).status()).toBe(200);
    expect((await request.get('/viewer/brand/apple_touch_icon.png')).status()).toBe(200);
    await page.screenshot({ path: path.join(SHOTS, 'G-pwa-home.png') });
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test('T21/T23 編集ZIP・不正ファイルを拒否、閲覧ZIPは端末内で再生', async ({ page }) => {
    const f = files();
    await page.goto('/viewer/');
    const uploads: string[] = [];
    page.on('request', (r) => r.method() !== 'GET' && uploads.push(r.url()));
    await page.getByTestId('open-demo').setInputFiles(f.proj);
    await expect(page.getByRole('alert')).toContainText('編集用バックアップZIPです');
    await page.getByTestId('open-demo').setInputFiles(f.junk);
    await expect(page.getByRole('alert')).toContainText(/壊れて|閲覧用データではありません/);
    await page.getByTestId('open-demo').setInputFiles(f.demo);
    await expect(page.locator('.tv-step-title')).toContainText('一覧');
    // 代替ボタン44px以上・戻る・最初から
    for (const b of await page.locator('.tv-alt, .tv-bar .tv-btn').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: '新規作成へ' }).last().click();
    await page.getByRole('button', { name: '保存完了へ' }).last().click();
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page.locator('.tv-step-title')).toContainText('新規作成');
    await page.screenshot({ path: path.join(SHOTS, 'G-pwa-demo.png'), fullPage: true });
    expect(uploads).toEqual([]);
  });

  test('T31/T32(模擬) 明示保存→オフライン起動→保存版の日時→削除・全削除', async ({ page, context }) => {
    const f = files();
    await page.goto('/viewer/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    // 保存前は永続化なし
    await expect(page.getByText('まだありません')).toBeVisible();
    await page.getByTestId('open-demo').setInputFiles(f.demo);
    await page.getByRole('button', { name: 'この端末へ保存' }).click();
    await expect(page.locator('.pwa-save [role="status"]')).toContainText('バックアップではありません');
    await page.getByRole('button', { name: '← 一覧へ' }).click();
    await expect(page.locator('.pwa-item')).toHaveCount(1);
    await expect(page.locator('.pwa-item')).toContainText('保存した版：');
    // オフライン（機内モード相当）でシェルと保存デモが開く
    await page.reload();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('閲覧データを開く')).toBeVisible();
    await page.locator('.pwa-open').first().click();
    await expect(page.locator('.tv-step-title')).toContainText('一覧');
    await expect(page.locator('.tv-img')).toHaveJSProperty('complete', true);
    await page.getByRole('button', { name: '← 一覧へ' }).click();
    await context.setOffline(false);
    // 個別削除・全削除（確認ダイアログを承認）
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: /を端末から削除/ }).click();
    await expect(page.locator('.pwa-item')).toHaveCount(0);
    await page.getByTestId('open-demo').setInputFiles(f.demo);
    await page.getByRole('button', { name: 'この端末へ保存' }).click();
    await page.getByRole('button', { name: '← 一覧へ' }).click();
    await page.getByRole('button', { name: 'すべて削除' }).click();
    await expect(page.locator('.pwa-item')).toHaveCount(0);
  });
});
