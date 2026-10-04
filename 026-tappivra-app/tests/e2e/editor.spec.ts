import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readZipSafely } from '../../src/export/zip';
import { makePatternPng } from '../helpers/fixtures';
import { exportAs, openSample, SENTINEL, SHOTS, TMP } from './util';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const SECRET_NAME = 'C__Users_tanaka_secret-customer-list.png';

async function newDemo(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'デモを作る' }).first().click();
  await page.getByLabel('デモ名（1〜80字）').fill(name);
  await page.getByRole('button', { name: '作成して編集' }).click();
  await expect(page.getByRole('heading', { name: '画面の押せる場所を指定' })).toBeVisible();
}

async function importOne(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, opts: { mask?: [number, number, number, number]; alt: string; review?: boolean }) {
  await page.getByTestId('add-images').setInputFiles(file);
  const dlg = page.getByRole('dialog', { name: '画像を確認して取り込む' });
  await expect(dlg).toBeVisible();
  const stage = dlg.getByTestId('import-stage');
  await expect(stage.locator('canvas')).toBeVisible();
  if (opts.mask) {
    const box = (await stage.locator('canvas').boundingBox())!;
    const [x0, y0, x1, y1] = opts.mask;
    await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 5 });
    await page.mouse.up();
    await expect(dlg.getByTestId('mask')).toHaveCount(1);
  }
  await dlg.getByLabel('代替テキスト（画像の説明）').fill(opts.alt);
  if (opts.review !== false) {
    await dlg.getByLabel('この画像に公開したくない情報がないか確認しました').check();
    await dlg.getByRole('button', { name: '確認して保存' }).click();
  } else {
    await dlg.getByRole('button', { name: /確認せずに保存/ }).click();
  }
  await expect(dlg).toBeHidden();
}

/** mock保存の画像bytesを取得 */
async function storedAssets(page: Page) {
  return page.evaluate(() => {
    const m = (window as unknown as { __tappivraMock: { assets: Map<string, { meta: { mime: string; width: number; height: number; sha256: string }; bytes: Uint8Array }> } }).__tappivraMock;
    return [...m.assets.values()].map((a) => ({ meta: a.meta, b64: btoa(String.fromCharCode(...a.bytes)) }));
  });
}

/** ブラウザーで画像をデコードし、指定領域の画素を返す */
async function pixelStats(page: Page, b64: string, mime: string, region: [number, number, number, number]) {
  return page.evaluate(
    async ({ b64, mime, region }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: mime }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const [x0, y0, x1, y1] = region.map((v, i) => Math.round(v * (i % 2 ? bmp.height : bmp.width)));
      const d = ctx.getImageData(x0!, y0!, x1! - x0!, y1! - y0!).data;
      let max = 0;
      let green = 0;
      for (let i = 0; i < d.length; i += 4) {
        max = Math.max(max, d[i]!, d[i + 1]!, d[i + 2]!);
        if (d[i + 1]! > 150 && d[i]! < 100) green++;
      }
      return { max, green, w: bmp.width, h: bmp.height };
    },
    { b64, mime, region },
  );
}

