// release-docs/THIRD_PARTY_NOTICES.txt を生成する（npm本番依存はライセンス本文、Rustクレートは一覧）。
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8' }));
const seen = new Map();
(function visit(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (!info.version || seen.has(`${name}@${info.version}`)) continue;
    seen.set(`${name}@${info.version}`, name);
    visit(info.dependencies);
  }
})(tree.dependencies);

let out = `Tappivra THIRD PARTY NOTICES\n生成: ${new Date().toISOString()}（scripts/third-party-notices.mjs）\n\n`;
out += `■ 書体\nInter（The Inter Project Authors, SIL Open Font License 1.1）／Noto Sans JP（SIL Open Font License 1.1）\n本製品はフォントファイルを同梱していません。OSにインストールされた書体（Inter・Noto Sans JP・Yu Gothic UI・Meiryo等）を表示に使用します。\nロゴのワードマークはInter SemiBoldのアウトライン化図形です（納品資料 assets/typeface_license_notices.txt 参照）。\n\n`;
out += `■ npm（エディター・閲覧ランタイム・PWAに含まれるもの）\n`;
for (const [key, name] of [...seen.entries()].sort()) {
  const dir = path.join('node_modules', name);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  out += `\n------------------------------------------------------------\n${key}  (${pkg.license ?? 'UNKNOWN'})\n`;
  if (lic) out += readFileSync(path.join(dir, lic), 'utf8').trim() + '\n';
}
out += `\n\n■ Rustクレート（Windows本体に静的リンク。名称・版・ライセンス表記）\n`;
if (existsSync('src-tauri/Cargo.lock')) {
  try {
    const meta = JSON.parse(execSync('cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml --filter-platform x86_64-pc-windows-msvc', { encoding: 'utf8', maxBuffer: 1 << 28 }));
    const pkgs = meta.packages.filter((p) => p.name !== 'tappivra').map((p) => `${p.name} ${p.version}  ${p.license ?? p.license_file ?? 'UNKNOWN'}`).sort();
    out += pkgs.join('\n') + '\n';
    out += `\n（${pkgs.length}クレート。各ライセンス本文の同梱は販売前に cargo-about 等で生成・確認すること）\n`;
    out += `SQLite（rusqlite bundled）: Public Domain\n`;
  } catch (e) {
    out += `cargo metadata を取得できませんでした: ${e.message}\n`;
  }
}
writeFileSync('release-docs/THIRD_PARTY_NOTICES.txt', out);
console.log(`release-docs/THIRD_PARTY_NOTICES.txt: ${seen.size} npm packages`);
