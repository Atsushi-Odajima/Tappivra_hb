// 共通閲覧ランタイムをIIFE文字列として編集アプリへ取り込むViteプラグイン。
// import { runtimeJs, runtimeCss } from 'virtual:tappivra-viewer-runtime'
import { build, transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const VIRTUAL = 'virtual:tappivra-viewer-runtime';
const RESOLVED = '\0' + VIRTUAL;
const root = fileURLToPath(new URL('..', import.meta.url));

export async function buildRuntimeStrings(): Promise<{ js: string; css: string }> {
  const out = await build({
    entryPoints: [`${root}src/viewer/standalone.ts`],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    target: ['es2019', 'safari14'],
    legalComments: 'none',
    charset: 'utf8',
  });
  const js = out.outputFiles[0]!.text.trim();
  const cssSrc = await readFile(`${root}src/viewer/viewer.css`, 'utf8');
  const css = (await transform(cssSrc, { loader: 'css', minify: true })).code.trim();
  return { js, css };
}

export function viewerRuntimePlugin(): Plugin {
  return {
    name: 'tappivra-viewer-runtime',
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(`${root}src/viewer/runtime.ts`);
      this.addWatchFile(`${root}src/viewer/standalone.ts`);
      this.addWatchFile(`${root}src/viewer/viewer.css`);
      this.addWatchFile(`${root}src/domain/rect.ts`);
      const { js, css } = await buildRuntimeStrings();
      return `export const runtimeJs = ${JSON.stringify(js)};\nexport const runtimeCss = ${JSON.stringify(css)};\n`;
    },
  };
}