test.describe('editor (web shell, mock storage, Chromium)', () => {
  test('T36/T01(web) サンプル→プレビュー→3形式→file://再生→編集復元→再出力', async ({ page, browser }) => {
    await openSample(page);
    // プレビュー（実際の閲覧ランタイム）
    await page.getByRole('button', { name: 'プレビュー' }).click();
    const pv = page.getByTestId('preview-frame');
    await expect(pv.locator('.tv-step-title')).toContainText('一覧');
    await pv.getByRole('button', { name: '新規作成を開く' }).last().click();
    await expect(pv.locator('.tv-step-title')).toContainText('新規作成');
    await page.getByRole('button', { name: 'スマホ 390px' }).click();
    await expect(pv).toHaveClass(/mobile/);
    await page.screenshot({ path: path.join(SHOTS, 'D-preview-mobile.png') });
    await expect(pv.locator('.tv-panel, .ed-right')).toHaveCount(0); // 編集UIをプレビュー内に出さない
    await page.getByRole('dialog', { name: '閲覧プレビュー' }).getByRole('button', { name: '閉じる' }).click();

    const html = await exportAs(page, 'html');
    const demo = await exportAs(page, 'demo-zip');
    const proj = await exportAs(page, 'project-zip');
    expect(html.name).toMatch(/^tappivra-demo_demo_r\d+\.html$/);
    expect(demo.name).toBe('demo.tappivra-demo.zip');
    expect(proj.name).toBe('demo.tappivra-project.zip');
    // T18: 内部メモは閲覧物に含まれず編集ZIPのみ
    expect(html.bytes.toString('utf8')).not.toContain(SENTINEL);
    for (const b of readZipSafely(new Uint8Array(demo.bytes)).values()) expect(Buffer.from(b).toString('utf8')).not.toContain(SENTINEL);
    expect(Buffer.from(readZipSafely(new Uint8Array(proj.bytes)).get('manifest.json')!).toString()).toContain(SENTINEL);

    // T20: file:// で通信遮断・外部通信0件
    const ctx = await browser.newContext({ offline: true });
    const p2 = await ctx.newPage();
    const requests: string[] = [];
    p2.on('request', (r) => requests.push(r.url()));
    await p2.goto(pathToFileURL(html.file).href);
    await expect(p2.locator('.tv-step-title')).toContainText('一覧');
    await expect(p2.locator('.tv-img')).toHaveJSProperty('complete', true);
    expect(await p2.locator('.tv-img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1440);
    await p2.getByRole('button', { name: '新規作成を開く' }).last().click();
    await p2.getByRole('button', { name: '入力例を表示' }).last().click();
    await p2.getByRole('button', { name: '戻る' }).click();
    await expect(p2.locator('.tv-step-title')).toContainText('新規作成');
    await p2.getByRole('button', { name: '保存済みの例を見る' }).last().click();
    await p2.getByRole('button', { name: '説明を終える' }).last().click();
    await expect(p2.locator('.tv-finish-text')).toBeVisible();
    expect(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'))).toEqual([]);
    await ctx.close();

    // T24: 編集ZIP復元（新しいプロジェクトとして）→再出力
    await page.getByRole('button', { name: '← 戻る' }).click();
    await page.getByTestId('open-project-zip').setInputFiles(proj.file);
    await expect(page.getByText(/新しいデモとして復元しました/)).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(2);
    await page.locator('.card-open').nth(0).click();
    await expect(page.getByRole('heading', { name: '画面の押せる場所を指定' })).toBeVisible();
    const html2 = await exportAs(page, 'html');
    const docOf = (h: Buffer) => JSON.parse(h.toString('utf8').match(/<script id="tappivra-data" type="application\/json">([\s\S]*?)<\/script>/)![1]!);
    const a = docOf(html.bytes);
    const b = docOf(html2.bytes);
    const shape = (d: { doc: { steps: { title: string; description: string; hotspots: { label: string; rect: unknown }[]; assetId: string }[]; assets: { id: string; sha256: string }[] } }) =>
      d.doc.steps.map((s) => ({ t: s.title, d: s.description, h: s.hotspots.map((x) => [x.label, x.rect]), sha: d.doc.assets.find((x) => x.id === s.assetId)!.sha256 }));
    expect(shape(b)).toEqual(shape(a));
    expect(b.doc.steps[0].id).not.toBe(a.doc.steps[0].id);
  });

  test('T02/T05/T06 PNG・JPEG・WebP取り込み、黒塗り焼き込み、EXIF・ファイル名の除去', async ({ page }) => {
    await newDemo(page, '黒塗り試験');
    // 緑の秘密パターン（右上）を含むPNG
    const W = 400;
    const H = 250;
    const png = Buffer.from(makePatternPng(W, H, (x, y) => (x >= 240 && x < 360 && y >= 40 && y < 100 ? ((x + y) % 4 < 2 ? [0, 220, 0] : [0, 180, 40]) : [240, 240, 240])));
    writeFileSync(path.join(TMP, 'pattern.png'), png);
    await importOne(page, { name: SECRET_NAME, mimeType: 'image/png', buffer: png }, { mask: [0.58, 0.14, 0.92, 0.42], alt: '黒塗り試験の画面' });

    // EXIF付きJPEGとWebPをブラウザーで生成
    const made = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#c33';
      ctx.fillRect(0, 0, 300, 200);
      const toB64 = async (type: string) => {
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.9));
        return new Uint8Array(await blob.arrayBuffer());
      };
      const jpg = await toB64('image/jpeg');
      const exifText = new TextEncoder().encode('Exif\0\0EXIF_SECRET_MARKER_GPS_35.6812N_139.7671E');
      const app1 = new Uint8Array(4 + exifText.length);
      app1.set([0xff, 0xe1, (exifText.length + 2) >> 8, (exifText.length + 2) & 255]);
      app1.set(exifText, 4);
      const withExif = new Uint8Array(jpg.length + app1.length);
      withExif.set(jpg.subarray(0, 2));
      withExif.set(app1, 2);
      withExif.set(jpg.subarray(2), 2 + app1.length);
      const webp = await toB64('image/webp');
      const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
      return { jpg: b64(withExif), webp: b64(webp) };
    });
    const jpg = Buffer.from(made.jpg, 'base64');
    expect(jpg.toString('latin1')).toContain('EXIF_SECRET_MARKER');
    await importOne(page, { name: 'D__private_folder_photo.jpg', mimeType: 'image/jpeg', buffer: jpg }, { alt: 'JPEG画面' });
    await importOne(page, { name: 'webp-input.webp', mimeType: 'image/webp', buffer: Buffer.from(made.webp, 'base64') }, { alt: 'WebP画面' });
    await expect(page.locator('.step-item')).toHaveCount(3);
    await page.screenshot({ path: path.join(SHOTS, 'C-after-import.png') });

    const assets = await storedAssets(page);
    expect(assets.map((a) => a.meta.mime)).toEqual(['image/png', 'image/jpeg', 'image/png']);
    expect(assets.map((a) => [a.meta.width, a.meta.height])).toEqual([
      [400, 250],
      [300, 200],
      [300, 200],
    ]);
    // T05: 保存済み（加工後）画像の秘密領域は黒、元画像bytes/hashは保存されていない
    const masked = await pixelStats(page, assets[0]!.b64, 'image/png', [0.6, 0.16, 0.9, 0.4]);
    expect(masked.green).toBe(0);
    expect(masked.max).toBe(0);
    const outside = await pixelStats(page, assets[0]!.b64, 'image/png', [0.05, 0.6, 0.4, 0.9]);
    expect(outside.max).toBeGreaterThan(200);
    for (const a of assets) {
      expect(a.meta.sha256).not.toBe(sha(png));
      expect(a.meta.sha256).not.toBe(sha(jpg));
    }
    // T06: EXIF・ファイル名が残らない
    const jpgStored = Buffer.from(assets[1]!.b64, 'base64');
    expect(jpgStored.toString('latin1')).not.toContain('EXIF_SECRET_MARKER');

    // クリック箇所・完了画面を設定してから3形式を出力し、元bytes・名前・EXIFが含まれないことを確認
    await page.locator('.step-item').nth(0).click();
    await page.getByRole('button', { name: '＋ クリック箇所を追加' }).click();
    await page.getByLabel('移動先').selectOption({ index: 1 });
    await page.locator('.step-item').nth(1).click();
    await page.getByRole('button', { name: '＋ クリック箇所を追加' }).click();
    await page.getByLabel('移動先').selectOption({ index: 2 });
    await page.locator('.step-item').nth(2).click();
    await page.getByLabel('完了画面（デモの終わり）').check();
    const outs = [await exportAs(page, 'html'), await exportAs(page, 'demo-zip'), await exportAs(page, 'project-zip')];
    const needles = ['tanaka', 'secret-customer', 'private_folder', 'EXIF_SECRET_MARKER', 'webp-input', 'C__Users'];
    for (const o of outs) {
      const blobs = o.name.endsWith('.zip') ? [...readZipSafely(new Uint8Array(o.bytes)).values()].map((b) => Buffer.from(b)) : [o.bytes];
      for (const b of blobs) {
        const s = b.toString('latin1') + b.toString('utf8');
        for (const n of needles) expect(s, `${o.name} contains ${n}`).not.toContain(n);
        expect(b.includes(png.subarray(33, 133))).toBe(false); // 元PNGのIDATの一部
      }
    }
  });

  test('T02 EXIF回転（Orientation=6）のJPEGは向きを補正して保存し、EXIFは残さない', async ({ page }) => {
    await newDemo(page, '向き試験');
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 200;
      c.getContext('2d')!.fillRect(0, 0, 300, 200);
      const jpg = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9))).arrayBuffer());
      // APP1: Exif\0\0 + TIFF(MM) + IFD0{Orientation=6}
      const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
      const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
      const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
      const out = new Uint8Array(jpg.length + app1.length);
      out.set(jpg.subarray(0, 2));
      out.set(app1, 2);
      out.set(jpg.subarray(2), 2 + app1.length);
      return btoa(String.fromCharCode(...out));
    });
    await importOne(page, { name: 'rotated.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') }, { alt: '回転画像' });
    const [a] = await storedAssets(page);
    expect([a!.meta.width, a!.meta.height]).toEqual([200, 300]);
    expect(Buffer.from(a!.b64, 'base64').includes(Buffer.from('Exif\0\0MM', 'latin1'))).toBe(false);
  });

  test('T03 非対応・偽拡張子を拒否し、アプリは継続', async ({ page }) => {
    await newDemo(page, '形式試験');
    const bad = [
      { name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1') },
      { name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') },
      { name: 'page.png', mimeType: 'image/png', buffer: Buffer.from('<!doctype html><script>alert(1)</script>') },
      { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') },
      { name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(32)]) },
      { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('00000000IHDR'), Buffer.alloc(40, 7)]) },
    ];
    for (const f of bad) {
      await page.getByTestId('add-images').setInputFiles(f);
      const dlg = page.getByRole('dialog');
      await expect(dlg.getByRole('alert')).toContainText(/この形式は使えません|画像を読み込めませんでした/);
      await dlg.getByRole('button', { name: 'キャンセル' }).click();
    }
    await expect(page.locator('.step-item')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '画面の押せる場所を指定' })).toBeVisible();
  });

  test('T25/T26 書き出し前ゲート・該当箇所へ・取消・書込失敗', async ({ page }) => {
    await newDemo(page, 'ゲート試験');
    const png = Buffer.from(makePatternPng(200, 120, () => [200, 200, 200]));
    await importOne(page, { name: 'a.png', mimeType: 'image/png', buffer: png }, { alt: '画面A', review: false });
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: '書き出し前チェック' });
    await expect(dlg.getByTestId('issues')).toContainText('公開前確認が済んでいません');
    await expect(dlg.getByTestId('issues')).toContainText('完了画面');
    await page.screenshot({ path: path.join(SHOTS, 'E-export-errors.png') });
    await dlg.locator('label.format', { hasText: '閲覧用HTML' }).locator('input').check();
    await expect(dlg.getByRole('button', { name: '書き出して保存' })).toBeDisabled();
    // 該当箇所へ
    await dlg.locator('[data-code="redaction-unreviewed"]').getByRole('button', { name: '該当箇所へ' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('.ed-right')).toContainText('公開前の確認が必要です');
    // 編集バックアップは未完成でも保存可。取消と書込失敗を確認
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    await dlg.locator('label.format', { hasText: '編集用バックアップZIP' }).locator('input').check();
    await page.evaluate(() => ((window as unknown as { __tappivraMock: { controls: { cancelNextFileSave: boolean } } }).__tappivraMock.controls.cancelNextFileSave = true));
    await dlg.getByRole('button', { name: 'バックアップを保存' }).click();
    await expect(dlg).toContainText('書き出しを取り消しました');
    await expect(dlg.getByTestId('export-result')).toHaveCount(0);
    await page.evaluate(() => ((window as unknown as { __tappivraMock: { controls: { failNextFileSave: boolean } } }).__tappivraMock.controls.failNextFileSave = true));
    await dlg.getByRole('button', { name: 'バックアップを保存' }).click();
    await expect(dlg.getByRole('alert')).toContainText('書込権限なし');
    await expect(dlg.getByTestId('export-result')).toHaveCount(0);
    // 修正→再検査成功
    await dlg.getByRole('button', { name: '閉じる' }).first().click();
    await page.getByRole('button', { name: '画像を確認する' }).click();
    const imp = page.getByRole('dialog', { name: '画像の秘密情報を隠す' });
    await imp.getByLabel('この画像に公開したくない情報がないか確認しました').check();
    await imp.getByRole('button', { name: '確認して保存' }).click();
    await expect(imp).toBeHidden();
    await page.getByLabel('完了画面（デモの終わり）').check();
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    await expect(dlg).toContainText('書き出しの準備ができました');
  });

  test('T08/T17 キーボード移動・数値入力・Undo', async ({ page }) => {
    await openSample(page);
    const hs = page.getByTestId('editor-stage').locator('.hs').first();
    await hs.focus();
    const x = page.getByLabel('X', { exact: true });
    await expect(x).toHaveValue('73.61');
    await page.keyboard.press('ArrowRight');
    await expect(x).toHaveValue('74.11');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(x).toHaveValue('72.11');
    await page.keyboard.press('Control+z');
    await expect(x).toHaveValue('74.11');
    await page.keyboard.press('Control+y');
    await expect(x).toHaveValue('72.11');
    await x.fill('abc');
    await x.press('Enter');
    await expect(page.getByRole('alert').first()).toContainText('数値を入力してください');
    await x.fill('95');
    await x.press('Enter');
    await expect(page.getByRole('alert').first()).toContainText('はみ出さない');
    await page.getByLabel('幅', { exact: true }).fill('0');
    await page.getByLabel('幅', { exact: true }).press('Enter');
    await expect(page.getByRole('alert').first()).toContainText(/1%以上|はみ出さない/);
  });

  test('T34 アクセシビリティ（axe）・レスポンシブ', async ({ page }) => {
    await page.goto('/');
    const lib = await new AxeBuilder({ page }).analyze();
    expect(lib.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await openSample(page);
    const ed = await new AxeBuilder({ page }).analyze();
    expect(ed.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(',')}`)).toEqual([]);
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
    const ex = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(ex.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).first().click();
    // 1024〜1279px：右パネルはドロワー
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(page.locator('.ed-right')).toBeHidden();
    await page.getByRole('button', { name: 'プロパティ' }).click();
    await expect(page.locator('.ed-right')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'B-editor-1100-drawer.png') });
    // 1024px未満：編集はPCで
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.getByText('編集はPCで行ってください')).toBeVisible();
    await expect(page.getByRole('heading', { name: '画面の押せる場所を指定' })).toBeHidden();
  });

  test('ライブラリー：検索0件・削除確認・すべて削除', async ({ page }) => {
    await openSample(page);
    await page.getByRole('button', { name: '← 戻る' }).click();
    await page.getByLabel('デモを検索').fill('存在しない名前');
    await expect(page.getByText('一致するデモはありません')).toBeVisible();
    await page.getByRole('button', { name: '検索条件をクリア' }).click();
    await page.getByRole('button', { name: '削除…' }).click();
    await expect(page.getByRole('dialog', { name: 'デモを削除' })).toContainText('新規案件の登録デモ');
    await page.getByRole('button', { name: 'やめる' }).click();
    await page.getByRole('button', { name: 'データとバックアップ' }).click();
    const d = page.getByRole('dialog', { name: 'データとバックアップ' });
    await expect(d.getByRole('button', { name: 'すべて削除する' })).toBeDisabled();
    await d.getByLabel(/すべて削除」と入力/).fill('すべて削除');
    await d.getByRole('button', { name: 'すべて削除する' }).click();
    await expect(d.getByRole('status').last()).toContainText('すべて削除しました');
    await d.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByText('最初の操作デモを作りましょう')).toBeVisible();
  });
});
