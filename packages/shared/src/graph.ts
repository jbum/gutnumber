/**
 * Dashboards ↔ playlists reference graph. A dashboard points at the playlists
 * its carousels play; a playlist points at the dashboards among its items.
 * A save that closes a loop is refused (ARCHITECTURE §10, D7).
 */
export type NodeKey = `d:${number}` | `p:${number}`;

export interface GraphInput {
  dashboards: Array<{ id: number; playlistIds: number[] }>;
  playlists: Array<{ id: number; dashboardIds: number[] }>;
}

export function buildGraph(g: GraphInput): Map<NodeKey, NodeKey[]> {
  const m = new Map<NodeKey, NodeKey[]>();
  for (const d of g.dashboards) m.set(`d:${d.id}`, d.playlistIds.map((p) => `p:${p}` as NodeKey));
  for (const p of g.playlists) m.set(`p:${p.id}`, p.dashboardIds.map((d) => `d:${d}` as NodeKey));
  return m;
}

/** Returns the cycle path starting and ending at `start`, or null. */
export function findCycle(graph: Map<NodeKey, NodeKey[]>, start: NodeKey): NodeKey[] | null {
  const path: NodeKey[] = [start];
  const seen = new Set<NodeKey>();
  const dfs = (n: NodeKey): boolean => {
    for (const next of graph.get(n) ?? []) {
      if (next === start) {
        path.push(next);
        return true;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      path.push(next);
      if (dfs(next)) return true;
      path.pop();
    }
    return false;
  };
  return dfs(start) ? path : null;
}
