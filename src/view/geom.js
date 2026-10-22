// 격자 → 무대 px 변환과 무대 기하. 순수 함수만 둔다(DOM 없음 — 단위 시험에서 그대로 쓴다).
//
// 무대: 가로 16:10, CSS 배경 assets/img/board-bg.webp(1672x941)를 cover·가운데로 깐다.
// 그림에 그려진 금테 판(안쪽 나무 면) 한가운데에 퍼즐 격자를 맞춘다. 칸 (x, y)의 왼쪽 위 = (ox + x*S, oy + y*S).
// 판 밖(트레이) 칸도 같은 격자다(음수 칸 가능). 사분 삼각형 q: 0=위 1=오른쪽 2=아래 3=왼쪽.

// 그림 속 판의 픽셀 사각형(그림 px, 2026-10-22 픽셀 측정). inner = 나무 면, outer = 금테·바깥 그림자까지.
import { placeStarts } from '../core/layout.js';

export const ART = {
  w: 1672,
  h: 941,
  inner: { l: 433, t: 214, r: 1240, b: 701 },
  outer: { l: 419, t: 200, r: 1254, b: 715 },
};
export const ASPECT = 16 / 10;
const FILL = 0.9; // 격자가 나무 면을 차지하는 최대 비율
const S_NOM = 0.085; // 가장 큰 칸 크기(무대 높이 비율). 격자가 크거나 트레이가 모자라면 작아진다
const S_MIN = 0.06875; // 가장 작은 칸 크기(무대 높이 비율): 1024x640에서 44px
const EDGE = 4; // 트레이 칸이 무대 가장자리에서 떨어지는 px
const KEEP_PAD = 3; // 판·UI 둘레 여유 px

// 화면(뷰포트) 안에 들어가는 가장 큰 16:10 무대.
export function stageSize(vw, vh) {
  let W = vw;
  let H = Math.round(vw / ASPECT);
  if (H > vh) {
    H = vh;
    W = Math.round(vh * ASPECT);
  }
  return { W, H };
}

// CSS background-size:cover, background-position:center 로 깐 그림 속 판 사각형(무대 px).
export function artRects(W, H) {
  const s = Math.max(W / ART.w, H / ART.h);
  const dx = (W - ART.w * s) / 2;
  const dy = (H - ART.h * s) / 2;
  const map = (r) => ({ l: r.l * s + dx, t: r.t * s + dy, r: r.r * s + dx, b: r.b * s + dy });
  return { scale: s, inner: map(ART.inner), outer: map(ART.outer) };
}

// 판 삼각형의 칸 범위(최소는 0이라고 가정하지 않고 최대+1을 쓴다: 문제 은행의 판은 0에서 시작).
export function boardDims(board) {
  let cols = 0;
  let rows = 0;
  for (const [x, y] of board) {
    if (x + 1 > cols) cols = x + 1;
    if (y + 1 > rows) rows = y + 1;
  }
  return { cols, rows };
}

// 격자가 그림 속 판 나무 면에 들어가는 가장 큰 칸 크기(기본 크기 H*S_NOM 이하, 정수 px).
export function maxCell(W, H, cols, rows) {
  const art = artRects(W, H);
  const iw = art.inner.r - art.inner.l;
  const ih = art.inner.b - art.inner.t;
  return Math.max(8, Math.floor(Math.min(H * S_NOM, (iw * FILL) / cols, (ih * FILL) / rows)));
}

// 칸 크기 S(px, 정수)와 격자 원점(ox, oy). 격자는 그림 속 판 나무 면 가운데, 그 면을 넘지 않는다.
// S를 주면 그 크기를 쓴다(maxCell 이하여야 판 밖으로 넘치지 않는다).
export function fitStage(W, H, cols, rows, S = maxCell(W, H, cols, rows)) {
  const art = artRects(W, H);
  const ox = Math.round((art.inner.l + art.inner.r) / 2 - (cols * S) / 2);
  const oy = Math.round((art.inner.t + art.inner.b) / 2 - (rows * S) / 2);
  return { S, ox, oy, W, H, cols, rows, inner: art.inner, outer: art.outer };
}

