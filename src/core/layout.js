// 트레이 시작 배치·클램프·비키기와 조각 상태 전이. 순수 함수만 둔다(DOM·저장소 금지).
//
// 좌표: 판과 트레이는 같은 칸 격자다(판 칸 0..cols-1, 트레이는 그 둘레, 음수 칸 가능).
// 조각 자리 약속(board.js와 같음): 놓인 삼각형 = translate(normalize(tris), dx, dy).
//
// bounds(트레이 경계, 칸 단위·끝 포함): {minX, minY, maxX, maxY, keep: [{x0, y0, x1, y1, board?}]}
//   keep = 트레이 조각이 들어가면 안 되는 칸 사각형(그림 속 판 전체(board:true)와 화면 UI 칸).
//   src/view/geom.js trayBounds(g, uiRects)가 만든다.
// 트레이 조각은 칸 단위로 겹치지 않는다(같은 칸에 두 조각의 삼각형이 있으면 겹친 것으로 본다).
//
// 상태 state = {pieces, moves, hidden}
//   piece = {id, tris(정규화한 지금 모양), mark:[x, y, q, v](무늬 사분, v=홈 방향 0|1),
//            pos:[dx, dy](지금 자리, 판이든 트레이든), at:[dx, dy]|null(판 위면 pos와 같음, 트레이면 null),
//            queue:[move](숨김 모드에서 쌓인 이동)}
//   moves = 뒤집기·돌리기 버튼을 누른 수(숨김 모드는 되돌리기도 1회).
import { rotCW, flipLR, flipUD, normalize, translate, key } from './grid.js';
import { applyElem } from './pieces.js';
import { canPlace } from './board.js';

const rot = (n) => (tris) => {
  let t = tris;
  for (let i = 0; i < n; i++) t = rotCW(t);
  return t;
};
const RAW = {
  flipUp: flipUD, flipDown: flipUD, flipLeft: flipLR, flipRight: flipLR,
  cw90: rot(1), cw180: rot(2), cw270: rot(3), ccw90: rot(3), ccw180: rot(2), ccw270: rot(1),
};
const isFlip = (m) => m.startsWith('flip');
const k1 = (t) => key([t]);
const ck = (x, y) => `${x},${y}`;
const z = (v) => v || 0; // -0 → 0

function bbox(tris) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of tris) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 조각이 걸친 칸 목록 [x, y](자리 at 더함, 중복 없음).
export function cellsOf(tris, at = [0, 0]) {
  const seen = new Map();
  for (const [x, y] of tris) seen.set(ck(x + at[0], y + at[1]), [x + at[0], y + at[1]]);
  return [...seen.values()];
}

// 모양 tris에 변환 fn을 적용하고, 함께 따라가는 사분들(extras)도 같은 만큼 옮겨 정규화한다.
function carry(tris, extras, fn) {
  const raw = fn([...tris, ...extras.map((e) => e.slice(0, 3))]);
  const shape = raw.slice(0, tris.length);
  const { x0, y0 } = bbox(shape);
  const moved = raw.slice(tris.length).map(([x, y, q]) => [x - x0, y - y0, q]);
  return { tris: normalize(shape), extras: moved };
}

// 이동 1번(applyMove와 같은 모양) + 무늬가 따라간다. 뒤집으면 무늬 홈 방향(v)이 바뀐다.
export function transformMarked(tris, mark, move) {
  const fn = RAW[move];
  if (!fn) throw new Error(`unknown move: ${move}`);
  const r = carry(tris, [mark], fn);
  return { tris: r.tris, mark: [...r.extras[0], isFlip(move) ? 1 - mark[3] : mark[3]] };
}

// D4 원소(해답 기록의 elem) + 무늬. 1단계 완성 그림에 무늬를 함께 그릴 때 쓴다.
export function elemMarked(tris, mark, elem) {
  const r = carry(tris, [mark], (t) => applyElem(t, elem));
  return { tris: r.tris, mark: [...r.extras[0], elem.startsWith('fx') ? 1 - mark[3] : mark[3]] };
}

