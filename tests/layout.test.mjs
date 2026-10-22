// 시작 배치·트레이·비키기(src/core/layout.js)와 격자→화면 변환(src/view/geom.js) 시험.
// Review Focus 1: 판 밖·화면 밖으로 끌어 놓은 조각은 트레이 안 가장 가까운 빈 자리로 돌아온다.
// Review Focus 3: 숨김 모드에서 이동을 쌓은 뒤 판에 놓았는데 맞지 않으면 결과 모양으로 트레이에 돌아오고 줄은 빈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { key, normalize, translate } from '../src/core/grid.js';
import { applyMove, applyElem, MOVES, LIBRARY } from '../src/core/pieces.js';
import { canPlace, wrongTris, isSolved } from '../src/core/board.js';
import {
  placeStarts, clampToTray, nearestFree, trayOk, initialState, applyAction,
  transformMarked, elemMarked, revealResult, cellsOf, refit,
} from '../src/core/layout.js';
import {
  stageSize, fitStage, fitPuzzle, maxCell, boardDims, trayBounds, hudRects, artRects, triPolygon, triCentroid,
  screenToCell, screenToTri, loopsOf, loopsPath, innerCellEdges, pieceRect, cellBoxes,
} from '../src/view/geom.js';

const ROOT = new URL('../', import.meta.url);
const bank = (s) => JSON.parse(readFileSync(fileURLToPath(new URL(`data/puzzles-s${s}.json`, ROOT)), 'utf8'));
const ALL = [1, 2, 3, 4].flatMap(bank);
const byId = (id) => ALL.find((p) => p.id === id);
const SIZES = [stageSize(1280, 800), stageSize(1024, 768)];
const clone = (x) => JSON.parse(JSON.stringify(x));
const k1 = (t) => key([t]);

// 문제 하나를 무대 크기에 맞춘 판정 맥락: 칸 크기·원점(g), 트레이 경계(bounds), 판 삼각형(board).
function ctxFor(puzzle, { W, H }) {
  const { g, bounds } = fitPuzzle(W, H, puzzle);
  return { g, bounds, board: puzzle.board };
}
const cellKey = ([x, y]) => `${x},${y}`;
function inKeep(bounds, x, y) {
  return bounds.keep.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
}
// 트레이 자리로 옳은지: 경계 안, 판·UI 칸 밖, 다른 조각과 칸을 나누지 않음.
function assertTraySpot(bounds, tris, at, otherCells, msg) {
  for (const [x, y] of cellsOf(tris, at)) {
    assert.ok(x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY, `${msg}: cell ${x},${y} outside tray`);
    assert.ok(!inKeep(bounds, x, y), `${msg}: cell ${x},${y} in board/UI area`);
    assert.ok(!otherCells.has(cellKey([x, y])), `${msg}: cell ${x},${y} overlaps another piece`);
  }
}
const ELEM_MOVES = {
  id: [], r90: ['cw90'], r180: ['cw180'], r270: ['cw270'],
  fx: ['flipLeft'], fx_r90: ['flipLeft', 'cw90'], fx_r180: ['flipUp'], fx_r270: ['flipLeft', 'cw270'],
};

// ---- geom ----

test('stageSize fits a 16:10 stage inside the viewport', () => {
  assert.deepEqual(stageSize(1024, 768), { W: 1024, H: 640 });
  assert.deepEqual(stageSize(1280, 800), { W: 1280, H: 800 });
  assert.deepEqual(stageSize(1600, 800), { W: 1280, H: 800 });
});

