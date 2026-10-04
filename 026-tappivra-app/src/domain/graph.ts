import type { UUID } from './types';

/** 有向グラフ：stepId → 遷移先stepId[]（未設定null・存在しないIDは呼び出し側で別に扱う） */
export type Adjacency = Map<UUID, UUID[]>;

export interface GraphReport {
  selfLoops: UUID[];
  /** 循環に含まれるステップ（自己ループ以外） */
  cycles: UUID[][];
  unreachable: UUID[];
  /** finishに到達できないステップ */
  deadEnds: UUID[];
}

export function analyzeGraph(nodes: UUID[], adj: Adjacency, start: UUID | null, finishes: Set<UUID>): GraphReport {
  const nodeSet = new Set(nodes);
  const selfLoops: UUID[] = [];
  for (const n of nodes) if ((adj.get(n) ?? []).includes(n)) selfLoops.push(n);

  // 循環検出（反復DFS、白灰黒）
  const color = new Map<UUID, 0 | 1 | 2>();
  const cycles: UUID[][] = [];
  const seenCycleKeys = new Set<string>();
  for (const root of nodes) {
    if (color.get(root)) continue;
    const stack: { node: UUID; i: number }[] = [{ node: root, i: 0 }];
    const path: UUID[] = [root];
    color.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const nexts = (adj.get(top.node) ?? []).filter((t) => nodeSet.has(t) && t !== top.node);
      if (top.i < nexts.length) {
        const next = nexts[top.i++]!;
        const c = color.get(next) ?? 0;
        if (c === 1) {
          const cyc = path.slice(path.indexOf(next));
          const key = [...cyc].sort().join(',');
          if (!seenCycleKeys.has(key)) {
            seenCycleKeys.add(key);
            cycles.push(cyc);
          }
        } else if (c === 0) {
          color.set(next, 1);
          stack.push({ node: next, i: 0 });
          path.push(next);
        }
      } else {
        color.set(top.node, 2);
        stack.pop();
        path.pop();
      }
    }
  }

  // 到達可能性（BFS）
  const reach = new Set<UUID>();
  if (start && nodeSet.has(start)) {
    const q = [start];
    reach.add(start);
    while (q.length) {
      const n = q.shift()!;
      for (const t of adj.get(n) ?? []) {
        if (nodeSet.has(t) && !reach.has(t)) {
          reach.add(t);
          q.push(t);
        }
      }
    }
  }
  const unreachable = nodes.filter((n) => !reach.has(n));

  // finishへの到達（逆グラフBFS）
  const rev = new Map<UUID, UUID[]>();
  for (const [from, tos] of adj) for (const t of tos) if (nodeSet.has(t)) rev.set(t, [...(rev.get(t) ?? []), from]);
  const canFinish = new Set<UUID>();
  const q2 = [...finishes].filter((f) => nodeSet.has(f));
  q2.forEach((f) => canFinish.add(f));
  while (q2.length) {
    const n = q2.shift()!;
    for (const p of rev.get(n) ?? []) {
      if (!canFinish.has(p)) {
        canFinish.add(p);
        q2.push(p);
      }
    }
  }
  const deadEnds = nodes.filter((n) => !canFinish.has(n));
  return { selfLoops, cycles, unreachable, deadEnds };
}

/** from→to のリンクを追加すると循環（自己リンク含む）になるか */
export function wouldCreateCycle(adj: Adjacency, from: UUID, to: UUID): boolean {
  if (from === to) return true;
  const seen = new Set<UUID>([to]);
  const q = [to];
  while (q.length) {
    const n = q.shift()!;
    for (const t of adj.get(n) ?? []) {
      if (t === from) return true;
      if (!seen.has(t)) {
        seen.add(t);
        q.push(t);
      }
    }
  }
  return false;
}
