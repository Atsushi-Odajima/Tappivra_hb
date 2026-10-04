const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newId(): string {
  return crypto.randomUUID();
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 数値を小数6桁へ正規化（NaN/Infinityは呼び出し側で拒否済みであること） */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