// 문제 하나를 무대에 맞춘다: 칸 크기(maxCell 이하, 최소 H*S_MIN = 1024x640에서 44px)·트레이 경계·시작 자리.
// ui = 화면 UI 사각형(무대 px, 기본 hudRects). -> {g, bounds, starts}
export function fitPuzzle(W, H, puzzle, ui = hudRects(W, H)) {
  const { cols, rows } = boardDims(puzzle.board);
  const hi = maxCell(W, H, cols, rows);
  const lo = Math.min(hi, Math.ceil(H * S_MIN));
  // 조각마다 긴 변의 정사각형 자리를 한 칸씩 띄어 잡을 수 있는 가장 큰 크기(placeStarts requireGap) — 트레이에서
  // 어느 쪽으로 돌려도 제자리에서 돈다. 그런 크기가 없으면 트레이가 가장 넓은 가장 작은 크기(lo)부터 물러선다.
  for (let S = hi; S >= lo; S--) {
    const g = fitStage(W, H, cols, rows, S);
    const bounds = trayBounds(g, ui);
    const starts = placeStarts(puzzle, bounds, { requireGap: true });
    if (starts) return { g, bounds, starts };
  }
  for (let S = lo; S >= 16; S--) {
    const g = fitStage(W, H, cols, rows, S);
    const bounds = trayBounds(g, ui);
    try {
      return { g, bounds, starts: placeStarts(puzzle, bounds) };
    } catch {
      // 더 작게
    }
  }
  throw new Error(`fitPuzzle: no tray room for ${puzzle.id} at ${W}x${H}`);
}

// 사분 삼각형의 꼭짓점 3개(무대 px), 화면에서 시계 방향 순서: 바깥 변 두 끝(A, B) + 칸 가운데.
export function triPolygon([x, y, q], g) {
  const l = g.ox + x * g.S;
  const t = g.oy + y * g.S;
  const r = l + g.S;
  const b = t + g.S;
  const c = [l + g.S / 2, t + g.S / 2];
  if (q === 0) return [[l, t], [r, t], c];
  if (q === 1) return [[r, t], [r, b], c];
  if (q === 2) return [[r, b], [l, b], c];
  return [[l, b], [l, t], c];
}

export function triCentroid(tri, g) {
  const p = triPolygon(tri, g);
  return [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3];
}

export function screenToCell(px, py, g) {
  return [Math.floor((px - g.ox) / g.S), Math.floor((py - g.oy) / g.S)];
}

// 점이 든 사분 삼각형. 칸 가운데 기준 |u|>|v|면 오른쪽·왼쪽, 아니면 위·아래.
export function screenToTri(px, py, g) {
  const [x, y] = screenToCell(px, py, g);
  const u = (px - g.ox) / g.S - x - 0.5;
  const v = (py - g.oy) / g.S - y - 0.5;
  const q = Math.abs(u) > Math.abs(v) ? (u > 0 ? 1 : 3) : (v > 0 ? 2 : 0);
  return [x, y, q];
}

// 화면 UI(HUD·단서 카드·도구 막대)가 들어갈 자리(무대 px). Task 7은 화면 UI를 이 안에 두거나,
// 실제 UI 사각형을 trayBounds·placePanel에 넘긴다. 큐브 왕국 게임 화면 배치를 16:10 비율로 옮긴 것.
const HUD_ZONES = [
  { name: 'chip', l: 0.015, t: 0.02, r: 0.21, b: 0.19 }, // 화면 칩·섬 배지(왼쪽 위)
  { name: 'mission', l: 0.27, t: 0.02, r: 0.73, b: 0.1 }, // 단계 이름·미션(위 가운데)
  { name: 'score', l: 0.87, t: 0.02, r: 0.985, b: 0.095 }, // 점수(오른쪽 위)
  { name: 'clue', l: 0.8, t: 0.115, r: 0.985, b: 0.44 }, // 단서 카드(오른쪽)
  { name: 'tools', l: 0.71, t: 0.885, r: 0.985, b: 0.975 }, // 도구 막대(오른쪽 아래)
];
export function hudRects(W, H) {
  return HUD_ZONES.map((z) => ({ name: z.name, l: z.l * W, t: z.t * H, r: z.r * W, b: z.b * H }));
}

// px 사각형과 겹치는 칸 범위(끝 포함). 가장자리만 닿는 칸은 넣지 않는다.
function cellRange(rect, g, pad = 0) {
  return {
    x0: Math.floor((rect.l - pad - g.ox) / g.S),
    y0: Math.floor((rect.t - pad - g.oy) / g.S),
    x1: Math.ceil((rect.r + pad - g.ox) / g.S) - 1,
    y1: Math.ceil((rect.b + pad - g.oy) / g.S) - 1,
  };
}

// 트레이 경계(칸 단위, 끝 포함): 무대 안 칸 전체에서 그림 속 판(board:true)과 UI 칸(avoid)을 뺀다.
export function trayBounds(g, avoid = []) {
  return {
    minX: Math.ceil((EDGE - g.ox) / g.S),
    minY: Math.ceil((EDGE - g.oy) / g.S),
    maxX: Math.floor((g.W - EDGE - g.ox) / g.S) - 1,
    maxY: Math.floor((g.H - EDGE - g.oy) / g.S) - 1,
    keep: [
      { ...cellRange(g.outer, g, KEEP_PAD), board: true },
      ...avoid.map((r) => cellRange(r, g, KEEP_PAD)),
    ],
  };
}

