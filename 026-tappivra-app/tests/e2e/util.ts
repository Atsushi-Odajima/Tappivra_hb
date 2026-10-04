import { expect, type Download, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const EVIDENCE = path.resolve('evidence');
export const TMP = path.join(EVIDENCE, 'tmp');
export const SHOTS = path.join(EVIDENCE, 'screens');
mkdirSync(TMP, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

export const SENTINEL = 'DO_NOT_EXPORT_PRIVATE_NOTE_TAPPIVRA';

export async function openSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルで試す' }).click();
  await expect(page.getByRole('heading', { name: '画面の押せる場所を指定' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('editor-stage').locator('.hs')).toHaveCount(1);
}

export type Kind = 'html' | 'demo-zip' | 'project-zip';
const KIND_LABEL: Record<Kind, RegExp> = { html: /閲覧用HTML/, 'demo-zip': /閲覧用ZIP/, 'project-zip': /編集用バックアップZIP/ };

export async function exportAs(page: Page, kind: Kind, saveAs?: string): Promise<{ file: string; bytes: Buffer; name: string }> {
  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '書き出し前チェック' });
  await expect(dialog).toBeVisible();
  await dialog.locator('label.format', { hasText: KIND_LABEL[kind] }).locator('input').check();
  const [dl] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: kind === 'project-zip' ? 'バックアップを保存' : '書き出して保存' }).click()]);
  await expect(dialog.getByTestId('export-result')).toContainText('保存しました');
  const name = (dl as Download).suggestedFilename();
  const file = saveAs ?? path.join(TMP, name);
  await dl.saveAs(file);
  await dialog.getByRole('button', { name: '閉じる' }).first().click();
  return { file, bytes: readFileSync(file), name };
}
