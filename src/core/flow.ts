// Flow between two states of the same things: where the members of each "from" category ended up
// (players from one rank snapshot to the next, customers from one plan to another, plots from one
// yield class to the next season's). Input is the cell counts of a query grouped by two fields,
// from and to. When both fields have a natural order, a move is up, down, or staying put.

export interface FlowCell { from: string; to: string; n: number }
export interface FlowNode { key: string; order: number; out: number; in: number; stayed: number; up: number; down: number }

export interface FlowSummary {
  nodes: FlowNode[];          // every category on either side, in order (lowest first)
  cells: (FlowCell & { dir: 'up' | 'down' | 'same' | 'changed' })[];
  total: number;
  stayed: number; up: number; down: number; changed: number;
  ordered: boolean;
  /** The category that gained the most members (in − out), and the one that lost the most. */
  gainer?: FlowNode; loser?: FlowNode;
}

export function flowOf(cells: FlowCell[], order: (key: string) => number | null): FlowSummary | null {
  const nodes = new Map<string, FlowNode>();
  const node = (k: string) => { let x = nodes.get(k); if (!x) nodes.set(k, x = { key: k, order: order(k) ?? NaN, out: 0, in: 0, stayed: 0, up: 0, down: 0 }); return x; };
  const live = cells.filter(c => c.n > 0);
  if (!live.length) return null;
  const ordered = live.every(c => Number.isFinite(order(c.from) ?? NaN) && Number.isFinite(order(c.to) ?? NaN));
  let stayed = 0, up = 0, down = 0, changed = 0, total = 0;
  const out = live.map(c => {
    const a = node(c.from), b = node(c.to);
    a.out += c.n; b.in += c.n; total += c.n;
    let dir: 'up' | 'down' | 'same' | 'changed';
    if (c.from === c.to) dir = 'same';
    else if (ordered) dir = a.order < b.order ? 'up' : a.order > b.order ? 'down' : 'same';
    else dir = 'changed';
    if (dir === 'same') { stayed += c.n; a.stayed += c.n; }
    else if (dir === 'up') { up += c.n; a.up += c.n; }
    else if (dir === 'down') { down += c.n; a.down += c.n; }
    else changed += c.n;
    return { ...c, dir };
  });
  const list = [...nodes.values()].sort((x, y) => (Number.isFinite(x.order) ? x.order : Infinity) - (Number.isFinite(y.order) ? y.order : Infinity) || x.key.localeCompare(y.key, undefined, { numeric: true }));
  const net = (x: FlowNode) => x.in - x.out;
  const gainer = list.reduce<FlowNode | undefined>((g, x) => net(x) > 0 && (!g || net(x) > net(g)) ? x : g, undefined);
  const loser = list.reduce<FlowNode | undefined>((g, x) => net(x) < 0 && (!g || net(x) < net(g)) ? x : g, undefined);
  return { nodes: list, cells: out, total, stayed, up, down, changed, ordered, gainer, loser };
}
