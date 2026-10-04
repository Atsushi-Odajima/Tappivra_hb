import { bytesToBase64 } from '../media/hash';
import type { DemoDocument } from '../domain/types';
import { escapeHtmlText, safeJsonForScript } from './publicDoc';

export async function cspHash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${bytesToBase64(new Uint8Array(buf))}'`;
}

/**
 * 単独HTMLを生成。CSS・IIFEランタイム・加工済み画像data URI・許可リストJSONを全て内包する。
 * 外部CDN・フォント・fetch・解析なし。CSPはランタイムJSとCSSのハッシュのみ許可。
 */
export async function buildDemoHtml(doc: DemoDocument, images: Map<string, Uint8Array>, runtime: { js: string; css: string }): Promise<string> {
  const imageMap: Record<string, string> = {};
  for (const a of doc.assets) {
    const bytes = images.get(a.id);
    if (!bytes) throw new Error(`画像が見つかりません: ${a.id}`);
    imageMap[a.id] = `data:${a.mime};base64,${bytesToBase64(bytes)}`;
  }
  const json = safeJsonForScript({ doc, images: imageMap });
  const scriptHash = await cspHash(runtime.js);
  const css = `html,body{margin:0;background:#fff}${runtime.css}`;
  const styleHash = await cspHash(css);
  const csp = [
    "default-src 'none'",
    `script-src ${scriptHash}`,
    `style-src ${styleHash}`,
    'img-src data: blob:',
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
  // runtime.jsに</script>が含まれないことはビルド時に確認する（verify-release）
  if (/<\/script/i.test(runtime.js) || /<\/style/i.test(runtime.css)) throw new Error('ランタイムに終了タグが含まれています');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="Tappivra">
<title>${escapeHtmlText(doc.title)}</title>
<style>${css}</style>
</head>
<body>
<noscript>このデモを表示するにはJavaScriptを有効にしてください。</noscript>
<div id="tappivra-root"></div>
<script id="tappivra-data" type="application/json">${json}</script>
<script>${runtime.js}</script>
</body>
</html>
`;
}
