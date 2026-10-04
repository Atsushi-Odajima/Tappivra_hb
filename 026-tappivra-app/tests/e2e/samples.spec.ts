// 架空サンプル資料をアプリの実処理（取り込み→公開変換→書き出し）に通し、
// 販売用 samples/quickstart.* を生成する（npm run samples）。
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { exportAs, openSample, SHOTS } from './util';

const OUT = path.resolve('samples');

test('サンプル資料からquickstart 3形式を生成', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: path.join(SHOTS, 'A-library-empty.png') });
  await openSample(page);
  await page.screenshot({ path: path.join(SHOTS, 'B-editor-sample.png') });
  await exportAs(page, 'html', path.join(OUT, 'quickstart.html'));
  await exportAs(page, 'demo-zip', path.join(OUT, 'quickstart.tappivra-demo.zip'));
  await exportAs(page, 'project-zip', path.join(OUT, 'quickstart.tappivra-project.zip'));
  await expect(page.getByTestId('save-status')).toHaveText('保存済み', { timeout: 5000 });
});
