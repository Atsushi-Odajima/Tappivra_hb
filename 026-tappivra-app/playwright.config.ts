import { defineConfig, devices } from '@playwright/test';

// Web開発シェル（mock保存）と閲覧PWA（静的ビルド）をChromiumで検証する。
// WebKit/Firefox/Edge・実機・Windowsネイティブ保存は別途（TEST_REPORT.txtに未実施として記録）。
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'evidence/playwright-results.json' }]],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', locale: 'ja-JP', acceptDownloads: true },
  projects: [
    { name: 'samples', testMatch: /samples\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'editor-chromium', testMatch: /editor\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'viewer-chromium', testMatch: /viewer\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'pwa-mobile-emulation', testMatch: /pwa\.spec\.ts/, use: { ...devices['Pixel 7'], baseURL: 'http://localhost:5174' } },
  ],
  webServer: [
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 120_000 },
    {
      command: 'npm run build:viewer && npx vite preview --config vite.viewer.config.ts --port 5174 --strictPort',
      url: 'http://localhost:5174/viewer/',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
