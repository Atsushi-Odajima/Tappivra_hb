// release/ 配下へ販売用ファイル一式とZIPを作る。公開・出品は行わない。
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const v = pkg.version;
const R = 'release';
rmSync(R, { recursive: true, force: true });
mkdirSync(path.join(R, 'samples'), { recursive: true });

const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)])) : []);
const missing = [];

// 1. インストーラー（Windowsでビルドした場合のみ存在）
const exe = walk('src-tauri/target/release/bundle/nsis').find((f) => f.endsWith('.exe'));
if (exe) copyFileSync(exe, path.join(R, `Tappivra_Setup_${v}_x64.exe`));
else missing.push(`Tappivra_Setup_${v}_x64.exe（Windows 11 x64で npm run tauri build -- --bundles nsis が必要）`);

// 2. 静的ビューアー
if (!existsSync('dist-viewer/viewer/index.html')) execSync('npm run build:viewer', { stdio: 'inherit' });
const files = {};
for (const f of walk('dist-viewer/viewer')) files[path.relative('dist-viewer', f).split(path.sep).join('/')] = readFileSync(f);
writeFileSync(path.join(R, `Tappivra_Viewer_static_${v}.zip`), zipSync(files));

// 3. サンプル（アプリの実処理で生成済みのもの）
for (const s of ['quickstart.tappivra-project.zip', 'quickstart.tappivra-demo.zip', 'quickstart.html']) {
  if (existsSync(`samples/${s}`)) copyFileSync(`samples/${s}`, path.join(R, 'samples', s));
  else missing.push(`samples/${s}（npm run samples）`);
}

// 4. 説明書・ライセンス・試験報告
for (const d of readdirSync('release-docs')) copyFileSync(path.join('release-docs', d), path.join(R, d));
if (existsSync('TEST_REPORT.txt')) copyFileSync('TEST_REPORT.txt', path.join(R, 'TEST_REPORT.txt'));
else missing.push('TEST_REPORT.txt');
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}
writeFileSync(
  path.join(R, 'VERSION.txt'),
  `Tappivra ${v}（販売前・開発版）\nbuild: ${new Date().toISOString()}\ncommit: ${commit}\nnode: ${process.version}\n署名: なし（未署名）\n` +
    (missing.length ? `\n未同梱:\n${missing.map((m) => `・${m}`).join('\n')}\n` : ''),
);

// 5. checksums
const all = walk(R).filter((f) => !f.endsWith('checksums.sha256'));
writeFileSync(
  path.join(R, 'checksums.sha256'),
  all.map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${path.relative(R, f).split(path.sep).join('/')}`).join('\n') + '\n',
);

// 6. 販売用ZIP
const z = {};
for (const f of walk(R)) z[`Tappivra_${v}/${path.relative(R, f).split(path.sep).join('/')}`] = readFileSync(f);
writeFileSync(path.join(R, `Tappivra_${v}_sales.zip`), zipSync(z));
console.log(`release/ を作成しました（${all.length}ファイル）`);
if (missing.length) {
  console.log('未同梱（販売不可）:');
  for (const m of missing) console.log(`  - ${m}`);
}
