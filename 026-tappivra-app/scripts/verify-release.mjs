// TypeScriptの検査本体をesbuildで束ねて実行する（追加の実行環境不要）。
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const out = path.resolve('evidence/tmp/verify-release.mjs');
mkdirSync(path.dirname(out), { recursive: true });
await build({ entryPoints: ['scripts/verify-release-impl.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', packages: 'bundle' });
await import(pathToFileURL(out).href);
