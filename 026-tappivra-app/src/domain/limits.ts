// 初版仕様の制限値（01仕様 §04 / §09）。UIと検証で同じ値を共有する。
export const MiB = 1024 * 1024;

export const LIMITS = {
  maxSteps: 30,
  maxHotspotsPerStep: 10,
  maxInputImageBytes: 10 * MiB,
  maxInputImagePixels: 16_000_000,
  maxInputTotalBytes: 80 * MiB,
  maxEncodedLongEdge: 2560,
  maxEncodedTotalBytes: 40 * MiB,
  maxDemoBytes: 25 * MiB,
  warnDemoBytes: 20 * MiB,
  iphoneRecommendedSteps: 10,
  iphoneRecommendedBytes: 10 * MiB,
  maxProjectZipBytes: 50 * MiB,
  minHotspotSize: 0.01,
  undoDepth: 50,
  autosaveDelayMs: 800,
  // ZIP読込
  zipMaxCompressedBytes: 50 * MiB,
  zipMaxUncompressedBytes: 100 * MiB,
  zipMaxEntries: 100,
  zipMaxRatio: 100,
  jsonMaxDepth: 10,
  jsonMaxStringLength: 4000,
} as const;

export const TEXT_LIMITS = {
  projectName: [1, 80],
  projectDescription: [0, 500],
  privateNotes: [0, 2000],
  stepTitle: [1, 60],
  stepDescription: [0, 400],
  altText: [1, 240],
  hotspotLabel: [1, 60],
  hotspotHelp: [0, 180],
  productLabel: [0, 60],
} as const;

export const ACCEPTED_INPUT_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type InputMime = (typeof ACCEPTED_INPUT_MIME)[number];
export type AssetMime = 'image/png' | 'image/jpeg';

export const MESSAGES = {
  unsupported: 'この形式は使えません。PNG・JPEG・静止WebPを選んでください',
  tooLarge: '1枚あたり10MiBまでです。画像を縮小してから追加してください',
  tooManyPixels: '1枚あたり16メガピクセルまでです。画像を縮小してから追加してください',
  totalTooLarge: '一度に取り込める合計は80MiBまでです。枚数を減らしてください',
  decodeFailed: '画像を読み込めませんでした。別の画像を選んでください',
  futureSchema: '新しいバージョンのデータです。対応版をご確認ください',
  notDemo: '閲覧用データではありません。作成者へ閲覧ZIPをご依頼ください',
  storageFull: '端末に保存できません。今回は保存せずに表示できます',
} as const;