// 숨김 모드 놓기: 쌓인 이동을 차례로 적용한 결과 모양·무늬와, 잡은 사분(grab)이 결과에서 간 사분.
export function revealResult(tris, mark, queue, grab) {
  let t = normalize(tris);
  let m = mark;
  let gq = grab;
  for (const mv of queue) {
    const r = carry(t, [m, gq], RAW[mv]);
    t = r.tris;
    m = [...r.extras[0], isFlip(mv) ? 1 - m[3] : m[3]];
    gq = r.extras[1];
  }
  return { tris: t, mark: m, grab: gq };
}

const inKeep = (bounds, x, y) => bounds.keep.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
const flatOthers = (others) => (others.length > 0 && typeof others[0][0] === 'number' ? others : others.flat());
const cellSet = (others) => new Set(flatOthers(others).map(([x, y]) => ck(x, y)));

// 트레이 자리로 괜찮은지: 모든 칸이 경계 안, 판·UI 칸 밖, 다른 조각과 칸을 나누지 않음.
// others: 다른 조각들의 놓인 삼각형(Tri[][] 또는 합친 Tri[]).
export function trayOk(tris, at, others, bounds) {
  return trayOkSet(tris, at, cellSet(others), bounds);
}
function trayOkSet(tris, at, taken, bounds) {
  for (const [x, y] of cellsOf(tris, at)) {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return false;
    if (inKeep(bounds, x, y) || taken.has(ck(x, y))) return false;
  }
  return true;
}

// 조각 상자가 트레이 경계 안에 들어오도록 자리를 끌어당긴다(판·UI 칸은 보지 않는다).
export function clampToTray(tris, at, bounds) {
  const b = bbox(normalize(tris));
  const lo = (v, min, max) => (min > max ? min : Math.min(Math.max(v, min), max));
  return [
    z(lo(at[0], bounds.minX - b.x0, bounds.maxX - b.x1)),
    z(lo(at[1], bounds.minY - b.y0, bounds.maxY - b.y1)),
  ];
}

// 가장 가까운(자리 차이 거리) 빈 자리. board(판 삼각형)를 주면 판 위 놓을 수 있는 자리(canPlace)만,
// 없으면 트레이 자리만 찾는다 — 트레이로 찾을 때는 판에 절대 들어가지 않는다. 자리가 없으면 null.
// 트레이로 찾을 때는 먼저 at을 트레이 경계 안으로 끌어당긴 점에서 잰다(화면 밖에 놓아도 가장 가까운 트레이 자리).
// gap: 트레이에서 다른 조각과 한 칸 띄운 자리를 먼저 찾는다(없으면 붙은 자리). 비키기가 트레이를 빽빽하게 만들지 않게.
export function nearestFree(tris, at, others, bounds, board = null, { gap = false } = {}) {
  const shape = normalize(tris);
  const b = bbox(shape);
  let best = null;
  let bestD = Infinity;
  const consider = (dx, dy, tx, ty) => {
    const d = (dx - tx) ** 2 + (dy - ty) ** 2;
    if (d < bestD || (d === bestD && (dy < best[1] || (dy === best[1] && dx < best[0])))) {
      best = [z(dx), z(dy)];
      bestD = d;
    }
  };
  if (board) {
    const B = bbox(board);
    const flat = flatOthers(others);
    for (let dy = B.y0 - b.y0; dy + b.y1 <= B.y1; dy++) {
      for (let dx = B.x0 - b.x0; dx + b.x1 <= B.x1; dx++) {
        if (canPlace(board, flat, translate(shape, dx, dy))) consider(dx, dy, at[0], at[1]);
      }
    }
    return best;
  }
  const [tx, ty] = clampToTray(shape, at, bounds);
  const taken = cellSet(others);
  const scan = (block) => {
    for (let dy = bounds.minY - b.y0; dy + b.y1 <= bounds.maxY; dy++) {
      for (let dx = bounds.minX - b.x0; dx + b.x1 <= bounds.maxX; dx++) {
        if (trayOkSet(shape, [dx, dy], block, bounds)) consider(dx, dy, tx, ty);
      }
    }
  };
  if (gap) {
    scan(haloOf(taken));
    if (best) return best;
  }
  scan(taken);
  return best;
}