test('grid is centred inside the painted board with cells >= 44px at 1024x640', () => {
  for (const size of SIZES) {
    const art = artRects(size.W, size.H);
    for (const p of ALL) {
      const { cols, rows } = boardDims(p.board);
      const { g } = fitPuzzle(size.W, size.H, p);
      assert.ok(g.S <= maxCell(size.W, size.H, cols, rows));
      assert.ok(g.S >= Math.ceil(size.H * 0.06875), `${p.id}@${size.W} S=${g.S}`);
      if (size.W === 1024) assert.ok(g.S >= 44, `${p.id} S=${g.S}`);
      const l = g.ox, t = g.oy, r = g.ox + cols * g.S, b = g.oy + rows * g.S;
      assert.ok(l >= art.inner.l && r <= art.inner.r && t >= art.inner.t && b <= art.inner.b, `${p.id} grid spills off painted board`);
      assert.ok(Math.abs((l + r) / 2 - (art.inner.l + art.inner.r) / 2) <= 1, `${p.id} not centred x`);
      assert.ok(Math.abs((t + b) / 2 - (art.inner.t + art.inner.b) / 2) <= 1, `${p.id} not centred y`);
    }
  }
});

test('painted board rect follows CSS cover scaling of the 1672x941 art', () => {
  const { inner } = artRects(1280, 800);
  const s = 800 / 941;
  const ox = (1280 - 1672 * s) / 2;
  assert.ok(Math.abs(inner.l - (433 * s + ox)) < 0.01);
  assert.ok(Math.abs(inner.t - 214 * s) < 0.01);
});

test('triPolygon / screenToTri / screenToCell round trip', () => {
  const g = fitStage(1280, 800, 5, 4);
  for (const t of [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3], [3, -2, 1], [-4, 5, 2]]) {
    const poly = triPolygon(t, g);
    assert.equal(poly.length, 3);
    const [cx, cy] = triCentroid(t, g);
    assert.deepEqual(screenToTri(cx, cy, g), t);
    assert.deepEqual(screenToCell(cx, cy, g), [t[0], t[1]]);
  }
});

test('loopsOf: outline encloses exactly the triangles (every board and piece shape)', () => {
  // 반 칸 단위에서 사분 삼각형 넓이 = 1. 고리들의 부호 넓이 합 = 삼각형 수(모든 고리가 같은 방향, 구멍은 반대).
  const area = (loop) => loop.reduce((a, p, i) => {
    const q = loop[(i + 1) % loop.length];
    return a + (p[0] * q[1] - q[0] * p[1]) / 2;
  }, 0);
  const shapes = [...ALL.map((p) => p.board), ...LIBRARY.map((l) => l.tris), ...ALL.flatMap((p) => p.pieces.map((q) => q.start))];
  for (const tris of shapes) {
    const loops = loopsOf(tris);
    assert.ok(loops.length >= 1);
    assert.equal(loops.reduce((a, l) => a + area(l), 0), tris.length, key(tris));
  }
  // 칸 하나: 꼭짓점 4개 고리 하나, 안쪽 칸 선 없음. 가로 두 칸: 고리 하나, 안쪽 칸 선 하나.
  const one = loopsOf([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]]);
  assert.equal(one.length, 1);
  assert.equal(one[0].length, 4);
  const two = [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3], [1, 0, 0], [1, 0, 1], [1, 0, 2], [1, 0, 3]];
  assert.equal(loopsOf(two).length, 1);
  assert.deepEqual(innerCellEdges(two), [[[2, 0], [2, 2]]]);
  assert.match(loopsPath(loopsOf(two), 10), /^M[-\d.,L]+Z$/);
  const g = fitStage(1280, 800, 4, 4);
  assert.deepEqual(pieceRect(two, [1, 2], g), { l: g.ox + g.S, t: g.oy + 2 * g.S, r: g.ox + 3 * g.S, b: g.oy + 3 * g.S });
  assert.equal(cellBoxes(two, [0, 0], g, 'x').length, 2);
});

// ---- layout: 시작 배치 ----

test('placeStarts: every puzzle, both sizes: in tray, off board/UI, no overlap', () => {
  for (const size of SIZES) {
    for (const p of ALL) {
      const { bounds } = ctxFor(p, size);
      const starts = placeStarts(p, bounds);
      const taken = new Set();
      for (const pc of p.pieces) {
        const at = starts[pc.id];
        assert.ok(Array.isArray(at), `${p.id}/${pc.id} no start`);
        const tris = normalize(pc.start);
        assertTraySpot(bounds, tris, at, taken, `${p.id}/${pc.id} @${size.W}`);
        for (const c of cellsOf(tris, at)) taken.add(cellKey(c));
      }
    }
  }
});