const cellsSeen = (tris) => {
  const seen = new Map();
  for (const [x, y] of tris) seen.set(`${x},${y}`, [x, y]);
  return [...seen.values()];
};

// 조각이 걸친 칸마다 화면 사각형 {i, l, t, r, b}(무대 px). 패널 자리 고르기에 쓴다.
export function cellBoxes(tris, pos, g, i) {
  return cellsSeen(tris).map(([x, y]) => {
    const l = g.ox + (x + pos[0]) * g.S;
    const t = g.oy + (y + pos[1]) * g.S;
    return { i, l, t, r: l + g.S, b: t + g.S };
  });
}

// 조각 전체 사각형(무대 px).
export function pieceRect(tris, pos, g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of tris) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return {
    l: g.ox + (x0 + pos[0]) * g.S,
    t: g.oy + (y0 + pos[1]) * g.S,
    r: g.ox + (x1 + 1 + pos[0]) * g.S,
    b: g.oy + (y1 + 1 + pos[1]) * g.S,
  };
}

// 사분 삼각형 꼭짓점(반 칸 단위 정수): 칸 모서리 (2x, 2y), 칸 가운데 (2x+1, 2y+1). 시계 방향.
function halfVerts([x, y, q]) {
  const l = 2 * x, t = 2 * y, r = l + 2, b = t + 2, c = [l + 1, t + 1];
  if (q === 0) return [[l, t], [r, t], c];
  if (q === 1) return [[r, t], [r, b], c];
  if (q === 2) return [[r, b], [l, b], c];
  return [[l, b], [l, t], c];
}

// 삼각형 묶음의 바깥 경계 고리들(반 칸 단위 점 배열). 안쪽 변(이웃 삼각형과 마주 보는 변)은 지운다.
// 모든 고리가 같은 방향이므로 nonzero 채우기로 이음매 없는 한 덩어리가 된다(구멍은 반대 방향).
export function loopsOf(tris) {
  const edges = new Map(); // "ax,ay>bx,by" -> [a, b]
  for (const t of tris) {
    const v = halfVerts(t);
    for (let i = 0; i < 3; i++) {
      const a = v[i];
      const b = v[(i + 1) % 3];
      const rev = `${b[0]},${b[1]}>${a[0]},${a[1]}`;
      if (edges.has(rev)) edges.delete(rev);
      else edges.set(`${a[0]},${a[1]}>${b[0]},${b[1]}`, [a, b]);
    }
  }
  const out = new Map(); // 시작점 -> 그 점에서 나가는 변들
  for (const [a, b] of edges.values()) {
    const k = `${a[0]},${a[1]}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(b);
  }
  const loops = [];
  const starts = [...out.keys()].sort();
  for (const s of starts) {
    while (out.get(s).length) {
      const loop = [s.split(',').map(Number)];
      let cur = s;
      for (let guard = 0; guard < 10000; guard++) {
        const list = out.get(cur);
        if (!list || !list.length) break;
        const nxt = list.shift();
        cur = `${nxt[0]},${nxt[1]}`;
        if (cur === s) break;
        loop.push(nxt);
      }
      loops.push(simplify(loop));
    }
  }
  return loops;
}

// 한 직선 위에 있는 가운데 점을 지운다.
function simplify(loop) {
  const n = loop.length;
  if (n < 4) return loop;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i + n - 1) % n];
    const c = loop[i];
    const q = loop[(i + 1) % n];
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cross !== 0) out.push(c);
  }
  return out;
}

// 조각 안쪽의 칸 경계선(두 칸이 맞닿은 변), 반 칸 단위 [a, b] 목록. 조각 칸을 세기 쉽게 옅게 그린다.
export function innerCellEdges(tris) {
  const have = new Set(tris.map((t) => t.join(',')));
  const out = [];
  for (const [x, y, q] of tris) {
    if (q === 1 && have.has(`${x + 1},${y},3`)) out.push([[2 * x + 2, 2 * y], [2 * x + 2, 2 * y + 2]]);
    if (q === 2 && have.has(`${x},${y + 1},0`)) out.push([[2 * x, 2 * y + 2], [2 * x + 2, 2 * y + 2]]);
  }
  return out;
}

// 반 칸 단위 고리들 → SVG path d(칸 크기 S, 원점 0,0 기준 로컬 px).
export function loopsPath(loops, S) {
  const h = S / 2;
  return loops.map((l) => `M${l.map(([x, y]) => `${+(x * h).toFixed(2)},${+(y * h).toFixed(2)}`).join('L')}Z`).join('');
}