// 칸 집합 + 둘레 8칸.
function haloOf(taken) {
  const out = new Set();
  for (const k of taken) {
    const [x, y] = k.split(',').map(Number);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.add(ck(x + i, y + j));
  }
  return out;
}

// 판 둘레 트레이 시작 자리 {id: [dx, dy]}. 결정적이다.
// 조각마다 "긴 변 n의 정사각형 자리"를 잡고(다른 자리와 한 칸 띄움) 그 가운데에 조각을 둔다. 트레이에서는 조각을
// 어느 쪽으로 돌리거나 뒤집어도 이 정사각형 안에 머물러(가운데 유지 규칙) 이웃을 밀거나 비킬 일이 없다.
// 정사각형 자리가 모자라면 붙인 정사각형, 그래도 모자라면 실제 모양(띄워서, 붙여서) 순서로 물러선다.
// 큰 조각부터 판 왼쪽 가운데·오른쪽 가운데·아래 가운데·… 표적에 가장 가까운 자리를 고른다.
// requireGap: 띄운 정사각형 자리가 없으면 null(칸 크기를 고를 때 쓴다). 아니면 자리가 아예 없을 때 예외.
export function placeStarts(puzzle, bounds, { requireGap = false } = {}) {
  const items = puzzle.pieces.map((pc, idx) => {
    const tris = normalize(pc.start);
    const b = bbox(tris);
    return { id: pc.id, idx, tris, w: b.w, h: b.h, n: Math.max(b.w, b.h) };
  });
  items.sort((a, b) => b.tris.length - a.tris.length || a.idx - b.idx);
  const square = (it) => {
    const out = [];
    for (let y = 0; y < it.n; y++) for (let x = 0; x < it.n; x++) out.push([x, y, 0]);
    return out;
  };
  const inSquare = (it, at) => [z(at[0] + Math.floor((it.n - it.w) / 2)), z(at[1] + Math.floor((it.n - it.h) / 2))];
  const tries = [
    [square, true, inSquare], [square, false, inSquare],
    [(it) => it.tris, true, (it, at) => at], [(it) => it.tris, false, (it, at) => at],
  ];
  for (const [shapeOf, gap, finish] of requireGap ? tries.slice(0, 1) : tries) {
    const at = placeShapes(items.map(shapeOf), bounds, gap);
    if (at) return Object.fromEntries(items.map((it, i) => [it.id, finish(it, at[i])]));
  }
  if (requireGap) return null;
  throw new Error(`placeStarts: no tray room for ${puzzle.id}`);
}