test('placeStarts is deterministic', () => {
  const p = byId('s4-007');
  const { bounds } = ctxFor(p, SIZES[0]);
  assert.deepEqual(placeStarts(p, bounds), placeStarts(p, bounds));
});

// ---- layout: 트레이 자리 ----

test('clampToTray keeps the piece box inside the tray bounds', () => {
  const p = byId('s2-003');
  const { bounds } = ctxFor(p, SIZES[1]);
  const tris = normalize(p.pieces[0].start);
  for (const at of [[-99, -99], [99, 99], [-99, 3], [2, 99]]) {
    for (const [x, y] of cellsOf(tris, clampToTray(tris, at, bounds))) {
      assert.ok(x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY, `${at} -> ${x},${y}`);
    }
  }
});

test('nearestFree: a tray piece never lands on the board', () => {
  for (const p of [1, 2, 3, 4].map((s) => byId(`s${s}-010`))) {
    for (const size of SIZES) {
      const { bounds } = ctxFor(p, size);
      const starts = placeStarts(p, bounds);
      const [first, ...rest] = p.pieces;
      const others = rest.map((pc) => translate(normalize(pc.start), ...starts[pc.id]));
      const tris = normalize(first.start);
      // 판 한가운데에 놓으려 해도 판 밖(트레이) 빈 자리로 간다
      const at = nearestFree(tris, [1, 1], others, bounds);
      assert.ok(at, `${p.id} no spot`);
      const otherCells = new Set(others.flatMap((o) => cellsOf(o, [0, 0])).map(cellKey));
      assertTraySpot(bounds, tris, at, otherCells, `${p.id} @${size.W}`);
      for (const t of translate(tris, ...at)) assert.ok(!p.board.some((b) => k1(b) === k1(t)), 'entered board');
    }
  }
});

test('drop outside stage returns piece', () => {
  for (const size of SIZES) {
    for (const p of [byId('s1-001'), byId('s4-040')]) {
      const { bounds } = ctxFor(p, size);
      const starts = placeStarts(p, bounds);
      const [first, ...rest] = p.pieces;
      const others = rest.map((pc) => translate(normalize(pc.start), ...starts[pc.id]));
      const otherCells = new Set(others.flatMap((o) => cellsOf(o, [0, 0])).map(cellKey));
      const tris = normalize(first.start);
      for (const far of [[-200, -200], [200, 200], [-200, 200], [200, -200], [3, -200], [-200, 2]]) {
        const at = nearestFree(tris, far, others, bounds);
        assert.ok(at, `${p.id} ${far} -> null`);
        assertTraySpot(bounds, tris, at, otherCells, `${p.id} ${far}`);
        assert.ok(trayOk(tris, at, others, bounds));
      }
      // 상태로도: 화면 밖에 놓기 → 트레이 안
      const ctx = { board: p.board, bounds };
      let st = initialState(p, bounds);
      st = applyAction(st, { type: 'drop', id: first.id, at: [-300, -300] }, ctx);
      const pc = st.pieces.find((q) => q.id === first.id);
      assert.equal(pc.at, null);
      const rest2 = st.pieces.filter((q) => q.id !== first.id).map((q) => translate(q.tris, ...q.pos));
      assert.ok(trayOk(pc.tris, pc.pos, rest2, bounds), `${p.id} state drop outside`);
    }
  }
});

test('nearestFree with board: fits on the board or null', () => {
  const p = byId('s1-005');
  const { bounds } = ctxFor(p, SIZES[0]);
  const sol = p.solutions[0];
  const shape = (r) => normalize(applyElem(p.pieces.find((q) => q.id === r.id).start, r.elem));
  // 두 조각을 해답 자리에 두면 남은 조각은 자기 해답 자리에만 들어간다
  const placed = sol.slice(0, -1).map((r) => translate(shape(r), r.dx, r.dy));
  const last = sol[sol.length - 1];
  const at = nearestFree(shape(last), [last.dx + 3, last.dy + 3], placed, bounds, p.board);
  assert.deepEqual(at, [last.dx, last.dy]);
  // 판이 꽉 차면 null
  const full = sol.map((r) => translate(shape(r), r.dx, r.dy));
  assert.equal(nearestFree(shape(last), [0, 0], full, bounds, p.board), null);
});

