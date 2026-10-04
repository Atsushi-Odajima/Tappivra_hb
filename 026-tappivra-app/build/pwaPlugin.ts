// 閲覧PWAのmanifest・Service Worker・同梱素材を生成するViteプラグイン。
// Service Workerはアプリシェルだけを事前キャッシュする（閲覧データはキャッシュ・送信しない）。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));

export const VIEWER_MANIFEST = {
  name: 'Tappivra Viewer',
  short_name: 'Tappivra',
  description: 'Tappivraで作られた操作デモを端末内で閲覧する（閲覧専用）',
  lang: 'ja',
  display: 'standalone',
  background_color: '#FFFFFF',
  theme_color: '#FFFFFF',
  scope: '/viewer/',
  start_url: '/viewer/',
  icons: [
    { src: '/viewer/brand/pwa_icon_192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/viewer/brand/pwa_icon_512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/viewer/brand/pwa_maskable_512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

const BRAND = ['logo_horizontal.svg', 'favicon_32.png', 'apple_touch_icon.png', 'pwa_icon_192.png', 'pwa_icon_512.png', 'pwa_maskable_512.png'];

export function pwaPlugin(): Plugin {
  return {
    name: 'tappivra-pwa',
    apply: 'build',
    generateBundle(_opts, bundle) {
      for (const f of BRAND) this.emitFile({ type: 'asset', fileName: `brand/${f}`, source: readFileSync(`${root}public/brand/${f}`) });
      const sample = `${root}samples/quickstart.tappivra-demo.zip`;
      if (existsSync(sample)) this.emitFile({ type: 'asset', fileName: 'samples/quickstart.tappivra-demo.zip', source: readFileSync(sample) });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(VIEWER_MANIFEST, null, 2) });
      const shell = ['./', './index.html', './manifest.webmanifest', ...BRAND.map((f) => `./brand/${f}`)];
      for (const name of Object.keys(bundle)) if (/\.(js|css)$/.test(name)) shell.push(`./${name}`);
      if (existsSync(sample)) shell.push('./samples/quickstart.tappivra-demo.zip');
      const version = createHash('sha256').update(JSON.stringify(shell)).update(Object.values(bundle).map((b) => ('code' in b ? b.code : String(b.source))).join('')).digest('hex').slice(0, 12);
      const sw = `// Tappivra Viewer service worker ${version}
const CACHE = 'tappivra-viewer-${version}';
const SHELL = ${JSON.stringify(shell)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('tappivra-viewer-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}