// 모양들을 차례로 표적 가까이 놓는다. gap이면 서로 한 칸 띄운다. 하나라도 못 놓으면 null.
function placeShapes(shapes, bounds, gap) {
  const kb = bounds.keep.find((r) => r.board) || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const midY = (kb.y0 + kb.y1 + 1) / 2;
  const leftX = (bounds.minX + kb.x0) / 2;
  const rightX = (kb.x1 + 1 + bounds.maxX + 1) / 2;
  const midX = (kb.x0 + kb.x1 + 1) / 2;
  const hY = kb.y1 - kb.y0 + 1;
  const anchors = [
    [leftX, midY], [rightX, midY], [midX, (kb.y1 + 1 + bounds.maxY + 1) / 2],
    [leftX, kb.y0 + hY * 0.2], [rightX, kb.y0 + hY * 0.8], [leftX, kb.y0 + hY * 0.8], [rightX, kb.y0 + hY * 0.2],
    [midX, (bounds.minY + kb.y0) / 2],
  ];
  const block = new Set(); // 놓인 칸(gap이면 둘레 8칸까지)
  const out = [];
  for (let n = 0; n < shapes.length; n++) {
    const tris = shapes[n];
    const [ax, ay] = anchors[n % anchors.length];
    const b = bbox(tris);
    let best = null;
    let bestD = Infinity;
    for (let dy = bounds.minY - b.y0; dy + b.y1 <= bounds.maxY; dy++) {
      for (let dx = bounds.minX - b.x0; dx + b.x1 <= bounds.maxX; dx++) {
        const d = (dx + b.x0 + b.w / 2 - ax) ** 2 + (dy + b.y0 + b.h / 2 - ay) ** 2;
        if (d >= bestD) continue;
        if (trayOkSet(tris, [dx, dy], block, bounds)) {
          best = [z(dx), z(dy)];
          bestD = d;
        }
      }
    }
    if (!best) return null;
    out.push(best);
    for (const [x, y] of cellsOf(tris, best)) {
      if (!gap) block.add(ck(x, y));
      else for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) block.add(ck(x + i, y + j));
    }
  }
  return out;
}

// 처음 상태: 시작 모양, 트레이 시작 자리, 무늬 = 시작 모양 첫 사분.
export function initialState(puzzle, bounds, { hidden = false } = {}) {
  const starts = placeStarts(puzzle, bounds);
  return {
    hidden: !!hidden,
    moves: 0,
    pieces: puzzle.pieces.map((pc) => {
      const tris = normalize(pc.start);
      return { id: pc.id, tris, mark: [...tris[0], 0], pos: starts[pc.id], at: null, queue: [] };
    }),
  };
}

const placedOf = (q) => translate(q.tris, q.pos[0], q.pos[1]);
const othersOf = (state, id) => state.pieces.filter((q) => q.id !== id).map(placedOf);
const replace = (state, id, patch, moves = state.moves) => ({
  ...state,
  moves,
  pieces: state.pieces.map((q) => (q.id === id ? { ...q, ...patch } : q)),
});

// 자리 정하기. board: 판에 놓아도 되는지(트레이 조각을 돌릴 때는 false — 트레이 조각은 변환으로 판에 들어가지 않는다).
// nearby: 판 위에서 안 맞으면 판의 가장 가까운 빈 자리를 먼저 찾는다(판 위 조각을 돌릴 때).
// 그다음 그 자리가 트레이로 괜찮으면 그대로, 아니면 트레이의 가장 가까운 빈 자리.
function settle(tris, pos, others, ctx, { board = true, nearby = false } = {}) {
  if (board && canPlace(ctx.board, others, translate(tris, pos[0], pos[1]))) return { pos, at: pos };
  if (board && nearby) {
    const b = nearestFree(tris, pos, others, ctx.bounds, ctx.board);
    if (b) return { pos: b, at: b };
  }
  if (trayOk(tris, pos, others, ctx.bounds)) return { pos, at: null };
  const t = nearestFree(tris, pos, others, ctx.bounds, null, { gap: true });
  return t ? { pos: t, at: null } : null;
}

