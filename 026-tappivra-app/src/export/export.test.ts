import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { buildFiveStepGraph, sha } from '../../tests/helpers/fixtures';
import { MESSAGES } from '../domain/limits';
import { buildDemoHtml } from './html';
import { buildDemoZip, buildProjectZip, parseDemoZip, parseProjectZip } from './packages';
import { safeJsonForScript, slugify, toDemoDocument } from './publicDoc';
import { crc32, readZipSafely, unsafePathReason } from './zip';

const SENTINEL = 'DO_NOT_EXPORT_PRIVATE_NOTE_TAPPIVRA';
const RUNTIME = { js: 'window.__rt=1;', css: '.tv-viewer{color:#000}' };
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** 中央ディレクトリ・ローカルヘッダーを細工できる最小ZIP（stored） */
function rawZip(entries: { name: string; data: Uint8Array; madeBy?: number; extAttr?: number; crc?: number; size?: number; method?: number; compSize?: number }[]) {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const c = e.crc ?? crc32(e.data);
    const lh = new Uint8Array(30 + name.length + e.data.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, e.method ?? 0, true);
    dv.setUint32(14, c, true);
    dv.setUint32(18, e.compSize ?? e.data.length, true);
    dv.setUint32(22, e.size ?? e.data.length, true);
    dv.setUint16(26, name.length, true);
    lh.set(name, 30);
    lh.set(e.data, 30 + name.length);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, e.madeBy ?? 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, e.method ?? 0, true);
    cv.setUint32(16, c, true);
    cv.setUint32(20, e.compSize ?? e.data.length, true);
    cv.setUint32(24, e.size ?? e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, e.extAttr ?? 0, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh);
    centrals.push(ch);
    offset += lh.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, eocd];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('T22 ZIP攻撃', () => {
  const d = strToU8('x');
  it.each([
    ['../evil.txt', '相対移動'],
    ['media/../../evil.txt', '相対移動'],
    ['/etc/passwd', '絶対パス'],
    ['C:/Windows/evil.txt', 'ドライブ'],
    ['media\\evil.txt', 'バックスラッシュ'],
    ['a\0b.txt', 'NUL'],
  ])('%s を拒否', (name, why) => {
    expect(unsafePathReason(name)).toMatch(why);
    expect(() => readZipSafely(rawZip([{ name, data: d }]))).toThrow(/危険なパス/);
  });
  it('重複パス（大文字小文字違い含む）を拒否', () => {
    expect(() => readZipSafely(rawZip([{ name: 'a.txt', data: d }, { name: 'A.txt', data: d }]))).toThrow(/重複/);
  });
  it('シンボリックリンクを拒否', () => {
    expect(() => readZipSafely(rawZip([{ name: 'link', data: strToU8('/etc'), madeBy: 0x0314, extAttr: (0o120777 << 16) >>> 0 }]))).toThrow(/シンボリック/);
  });
  it('エントリー数上限', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.txt`, data: d }));
    expect(() => readZipSafely(rawZip(many))).toThrow(/ファイル数/);
  });
  it('展開爆弾：圧縮比100倍超を拒否', () => {
    const bomb = zipSync({ 'big.txt': new Uint8Array(5_000_000) }, { level: 9 });
    expect(() => readZipSafely(bomb)).toThrow(/圧縮率/);
  });
  it('申告サイズを偽った爆弾は展開中に止める', () => {
    const z = zipSync({ 'big.txt': [new Uint8Array(200_000).fill(7), { level: 9 }] });
    // 中央ディレクトリとローカルヘッダーの展開後サイズを小さく偽る
    const dv = new DataView(z.buffer);
    let cd = -1;
    for (let i = z.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) cd = dv.getUint32(i + 16, true);
    const comp = dv.getUint32(cd + 20, true);
    dv.setUint32(cd + 24, comp * 2, true);
    expect(() => readZipSafely(z)).toThrow(/申告値|上限|壊れて/);
  });
  it('解凍後容量の上限', () => {
    const z = zipSync({ 'a.bin': [crypto.getRandomValues(new Uint8Array(60_000)), { level: 0 }] });
    expect(() => readZipSafely(z, { maxCompressed: 1e9, maxUncompressed: 50_000, maxEntries: 100, maxRatio: 100 })).toThrow(/上限/);
  });
  it('JSON深度超過を拒否', async () => {
    let deep: unknown = 1;
    for (let i = 0; i < 12; i++) deep = { a: deep };
    const z = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'tappivra-demo', schemaVersion: 1, deep })) });
    await expect(parseDemoZip(z)).rejects.toThrow(/階層/);
  });
});

describe('T23 ZIP破損・将来版', () => {
  it('CRC不一致を拒否', () => {
    expect(() => readZipSafely(rawZip([{ name: 'a.txt', data: strToU8('hello'), crc: 1234 }]))).toThrow(/CRC/);
  });
  it('壊れたZIP', async () => {
    await expect(parseDemoZip(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]))).rejects.toThrow(/壊れて/);
  });
  it('schemaVersion=999・必須キー欠損・画像sha不一致・画像不正を拒否', async () => {
    const { graph, images } = buildFiveStepGraph();
    const doc = toDemoDocument(graph, new Date().toISOString());
    const z = (manifest: unknown, media = images) => {
      const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest)) };
      for (const a of doc.assets) files[a.path] = media.get(a.id)!;
      return zipSync(files);
    };
    await expect(parseDemoZip(z({ ...doc, schemaVersion: 999 }))).rejects.toThrow(MESSAGES.futureSchema);
    const { startStepId: _omit, ...missing } = doc;
    void _omit;
    await expect(parseDemoZip(z(missing))).rejects.toThrow(/不正/);
    const tampered = new Map(images);
    const first = doc.assets[0]!.id;
    const flipped = images.get(first)!.slice();
    flipped[flipped.length - 20] = flipped[flipped.length - 20]! ^ 0xff;
    tampered.set(first, flipped);
    await expect(parseDemoZip(z(doc, tampered))).rejects.toThrow(/sha256/);
    const fake = new Map(images);
    const html = strToU8('<html>not an image</html>');
    fake.set(first, html);
    const doc2 = { ...doc, assets: doc.assets.map((a) => (a.id === first ? { ...a, byteLength: html.length, sha256: sha(html) } : a)) };
    await expect(parseDemoZip(z(doc2, fake))).rejects.toThrow(/形式/);
    await expect(parseDemoZip(zipSync({ 'x.txt': strToU8('hi') }))).rejects.toThrow(MESSAGES.notDemo);
  });
});

describe('T18 公開スキーマ／T21 3形式区別', () => {
  it('privateNotesは閲覧ZIP・HTMLに含まれず、編集ZIPにのみ入る', async () => {
    const { graph, images } = buildFiveStepGraph();
    expect(graph.project.privateNotes).toContain(SENTINEL);
    const doc = toDemoDocument(graph, new Date().toISOString());
    expect(JSON.stringify(doc)).not.toContain(SENTINEL);
    expect(Object.keys(doc).sort()).toEqual(['assets', 'format', 'generatedAt', 'id', 'locale', 'productLabel', 'schemaVersion', 'startStepId', 'steps', 'theme', 'title']);
    const demoZip = buildDemoZip(doc, images);
    const files = readZipSafely(demoZip);
    expect([...files.keys()].sort()).toEqual(['HOW_TO_OPEN.txt', 'manifest.json', ...doc.assets.map((a) => a.path)].sort());
    for (const b of files.values()) expect(text(b)).not.toContain(SENTINEL);
    expect(doc.id).not.toBe(graph.project.id);
    expect(JSON.stringify(doc)).not.toContain(graph.project.id);
    const html = await buildDemoHtml(doc, images, RUNTIME);
    expect(html).not.toContain(SENTINEL);
    const projZip = buildProjectZip(graph, images, new Date().toISOString());
    expect(text(readZipSafely(projZip).get('manifest.json')!)).toContain(SENTINEL);
  });
  it('閲覧ZIPは閲覧として開け、編集ZIPは拒否。編集ZIP復元は閲覧ZIPを拒否', async () => {
    const { graph, images } = buildFiveStepGraph();
    const doc = toDemoDocument(graph, new Date().toISOString());
    const parsed = await parseDemoZip(buildDemoZip(doc, images));
    expect(parsed.doc.steps).toHaveLength(5);
    const projZip = buildProjectZip(graph, images, new Date().toISOString());
    await expect(parseDemoZip(projZip)).rejects.toThrow(/編集用バックアップ/);
    await expect(parseProjectZip(buildDemoZip(doc, images))).rejects.toThrow(/閲覧用ZIP/);
  });
});

describe('T24 編集復元', () => {
  it('新UUIDで復元し、ステップ順・hash・リンク・説明が一致', async () => {
    const { graph, images } = buildFiveStepGraph();
    const zip = buildProjectZip(graph, images, new Date().toISOString());
    const r = await parseProjectZip(zip);
    expect(r.graph.project.id).not.toBe(graph.project.id);
    const ids = new Set([graph.project.id, ...Object.keys(graph.steps), ...Object.keys(graph.assets)]);
    for (const id of [r.graph.project.id, ...Object.keys(r.graph.steps), ...Object.keys(r.graph.assets)]) expect(ids.has(id)).toBe(false);
    const norm = (g: typeof graph, map: (id: string) => string) =>
      g.project.stepOrder.map((sid) => {
        const s = g.steps[sid]!;
        return {
          title: s.title,
          description: s.description,
          alt: s.altText,
          hash: g.assets[s.imageAssetId]!.sha256,
          links: s.hotspots.map((h) => [h.label, h.rect, h.targetStepId ? map(h.targetStepId) : null]),
          entry: g.project.entryStepId === sid,
        };
      });
    expect(norm(r.graph, (x) => x)).toEqual(norm(graph, (x) => r.idMap.get(x)!));
    for (const [id, b] of r.images) expect(sha(b)).toBe(r.graph.assets[id]!.sha256);
    expect(r.graph.project.privateNotes).toBe(graph.project.privateNotes);
  });
});

describe('T19 HTML文字列脱出', () => {
  it('</script>・引用符・U+2028/2029をエスケープし、CSPを付ける', async () => {
    const { graph, images } = buildFiveStepGraph();
    const evil = '</script><img src=x onerror=alert(1)>"\'\u2028\u2029&';
    graph.project.name = evil;
    graph.steps[graph.project.stepOrder[0]!]!.title = evil.slice(0, 60);
    const doc = toDemoDocument(graph, new Date().toISOString());
    const html = await buildDemoHtml(doc, images, RUNTIME);
    // scriptタグは2つ（データと固定ランタイム）だけ
    expect(html.match(/<script/gi)).toHaveLength(2);
    expect(html.match(/<\/script>/gi)).toHaveLength(2);
    expect(html).not.toContain('<img src=x');
    const scripts = html.match(/<script[\s\S]*?<\/script>/g)!.join('');
    expect(scripts).not.toMatch(/[\u2028\u2029]/);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).not.toMatch(/https?:\/\//);
    const json = html.match(/<script id="tappivra-data" type="application\/json">([\s\S]*?)<\/script>/)![1]!;
    expect(JSON.parse(json).doc.title).toBe(evil);
    expect(safeJsonForScript('<>&')).toBe('"\\u003c\\u003e\\u0026"');
  });
  it('slug', () => {
    expect(slugify('Sample Demo 01')).toBe('sample-demo-01');
    expect(slugify('新規案件の登録デモ')).toBe('demo');
    expect(slugify('../../etc')).toBe('etc');
  });
});