// ---- layout: 무늬를 따라가는 변환 ----

test('transformMarked matches applyMove and carries the mark', () => {
  for (const lib of LIBRARY) {
    const tris = lib.tris;
    const mark = [...tris[0], 0];
    for (const m of MOVES) {
      const r = transformMarked(tris, mark, m);
      assert.equal(key(r.tris), key(applyMove(tris, m)), `${lib.id} ${m}`);
      assert.ok(r.tris.some((t) => k1(t) === k1(r.mark.slice(0, 3))), `${lib.id} ${m} mark off piece`);
      assert.equal(r.mark[3], m.startsWith('flip') ? 1 : 0, `${lib.id} ${m} notch side`);
    }
    // 시계 방향 90° 네 번 = 제자리(무늬까지)
    let s = { tris, mark };
    for (let i = 0; i < 4; i++) s = transformMarked(s.tris, s.mark, 'cw90');
    assert.deepEqual(s, { tris: normalize(tris), mark });
  }
});

test('elemMarked agrees with the button sequence for each D4 element', () => {
  for (const lib of LIBRARY) {
    const mark = [...lib.tris[0], 0];
    for (const [elem, seq] of Object.entries(ELEM_MOVES)) {
      let s = { tris: lib.tris, mark };
      for (const m of seq) s = transformMarked(s.tris, s.mark, m);
      const e = elemMarked(lib.tris, mark, elem);
      assert.equal(key(e.tris), key(normalize(applyElem(lib.tris, elem))), `${lib.id} ${elem}`);
      assert.deepEqual(e, { tris: normalize(s.tris), mark: s.mark }, `${lib.id} ${elem}`);
    }
  }
});

// ---- layout: 상태 전이 ----

function setup(id, size = SIZES[0], opts = {}) {
  const p = byId(id);
  const { bounds } = ctxFor(p, size);
  return { p, ctx: { board: p.board, bounds }, st: initialState(p, bounds, opts) };
}
const pieceOf = (st, id) => st.pieces.find((q) => q.id === id);
const othersPlaced = (st, id) => st.pieces.filter((q) => q.id !== id).map((q) => translate(q.tris, ...q.pos));
function assertConsistent(st, ctx, msg) {
  const cells = new Map();
  for (const pc of st.pieces) {
    const placed = translate(pc.tris, ...pc.pos);
    if (pc.at) {
      assert.deepEqual(pc.at, pc.pos, `${msg}: at != pos`);
      assert.ok(canPlace(ctx.board, [], placed), `${msg}: ${pc.id} at on board but off board`);
    } else {
      for (const [x, y] of cellsOf(pc.tris, pc.pos)) {
        assert.ok(x >= ctx.bounds.minX && x <= ctx.bounds.maxX && y >= ctx.bounds.minY && y <= ctx.bounds.maxY, `${msg}: ${pc.id} off tray`);
        assert.ok(!inKeep(ctx.bounds, x, y), `${msg}: ${pc.id} tray piece in board/UI area`);
      }
    }
    for (const t of placed) {
      const k = k1(t);
      assert.ok(!cells.has(k), `${msg}: ${pc.id} overlaps ${cells.get(k)}`);
      cells.set(k, pc.id);
    }
  }
  // 트레이 조각끼리는 칸도 나누지 않는다
  const trayCells = new Map();
  for (const pc of st.pieces.filter((q) => !q.at)) {
    for (const c of cellsOf(pc.tris, pc.pos)) {
      assert.ok(!trayCells.has(cellKey(c)), `${msg}: ${pc.id} shares a cell with ${trayCells.get(cellKey(c))}`);
      trayCells.set(cellKey(c), pc.id);
    }
  }
}