// 상태 전이. ctx = {board: 판 삼각형, bounds: 트레이 경계}.
// {type:'move', id, move}  보이는 모드: 조각 가운데 기준 제자리 변환(겹치면 가장 가까운 빈 자리), 이동 +1.
//                          숨김 모드: queue에 쌓기만(모양 그대로), 이동 +1.
// {type:'undo', id}        숨김 모드: 맨 끝 카드 지우기, 이동 +1(빈 줄이면 아무 일 없음).
// {type:'reset', id}       숨김 모드: 줄 비우기(이동 수 그대로).
// {type:'drop', id, at, finger, grab, over}
//   at = 놓은 자리(그려진 조각 왼쪽 위를 칸에 맞춘 것), finger = 손가락 칸 [x, y], grab = 잡은 사분(지금 모양 기준),
//   over = 손가락이 그림 속 판 위인지. 숨김 모드에서 줄이 있고 over면: 줄을 차례로 적용한 결과의 잡은 사분 칸이
//   손가락 칸에 오게 놓고 canPlace 검사. 실패하면 결과 모양이 새 출발 모양, 트레이로, 줄 비움. 놓기는 이동이 아니다.
export function applyAction(state, action, ctx) {
  const pc = state.pieces.find((q) => q.id === action.id);
  if (!pc) return state;
  const others = othersOf(state, pc.id);
  switch (action.type) {
    case 'move': {
      if (state.hidden) return replace(state, pc.id, { queue: [...pc.queue, action.move] }, state.moves + 1);
      const r = transformMarked(pc.tris, pc.mark, action.move);
      const a = bbox(pc.tris);
      const b = bbox(r.tris);
      // 가운데 유지. 반 칸이 남으면 0 쪽으로 버린다(홀함수라 돌리고 되돌리면 제자리, 네 번 돌려도 걸어가지 않음).
      const pos = [z(pc.pos[0] + Math.trunc((a.w - b.w) / 2)), z(pc.pos[1] + Math.trunc((a.h - b.h) / 2))];
      const s = settle(r.tris, pos, others, ctx, { board: !!pc.at, nearby: true });
      if (!s) return state; // 트레이가 꽉 차 둘 곳이 없다(실제로는 일어나지 않음): 바꾸지 않는다
      return replace(state, pc.id, { tris: r.tris, mark: r.mark, ...s }, state.moves + 1);
    }
    case 'undo':
      if (!state.hidden || pc.queue.length === 0) return state;
      return replace(state, pc.id, { queue: pc.queue.slice(0, -1) }, state.moves + 1);
    case 'reset':
      if (pc.queue.length === 0) return state;
      return replace(state, pc.id, { queue: [] });
    case 'drop': {
      if (state.hidden && pc.queue.length > 0 && action.over && action.finger && action.grab) {
        const r = revealResult(pc.tris, pc.mark, pc.queue, action.grab);
        const at = [z(action.finger[0] - r.grab[0]), z(action.finger[1] - r.grab[1])];
        if (canPlace(ctx.board, others, translate(r.tris, at[0], at[1]))) {
          return replace(state, pc.id, { tris: r.tris, mark: r.mark, pos: at, at, queue: [] });
        }
        // 실패: 드러난 모양으로 원래 트레이 자리(판 위에서 집었으면 놓은 곳)에서 가장 가까운 빈 자리
        const from = pc.at ? at : pc.pos;
        const t = nearestFree(r.tris, from, others, ctx.bounds, null, { gap: true }) || clampToTray(r.tris, from, ctx.bounds);
        return replace(state, pc.id, { tris: r.tris, mark: r.mark, pos: t, at: null, queue: [] });
      }
      const at = action.at || pc.pos;
      // 숨김 모드에서 줄이 남은 조각은 드러나기 전에는 판에 올리지 않는다(판 밖에서 놓았으면 트레이로).
      const s = settle(pc.tris, at, others, ctx, { board: !(state.hidden && pc.queue.length > 0) });
      if (!s) return state;
      return replace(state, pc.id, s);
    }
    default:
      return state;
  }
}

// 무대 크기가 바뀌어 트레이 경계가 달라졌을 때: 경계를 벗어나거나 겹친 트레이 조각을 가장 가까운 빈 자리로.
export function refit(state, ctx) {
  let st = state;
  for (const pc of state.pieces) {
    if (pc.at) continue;
    const cur = st.pieces.find((q) => q.id === pc.id);
    const others = othersOf(st, pc.id);
    if (trayOk(cur.tris, cur.pos, others, ctx.bounds)) continue;
    const t = nearestFree(cur.tris, cur.pos, others, ctx.bounds, null, { gap: true });
    if (t) st = replace(st, pc.id, { pos: t });
  }
  return st;
}
