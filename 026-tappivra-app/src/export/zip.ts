import { Inflate, zipSync, strToU8, type Zippable } from 'fflate';
import { LIMITS } from '../domain/limits';

export class ZipSafetyError extends Error {}

export interface ZipLimits {
  maxCompressed: number;
  maxUncompressed: number;
  maxEntries: number;
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxCompressed: LIMITS.zipMaxCompressedBytes,
  maxUncompressed: LIMITS.zipMaxUncompressedBytes,
  maxEntries: LIMITS.zipMaxEntries,
  maxRatio: LIMITS.zipMaxRatio,
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP内パスの安全性検査。違反時は理由、問題なければnull。 */
export function unsafePathReason(name: string): string | null {
  if (name.length === 0 || name.length > 200) return 'パスの長さが不正です';
  if (name.includes('\0')) return 'NUL文字を含むパスです';
  if (name.includes('\\')) return 'バックスラッシュを含むパスです';
  if (name.startsWith('/')) return '絶対パスです';
  if (/^[A-Za-z]:/.test(name)) return 'ドライブ指定を含むパスです';
  const segs = name.split('/');
  if (segs.some((s, i) => s === '..' || s === '.' || (s === '' && i !== segs.length - 1))) return '相対移動（../）を含むパスです';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f:*?"<>|]/.test(name)) return '使えない文字を含むパスです';
  return null;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

interface CentralEntry {
  name: string;
  method: number;
  crc: number;
  compSize: number;
  size: number;
  localOffset: number;
}

/**
 * 制限付きZIP読込。中央ディレクトリを自前で検査し、展開中もサイズ上限を監視する。
 * 返すのはファイル名→内容。ディレクトリエントリは無視する。
 */
export function readZipSafely(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Uint8Array> {
  if (bytes.length > limits.maxCompressed) throw new ZipSafetyError('ZIPファイルが大きすぎます');
  if (bytes.length < 22) throw new ZipSafetyError('ZIPファイルが壊れています');
  // EOCD探索
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipSafetyError('ZIPファイルが壊れています');
  const disk = u16(bytes, eocd + 4);
  const cdDisk = u16(bytes, eocd + 6);
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || count === 0xffff || cdOffset === 0xffffffff) throw new ZipSafetyError('分割ZIP・ZIP64には対応していません');
  if (count > limits.maxEntries) throw new ZipSafetyError(`ZIP内のファイル数が多すぎます（上限${limits.maxEntries}）`);
  if (cdOffset + cdSize > eocd) throw new ZipSafetyError('ZIPファイルが壊れています');

  const entries: CentralEntry[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let p = cdOffset;
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ZipSafetyError('ZIPファイルが壊れています');
    const madeBy = u16(bytes, p + 4);
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const extAttr = u32(bytes, p + 38);
    const localOffset = u32(bytes, p + 42);
    let name: string;
    try {
      name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    } catch {
      throw new ZipSafetyError('ZIP内のファイル名が不正です');
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new ZipSafetyError('暗号化ZIPには対応していません');
    const reason = unsafePathReason(name);
    if (reason) throw new ZipSafetyError(`ZIP内に危険なパスがあります：${reason}`);
    const unixMode = extAttr >>> 16;
    if ((madeBy >> 8) === 3 && (unixMode & 0o170000) === 0o120000) throw new ZipSafetyError('ZIP内にシンボリックリンクがあります');
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new ZipSafetyError('ZIP内に重複したパスがあります');
    seen.add(key);
    if (name.endsWith('/')) {
      if (size !== 0) throw new ZipSafetyError('ZIPファイルが壊れています');
      continue;
    }
    if (method !== 0 && method !== 8) throw new ZipSafetyError('対応していない圧縮方式です');
    if (size === 0xffffffff || compSize === 0xffffffff) throw new ZipSafetyError('ZIP64には対応していません');
    if (size > 0 && (compSize === 0 || size / compSize > limits.maxRatio)) throw new ZipSafetyError('圧縮率が異常なZIPです（展開爆弾の可能性）');
    declaredTotal += size;
    if (declaredTotal > limits.maxUncompressed) throw new ZipSafetyError('展開後の容量が上限を超えます');
    entries.push({ name, method, crc, compSize, size, localOffset });
  }

  const out = new Map<string, Uint8Array>();
  let produced = 0;
  for (const e of entries) {
    const lo = e.localOffset;
    if (lo + 30 > bytes.length || u32(bytes, lo) !== 0x04034b50) throw new ZipSafetyError('ZIPファイルが壊れています');
    const start = lo + 30 + u16(bytes, lo + 26) + u16(bytes, lo + 28);
    const end = start + e.compSize;
    if (end > bytes.length) throw new ZipSafetyError('ZIPファイルが壊れています');
    const comp = bytes.subarray(start, end);
    let data: Uint8Array;
    if (e.method === 0) {
      if (e.compSize !== e.size) throw new ZipSafetyError('ZIPファイルが壊れています');
      data = comp.slice();
    } else {
      data = new Uint8Array(e.size);
      let w = 0;
      const inf = new Inflate((chunk) => {
        if (w + chunk.length > e.size || produced + chunk.length > limits.maxUncompressed) throw new ZipSafetyError('展開後の容量が申告値・上限を超えました');
        data.set(chunk, w);
        w += chunk.length;
        produced += chunk.length;
      });
      try {
        const STEP = 4096; // 1回の展開量を抑える
        for (let i = 0; i < comp.length; i += STEP) inf.push(comp.subarray(i, i + STEP), i + STEP >= comp.length);
        if (comp.length === 0) inf.push(new Uint8Array(0), true);
      } catch (err) {
        if (err instanceof ZipSafetyError) throw err;
        throw new ZipSafetyError('ZIPファイルが壊れています');
      }
      if (w !== e.size) throw new ZipSafetyError('ZIPファイルが壊れています');
    }
    if (crc32(data) !== e.crc) throw new ZipSafetyError('ZIP内のファイルが破損しています（CRC不一致）');
    out.set(e.name, data);
  }
  return out;
}

export function buildZip(files: Record<string, Uint8Array | string>, mtime: Date): Uint8Array {
  const z: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? strToU8(content) : content;
    const already = /\.(png|jpe?g)$/i.test(name);
    z[name] = [data, { level: already ? 0 : 6, mtime }];
  }
  return zipSync(z);
}
