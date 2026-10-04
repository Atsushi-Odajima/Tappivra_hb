// npm run verify:release の本体（scripts/verify-release.mjsがesbuildで束ねて実行）。
// ファイル名・manifest・ライセンス・サンプル・出力通信・素材使用を検査する。
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseDemoZip, parseProjectZip } from '../src/export/packages';
import { readZipSafely } from '../src/export/zip';
import { LIMITS } from '../src/domain/limits';

const root = process.cwd();
const strict = process.argv.includes('--strict');
type Row = { id: string; ok: boolean | 'gate'; detail: string };
const rows: Row[] = [];
const check = (id: string, ok: boolean, detail: string) => rows.push({ id, ok, detail });
const gate = (id: string, detail: string) => rows.push({ id, ok: 'gate', detail });
const read = (p: string) => readFileSync(path.join(root, p));
const exists = (p: string) => existsSync(path.join(root, p));
const SENTINEL = 'DO_NOT_EXPORT_PRIVATE_NOTE_TAPPIVRA';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const pkg = JSON.parse(read('package.json').toString());
  // 1. scripts
  const required = ['dev', 'tauri', 'typecheck', 'lint', 'test', 'test:e2e', 'build:viewer', 'build', 'verify:release', 'package:release'];
  check('scripts', required.every((s) => pkg.scripts?.[s]), `package.json scripts: ${required.filter((s) => !pkg.scripts?.[s]).join(',') || 'all present'}`);
  check('lockfiles', exists('package-lock.json') && exists('src-tauri/Cargo.lock'), 'package-lock.json / src-tauri/Cargo.lock');
  const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => /[\^~*]|latest/.test(String(v)));
  check('pinned-deps', loose.length === 0, loose.length ? `not pinned: ${loose.map(([k]) => k).join(',')}` : 'all npm deps pinned exactly');

  // 2. ブランド素材の実使用
  const brand = ['logo_horizontal.png', 'logo_horizontal.svg', 'logo_horizontal_dark.png', 'logo_mark.png', 'logo_mark.svg', 'pwa_icon_192.png', 'pwa_icon_512.png', 'pwa_maskable_512.png', 'apple_touch_icon.png', 'favicon_32.png'];
  const brief = path.join(root, '../briefs/026_Tappivra/assets');
  for (const b of brand) {
    const here = path.join(root, 'public/brand', b);
    const same = existsSync(brief) && existsSync(here) ? createHash('sha256').update(readFileSync(here)).digest('hex') === createHash('sha256').update(readFileSync(path.join(brief, b))).digest('hex') : existsSync(here);
    check(`brand:${b}`, same, existsSync(brief) ? 'public/brand と納品素材が同一bytes' : 'public/brand に存在（納品フォルダ未検出）');
  }
  const src = walk(path.join(root, 'src')).filter((f) => /\.(tsx?|html|css)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  const used = ['logo_horizontal.svg', 'favicon_32.png', 'apple_touch_icon.png'].filter((b) => src.includes(b));
  const pwaPlugin = read('build/pwaPlugin.ts').toString();
  const pwaUsed = ['pwa_icon_192.png', 'pwa_icon_512.png', 'pwa_maskable_512.png'].filter((b) => pwaPlugin.includes(b));
  check('brand-used', used.length === 3 && pwaUsed.length === 3, `UI参照: ${used.join(',')} / PWA manifest: ${pwaUsed.join(',')}`);
  const tauriIcon = exists('src-tauri/icons/icon.ico');
  check('tauri-icons', tauriIcon, 'src-tauri/icons（pwa_icon_512.pngから tauri icon で生成）');
  if (existsSync(brief)) {
    const a = createHash('sha256').update(readFileSync(path.join(brief, 'pwa_icon_512.png'))).digest('hex');
    const m = createHash('sha256').update(readFileSync(path.join(brief, 'pwa_maskable_512.png'))).digest('hex');
    if (a === m) gate('asset:maskable', '納品素材 pwa_maskable_512.png と pwa_icon_512.png が同一bytes。maskable専用の余白設計か販売者が目視確認すること');
  }

  // 3. サンプル（アプリの実処理で生成されたもの）
  const sHtml = 'samples/quickstart.html';
  const sDemo = 'samples/quickstart.tappivra-demo.zip';
  const sProj = 'samples/quickstart.tappivra-project.zip';
  check('samples-exist', exists(sHtml) && exists(sDemo) && exists(sProj), 'samples/quickstart.{html,tappivra-demo.zip,tappivra-project.zip}');
  if (exists(sHtml)) {
    const h = read(sHtml).toString('utf8');
    check('html:no-private-notes', !h.includes(SENTINEL), 'quickstart.html に内部メモの識別文字列なし');
    check('html:no-network', !/https?:\/\//.test(h) && !/\bfetch\(|XMLHttpRequest|type="module"|import\(/.test(h), 'quickstart.html に外部URL・fetch・module import なし');
    check('html:csp', /connect-src 'none'/.test(h) && /object-src 'none'/.test(h) && /base-uri 'none'/.test(h) && /script-src 'sha256-/.test(h), 'CSP（hash・connect-src none等）');
    check('html:scripts', (h.match(/<script/g) ?? []).length === 2, '<script>はデータ1つ＋固定ランタイム1つのみ');
    check('html:size', read(sHtml).length <= LIMITS.maxDemoBytes, `${read(sHtml).length} bytes <= 25MiB`);
  }
  if (exists(sDemo)) {
    try {
      const d = await parseDemoZip(new Uint8Array(read(sDemo)));
      const files = readZipSafely(new Uint8Array(read(sDemo)));
      const leak = [...files.values()].some((b) => Buffer.from(b).toString('utf8').includes(SENTINEL));
      check('demo-zip:valid', true, `${d.doc.steps.length} steps, ${d.doc.assets.length} images, sha256一致`);
      check('demo-zip:no-private-notes', !leak, '閲覧ZIPに内部メモなし');
      check('demo-zip:entries', [...files.keys()].every((k) => k === 'manifest.json' || k === 'HOW_TO_OPEN.txt' || /^media\/[0-9a-f-]{36}\.(png|jpg)$/.test(k)), [...files.keys()].join(','));
    } catch (e) {
      check('demo-zip:valid', false, String(e));
    }
  }
  if (exists(sProj)) {
    try {
      const r = await parseProjectZip(new Uint8Array(read(sProj)));
      check('project-zip:valid', true, `${r.graph.project.stepOrder.length} steps（復元時は新UUID）`);
      await parseDemoZip(new Uint8Array(read(sProj))).then(
        () => check('project-zip:rejected-by-viewer', false, '閲覧PWAが編集ZIPを受け付けた'),
        () => check('project-zip:rejected-by-viewer', true, '閲覧PWA形式としては拒否される'),
      );
    } catch (e) {
      check('project-zip:valid', false, String(e));
    }
  }

  // 4. ビルド成果物の通信検査
  const editorJs = walk(path.join(root, 'dist')).filter((f) => f.endsWith('.js'));
  const viewerJs = walk(path.join(root, 'dist-viewer')).filter((f) => f.endsWith('.js'));
  check('build:editor', editorJs.length > 0, 'dist/（npm run build）');
  check('build:viewer', viewerJs.length > 0 && exists('dist-viewer/viewer/manifest.webmanifest') && exists('dist-viewer/viewer/sw.js'), 'dist-viewer/viewer（npm run build:viewer）');
  const urlRe = /https?:\/\/[a-z0-9.-]+/gi;
  // 通信先ではなく識別子・エラーメッセージ内の文字列（XML名前空間、React/zodのドキュメントURL、JSON Schemaの$schema識別子）
  const allowedHosts = /^(https?:\/\/)(www\.w3\.org|reactjs\.org|react\.dev|github\.com|zod\.dev|json-schema\.org|tauri\.app|v2\.tauri\.app)$/i;
  for (const f of [...editorJs, ...viewerJs]) {
    const t = readFileSync(f, 'utf8');
    const hosts = [...new Set(t.match(urlRe) ?? [])].filter((u) => !allowedHosts.test(u));
    const net = /\bnew WebSocket\(|navigator\.sendBeacon|google-analytics|googletagmanager|sentry/i.test(t);
    check(`network:${path.relative(root, f)}`, hosts.length === 0 && !net, hosts.length ? `unexpected URL literals: ${hosts.join(',')}` : 'no analytics/telemetry/external URLs (docs/namespace URLs only)');
  }
  if (exists('dist-viewer/viewer/manifest.webmanifest')) {
    const m = JSON.parse(read('dist-viewer/viewer/manifest.webmanifest').toString());
    check('pwa:manifest', m.name === 'Tappivra Viewer' && m.short_name === 'Tappivra' && m.display === 'standalone' && m.scope === '/viewer/' && m.start_url === '/viewer/' && m.background_color === '#FFFFFF' && m.theme_color === '#FFFFFF', JSON.stringify({ name: m.name, scope: m.scope, start_url: m.start_url }));
  }
  if (exists('dist-viewer/viewer/sw.js')) {
    const sw = read('dist-viewer/viewer/sw.js').toString();
    check('pwa:sw-shell-only', !/\.tappivra-demo\.zip'(?!.*quickstart)/.test(sw) && sw.includes("req.method !== 'GET'"), 'SWはGETのアプリシェルのみキャッシュ（サンプル以外の閲覧データは対象外）');
  }

  // 5. ライセンス・説明書
  const docs = ['はじめに.txt', '使い方.txt', 'スマホで見る.txt', 'バックアップと削除.txt', '対応環境と制限.txt', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'VERSION.txt', '静的ビューアー配信手順.txt'];
  for (const d of docs) check(`doc:${d}`, exists(`release-docs/${d}`), `release-docs/${d}`);
  if (exists('release-docs/THIRD_PARTY_NOTICES.txt')) {
    const n = read('release-docs/THIRD_PARTY_NOTICES.txt').toString();
    const deps = Object.keys(pkg.dependencies ?? {});
    check('notices:npm', deps.every((d) => n.includes(d)), `本番依存: ${deps.join(',')}`);
    check('notices:fonts', n.includes('Inter') && n.includes('Noto Sans'), '書体の扱い（同梱なし・OSフォント）');
  }
  check('no-font-files', walk(path.join(root, 'public')).concat(walk(path.join(root, 'dist'))).every((f) => !/\.(otf|ttf|ttc|woff2?)$/i.test(f)), 'フォントファイルを同梱していない');
  check('test-report', exists('TEST_REPORT.txt'), 'TEST_REPORT.txt');

  // 6. 人間確認ゲート（販売前）
  const exe = walk(path.join(root, 'src-tauri/target/release/bundle/nsis')).filter((f) => f.endsWith('.exe'));
  if (exe.length === 0) gate('installer', 'NSISインストーラー未生成（Windows 11 x64で npm run tauri build -- --bundles nsis が必要）');
  gate('code-signing', 'コード署名なし（未署名テスト版。SmartScreen警告の可能性。署名方針は販売者判断）');
  gate('pwa-url', '閲覧PWAの公開URL未設定・未配備（iPhone正式導線は未完了）');
  gate('device-tests', 'Windows 11実機・iPhone/Android実機試験 未実施（TEST_REPORT.txt参照）');
  gate('trademark', '商標・名称の法的確認 未実施');
  gate('license-legal', '利用許諾文（LICENSE.txt）は案。販売者の法的確認が必要');

  const width = Math.max(...rows.map((r) => r.id.length));
  let fail = 0;
  for (const r of rows) {
    const tag = r.ok === 'gate' ? 'GATE' : r.ok ? 'PASS' : 'FAIL';
    if (r.ok === false) fail++;
    console.log(`${tag}  ${r.id.padEnd(width)}  ${r.detail}`);
  }
  const gates = rows.filter((r) => r.ok === 'gate').length;
  console.log(`\n${rows.length - gates - fail} PASS / ${fail} FAIL / ${gates} 人間確認ゲート`);
  if (gates) console.log('販売可能判定：未（上記GATEが残っています）');
  process.exit(fail > 0 || (strict && gates > 0) ? 1 : 0);
}

void main();