test('initialState: start shapes, tray spots, mark on first quarter, zero moves', () => {
  const { p, ctx, st } = setup('s3-001');
  assert.equal(st.moves, 0);
  for (const pc of p.pieces) {
    const s = pieceOf(st, pc.id);
    assert.equal(key(s.tris), key(normalize(pc.start)));
    assert.equal(s.at, null);
    assert.deepEqual(s.queue, []);
    assert.deepEqual(s.mark, [...normalize(pc.start)[0], 0]);
  }
  assertConsistent(st, ctx, 'init');
});

test('move: every button turns the piece in place, counts one move, never enters the board', () => {
  for (const s of [1, 2, 3, 4]) {
    for (const id of [`s${s}-001`, `s${s}-020`, `s${s}-040`]) {
      for (const size of SIZES) {
        const { p, ctx, st: st0 } = setup(id, size);
        let st = st0;
        let n = 0;
        for (const pc of p.pieces) {
          for (const m of MOVES) {
            const before = pieceOf(st, pc.id);
            st = applyAction(st, { type: 'move', id: pc.id, move: m }, ctx);
            n += 1;
            assert.equal(st.moves, n);
            assert.equal(key(pieceOf(st, pc.id).tris), key(applyMove(before.tris, m)), `${id} ${pc.id} ${m}`);
            assertConsistent(st, ctx, `${id}@${size.W} ${pc.id} ${m}`);
          }
        }
      }
    }
  }
});

test('move: every puzzle, both sizes, every button twice on every piece: never stuck, never overlapping', () => {
  for (const size of SIZES) {
    for (const p of ALL) {
      const { ctx, st: st0 } = setup(p.id, size);
      let st = st0;
      for (let rep = 0; rep < 2; rep++) {
        for (const pc of p.pieces) {
          for (const m of MOVES) {
            const next = applyAction(st, { type: 'move', id: pc.id, move: m }, ctx);
            assert.equal(next.moves, st.moves + 1, `${p.id}@${size.W} ${pc.id} ${m} stuck`);
            st = next;
          }
        }
      }
      assertConsistent(st, ctx, `${p.id}@${size.W}`);
    }
  }
});

test('move: a tray piece turns in place inside its own square slot (no neighbour pushing)', () => {
  let checked = 0;
  for (const id of ['s1-001', 's2-040', 's3-020', 's4-002', 's4-027']) {
    const { p, ctx, st: st0 } = setup(id, SIZES[1]);
    // 정사각형 자리를 띄어 잡은 문제만(트레이가 모자란 문제는 실제 모양으로 물러선다: s4-002)
    if (!placeStarts(p, ctx.bounds, { requireGap: true })) continue;
    checked += 1;
    for (const pc of p.pieces) {
      let st = st0;
      const p0 = pieceOf(st, pc.id);
      const n = Math.max(...p0.tris.map(([x, y]) => Math.max(x, y))) + 1;
      // 정사각형 자리 = 처음 자리에서 짧은 변 쪽으로 가운데 맞춤만큼 뺀 곳
      const w = Math.max(...p0.tris.map(([x]) => x)) + 1;
      const h = Math.max(...p0.tris.map(([, y]) => y)) + 1;
      const sq = [p0.pos[0] - Math.floor((n - w) / 2), p0.pos[1] - Math.floor((n - h) / 2)];
      for (const m of [...MOVES, ...MOVES]) {
        st = applyAction(st, { type: 'move', id: pc.id, move: m }, ctx);
        for (const [x, y] of cellsOf(pieceOf(st, pc.id).tris, pieceOf(st, pc.id).pos)) {
          assert.ok(x >= sq[0] && x < sq[0] + n && y >= sq[1] && y < sq[1] + n, `${id}/${pc.id} ${m} left its slot`);
        }
        for (const q of st.pieces) if (q.id !== pc.id) assert.deepEqual(q.pos, pieceOf(st0, q.id).pos);
      }
    }
  }
  assert.ok(checked >= 4, `checked ${checked}`);
});

