// 해답 탐색(정확 덮기), 이동 조건, 최소 이동 수. 순수 함수만 둔다(DOM·저장소 금지).
//
// 해답 = 조각 순서대로 [{id, elem, dx, dy}], 놓인 삼각형 = translate(normalize(applyElem(start, elem)), dx, dy).
// elem은 같은 모양을 내는 원소 묶음(orientations)의 첫 원소다. 대칭 조각이 같은 해답을 여러 번 내지 않는다.
import { normalize, translate, key } from './grid.js';
import { D4, applyElem, orientations, pieceMoves } from './pieces.js';

const k1 = (t) => key([t]);

// 판 삼각형을 정확히 한 번씩 덮는 배치를 limit개까지 찾는다.
// 아직 안 덮인 삼각형 가운데 놓을 수 있는 후보가 가장 적은 것부터 덮는다(가장 덮기 어려운 삼각형부터).
export function solve(board, pieces, { limit = 200 } = {}) {
  const sorted = normalizeOrder(board);
  const index = new Map();
  for (const t of sorted) if (!index.has(k1(t))) index.set(k1(t), index.size);
  const n = index.size;
  const area = pieces.reduce((s, p) => s + new Set(p.start.map(k1)).size, 0);
  if (area !== n || limit <= 0 || pieces.some((p) => p.start.length === 0)) return [];
  if (n === 0) return [[]]; // 빈 판 + 조각 없음(넓이 검사를 통과했으므로)

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of sorted) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }

  // 후보 배치: {piece, elem, dx, dy, cells: 판 삼각형 번호[]}
  const placements = [];
  pieces.forEach((p, pi) => {
    for (const g of orientations(p.start)) {
      let w = 0, h = 0;
      for (const [x, y] of g.tris) {
        if (x > w) w = x;
        if (y > h) h = y;
      }
      for (let dy = y0; dy + h <= y1; dy++) {
        for (let dx = x0; dx + w <= x1; dx++) {
          const cells = [];
          let ok = true;
          for (const t of translate(g.tris, dx, dy)) {
            const i = index.get(k1(t));
            if (i === undefined) { ok = false; break; }
            cells.push(i);
          }
          if (ok) placements.push({ piece: pi, elem: g.elems[0], dx, dy, cells });
        }
      }
    }
  });

  const byCell = Array.from({ length: n }, () => []);
  placements.forEach((pl, i) => { for (const c of pl.cells) byCell[c].push(i); });

  const covered = new Uint8Array(n);
  const used = new Uint8Array(pieces.length);
  const chosen = new Array(pieces.length);
  const out = [];
  const fits = (pl) => !used[pl.piece] && pl.cells.every((c) => !covered[c]);

  (function dfs(left) {
    if (left === 0) {
      out.push(chosen.map((pl, i) => ({ id: pieces[i].id, elem: pl.elem, dx: pl.dx, dy: pl.dy })));
      return;
    }
    let bestOpts = null;
    for (let c = 0; c < n; c++) {
      if (covered[c]) continue;
      const opts = byCell[c].filter((i) => fits(placements[i]));
      if (bestOpts === null || opts.length < bestOpts.length) {
        bestOpts = opts;
        if (opts.length === 0) return;
      }
    }
    for (const i of bestOpts) {
      const pl = placements[i];
      used[pl.piece] = 1;
      for (const c of pl.cells) covered[c] = 1;
      chosen[pl.piece] = pl;
      dfs(left - pl.cells.length);
      used[pl.piece] = 0;
      for (const c of pl.cells) covered[c] = 0;
      if (out.length >= limit) return;
    }
  })(n);

  return out;
}

// 판 순서를 (y, x, q)로 고정해 결과가 입력 순서에 흔들리지 않게 한다.
function normalizeOrder(board) {
  return [...board].sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
}

// 돌리기 없이 만들 수 있는 원소(이동 0번 또는 뒤집기 1번).
const NO_TURN = new Set(['id', 'fx', 'fx_r180']);

// start에서 해답 기록 r의 모양을 내는 모든 D4 원소.
function elemsFor(start, r) {
  const target = key(normalize(applyElem(start, r.elem)));
  return D4.filter((e) => key(normalize(applyElem(start, e))) === target);
}

// 조각마다 {flip, turn}. 모든 저장 해답에서 참일 때만 true(해답이 없으면 false).
// flip = 그 모양을 내는 모든 원소가 반사(fx*), turn = 그 모양을 id·fx·fx_r180으로 만들 수 없음.
export function needs(puzzle) {
  const result = {};
  const sols = puzzle.solutions;
  for (const p of puzzle.pieces) {
    let flip = sols.length > 0;
    let turn = sols.length > 0;
    for (const sol of sols) {
      const r = sol.find((x) => x.id === p.id);
      if (!r) { flip = false; turn = false; break; }
      const E = elemsFor(p.start, r);
      if (!E.every((e) => e.startsWith('fx'))) flip = false;
      if (E.some((e) => NO_TURN.has(e))) turn = false;
    }
    result[p.id] = { flip, turn };
  }
  return result;
}

// 해답마다 조각별 최소 버튼 수(pieceMoves)를 더하고, 그중 가장 작은 값. 해답이 없으면 Infinity.
export function minMovesOf(puzzle) {
  const start = new Map(puzzle.pieces.map((p) => [p.id, p.start]));
  let best = Infinity;
  for (const sol of puzzle.solutions) {
    let sum = 0;
    for (const r of sol) {
      const s = start.get(r.id);
      sum += pieceMoves(s, applyElem(s, r.elem));
    }
    if (sum < best) best = sum;
  }
  return best;
}