test('move: turning back and forth does not walk the piece (no drift)', () => {
  const { p, ctx, st: st0 } = setup('s1-003');
  const id = p.pieces[0].id;
  let st = st0;
  const pos0 = pieceOf(st, id).pos;
  // 다른 조각을 치워 비키기가 일어나지 않게 한다
  st = { ...st, pieces: st.pieces.map((q) => (q.id === id ? q : { ...q, pos: [ctx.bounds.maxX - 3, ctx.bounds.maxY - 3] })) };
  st = { ...st, pieces: st.pieces.filter((q) => q.id === id) };
  for (let i = 0; i < 4; i++) st = applyAction(st, { type: 'move', id, move: 'cw90' }, ctx);
  assert.deepEqual(pieceOf(st, id).pos, pos0);
  st = applyAction(st, { type: 'move', id, move: 'cw90' }, ctx);
  st = applyAction(st, { type: 'move', id, move: 'ccw90' }, ctx);
  assert.deepEqual(pieceOf(st, id).pos, pos0);
});

test('move: a board piece stays on the board when it can, else goes to the tray', () => {
  const { p, ctx, st: st0 } = setup('s2-005');
  const sol = p.solutions[0];
  // 첫 조각만 해답 자리에(판은 넓게 비어 있음)
  const r = sol[0];
  const shape = normalize(applyElem(p.pieces.find((q) => q.id === r.id).start, r.elem));
  let st = { ...st0, pieces: st0.pieces.map((q) => (q.id === r.id ? { ...q, tris: shape, mark: [...shape[0], 0] } : q)) };
  st = applyAction(st, { type: 'drop', id: r.id, at: [r.dx, r.dy] }, ctx);
  assert.deepEqual(pieceOf(st, r.id).at, [r.dx, r.dy]);
  let stayed = 0;
  for (const m of MOVES) {
    if (!pieceOf(st, r.id).at) {
      // 트레이로 갔으면 해답 모양·자리로 판에 다시 올려 둔다
      st = { ...st, pieces: st.pieces.map((q) => (q.id === r.id ? { ...q, tris: shape } : q)) };
      st = applyAction(st, { type: 'drop', id: r.id, at: [r.dx, r.dy] }, ctx);
      assert.deepEqual(pieceOf(st, r.id).at, [r.dx, r.dy]);
    }
    const before = pieceOf(st, r.id);
    const turned = applyMove(before.tris, m);
    const room = nearestFree(turned, before.pos, othersPlaced(st, r.id), ctx.bounds, ctx.board);
    st = applyAction(st, { type: 'move', id: r.id, move: m }, ctx);
    if (room) {
      assert.ok(pieceOf(st, r.id).at, `${m}: left the board although it fits on the board`);
      stayed += 1;
    } else {
      assert.equal(pieceOf(st, r.id).at, null, `${m}: no board room yet on the board`);
    }
    assertConsistent(st, ctx, m);
  }
  assert.ok(stayed >= 5, `stayed ${stayed}`);
  // 판을 다른 조각들로 다 채우면(해답 자리) 돌린 조각은 트레이로 간다
  let full = st0;
  for (const q of sol) {
    const sh = normalize(applyElem(p.pieces.find((x) => x.id === q.id).start, q.elem));
    full = { ...full, pieces: full.pieces.map((x) => (x.id === q.id ? { ...x, tris: sh, pos: [q.dx, q.dy], at: [q.dx, q.dy] } : x)) };
  }
  assert.ok(isSolved(p, full.pieces));
  const asym = sol.find((q) => {
    const sh = pieceOf(full, q.id).tris;
    return key(applyMove(sh, 'cw90')) !== key(sh);
  });
  const moved = applyAction(full, { type: 'move', id: asym.id, move: 'cw90' }, ctx);
  assertConsistent(moved, ctx, 'full board');
  assert.equal(pieceOf(moved, asym.id).at, null, 'no board room: goes to the tray');
  assert.equal(moved.moves, 1);
});

test('drop: on the board when it fits, otherwise to the nearest tray spot', () => {
  const { p, ctx, st: st0 } = setup('s1-002');
  const r = p.solutions[0][0];
  const shape = normalize(applyElem(p.pieces.find((q) => q.id === r.id).start, r.elem));
  let st = { ...st0, pieces: st0.pieces.map((q) => (q.id === r.id ? { ...q, tris: shape } : q)) };
  st = applyAction(st, { type: 'drop', id: r.id, at: [r.dx, r.dy] }, ctx);
  assert.deepEqual(pieceOf(st, r.id).at, [r.dx, r.dy]);
  assert.equal(wrongTris(p, st.pieces).size, 0);
  // 판 밖으로 반쯤 걸치게 놓으면 트레이로
  st = applyAction(st, { type: 'drop', id: r.id, at: [-1, -1] }, ctx);
  assert.equal(pieceOf(st, r.id).at, null);
  assertConsistent(st, ctx, 'half off');
  assert.equal(st.moves, 0, 'drops are not moves');
});

// ---- 숨김 모드 ----

test('hidden: buttons queue cards without changing the shape; undo counts, reset does not', () => {
  const { p, ctx, st: st0 } = setup('s3-002', SIZES[0], { hidden: true });
  const id = p.pieces[0].id;
  const shape = pieceOf(st0, id).tris;
  let st = st0;
  for (const m of ['flipLeft', 'cw90', 'cw180']) st = applyAction(st, { type: 'move', id, move: m }, ctx);
  assert.deepEqual(pieceOf(st, id).queue, ['flipLeft', 'cw90', 'cw180']);
  assert.equal(key(pieceOf(st, id).tris), key(shape));
  assert.equal(st.moves, 3);
  st = applyAction(st, { type: 'undo', id }, ctx);
  assert.deepEqual(pieceOf(st, id).queue, ['flipLeft', 'cw90']);
  assert.equal(st.moves, 4);
  st = applyAction(st, { type: 'reset', id }, ctx);
  assert.deepEqual(pieceOf(st, id).queue, []);
  assert.equal(st.moves, 4);
  st = applyAction(st, { type: 'undo', id }, ctx); // 빈 줄 되돌리기는 아무 일도 없음
  assert.equal(st.moves, 4);
});

test('hidden: drop over the board reveals the queue with the grabbed-quarter anchor', () => {
  for (const id of ['s3-001', 's3-017', 's4-003', 's4-033']) {
    const { p, ctx, st: st0 } = setup(id, SIZES[1], { hidden: true });
    for (const r of p.solutions[0]) {
      const seq = ELEM_MOVES[r.elem];
      let st = st0;
      for (const m of seq) st = applyAction(st, { type: 'move', id: r.id, move: m }, ctx);
      const pc = pieceOf(st, r.id);
      const want = translate(normalize(applyElem(p.pieces.find((q) => q.id === r.id).start, r.elem)), r.dx, r.dy);
      // 아무 사분이나 잡는다(마지막 사분): 결과에서 그 사분이 간 칸을 손가락 칸에 둔다
      const grab = pc.tris[pc.tris.length - 1];
      const res = revealResult(pc.tris, pc.mark, pc.queue, grab);
      const finger = [r.dx + res.grab[0], r.dy + res.grab[1]];
      const movesBefore = st.moves;
      const at = [finger[0] - res.grab[0], finger[1] - res.grab[1]];
      st = applyAction(st, { type: 'drop', id: r.id, at, finger, grab, over: true }, ctx);
      const after = pieceOf(st, r.id);
      assert.deepEqual(after.at, [r.dx, r.dy], `${id}/${r.id} ${r.elem}`);
      assert.equal(key(translate(after.tris, ...after.at)), key(want), `${id}/${r.id} shape`);
      assert.deepEqual(after.queue, []);
      assert.equal(st.moves, movesBefore, 'drop is not a move');
      assertConsistent(st, ctx, `${id}/${r.id}`);
    }
  }
});

test('hidden drop failure resets queue', () => {
  for (const size of SIZES) {
    const { p, ctx, st: st0 } = setup('s4-012', size, { hidden: true });
    const [a, b] = p.solutions[0];
    // b를 해답 자리에 먼저 놓는다
    const bShape = normalize(applyElem(p.pieces.find((q) => q.id === b.id).start, b.elem));
    let st = { ...st0, pieces: st0.pieces.map((q) => (q.id === b.id ? { ...q, tris: bShape, pos: [b.dx, b.dy], at: [b.dx, b.dy] } : q)) };
    const startPos = pieceOf(st, a.id).pos;
    // a에 이동을 잔뜩 쌓는다
    const seq = ['flipLeft', 'cw90', 'cw180', 'flipUp', 'ccw90', 'cw270', 'flipRight'];
    for (const m of seq) st = applyAction(st, { type: 'move', id: a.id, move: m }, ctx);
    const pc = pieceOf(st, a.id);
    const grab = pc.tris[0];
    const res = revealResult(pc.tris, pc.mark, pc.queue, grab);
    // b가 차지한 칸 위에 손가락을 둔다 → 겹쳐서 실패
    const bPlaced = translate(bShape, b.dx, b.dy);
    const finger = [bPlaced[0][0], bPlaced[0][1]];
    const moves = st.moves;
    st = applyAction(st, { type: 'drop', id: a.id, finger, grab, over: true, from: startPos }, ctx);
    const after = pieceOf(st, a.id);
    assert.deepEqual(after.queue, [], 'queue not emptied');
    assert.equal(after.at, null, 'failed piece stayed on board');
    assert.equal(key(after.tris), key(res.tris), 'revealed shape is the new start shape');
    assert.deepEqual(after.mark, res.mark);
    assert.equal(st.moves, moves, 'drop changed the move count');
    assertConsistent(st, ctx, `fail@${size.W}`);
    assert.deepEqual(pieceOf(st, b.id).at, [b.dx, b.dy], 'other piece disturbed');
    // 판정·이어지는 조작이 깨지지 않는다
    assert.equal(isSolved(p, st.pieces), false);
    assert.ok(wrongTris(p, st.pieces) instanceof Set);
    st = applyAction(st, { type: 'move', id: a.id, move: 'cw90' }, ctx);
    assert.deepEqual(pieceOf(st, a.id).queue, ['cw90']);
  }
});

test('hidden: drop away from the board keeps the queue and shape', () => {
  const { p, ctx, st: st0 } = setup('s3-005', SIZES[0], { hidden: true });
  const id = p.pieces[1].id;
  let st = applyAction(st0, { type: 'move', id, move: 'cw90' }, ctx);
  const pc = pieceOf(st, id);
  st = applyAction(st, { type: 'drop', id, at: [pc.pos[0], pc.pos[1] + 1], finger: [0, 0], grab: pc.tris[0], over: false }, ctx);
  assert.deepEqual(pieceOf(st, id).queue, ['cw90']);
  assert.equal(key(pieceOf(st, id).tris), key(pc.tris));
  assertConsistent(st, ctx, 'away');
  // 줄이 있는 조각은 드러나기 전에는 판에 올라가지 않는다(over가 아니어도)
  const spot = nearestFree(pc.tris, [0, 0], othersPlaced(st, id), ctx.bounds, ctx.board);
  assert.ok(spot);
  st = applyAction(st, { type: 'drop', id, at: spot, over: false }, ctx);
  assert.equal(pieceOf(st, id).at, null, 'unrevealed piece landed on the board');
  assert.deepEqual(pieceOf(st, id).queue, ['cw90']);
  assertConsistent(st, ctx, 'unrevealed');
});

test('refit pulls tray pieces back inside smaller bounds', () => {
  const p = byId('s4-020');
  const big = ctxFor(p, SIZES[0]);
  const small = { ...big.bounds, maxX: big.bounds.maxX - 2, maxY: big.bounds.maxY - 1 };
  const st = refit(initialState(p, big.bounds), { board: p.board, bounds: small });
  assertConsistent(st, { board: p.board, bounds: small }, 'refit');
  assert.deepEqual(clone(st), clone(refit(st, { board: p.board, bounds: small })));
});
