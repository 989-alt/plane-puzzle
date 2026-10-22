import test from 'node:test';
import assert from 'node:assert/strict';
import { key, translate, normalize, cell, half } from '../src/core/grid.js';
import { D4, applyElem, orientations } from '../src/core/pieces.js';
import { isSolved } from '../src/core/board.js';
import { solve, needs, minMovesOf } from '../src/core/solver.js';
import { lib, cells, U_BOARD, uPuzzle, placedFrom, shapeOf } from './fixtures.mjs';

const placeOf = (start, r) => translate(normalize(applyElem(start, r.elem)), r.dx, r.dy);
// 해답 동일성 = 조각마다 놓인 삼각형 집합이 같음.
const sigOf = (pieces, sol) => sol.map((r) => `${r.id}:${key(placeOf(pieces.find((p) => p.id === r.id).start, r))}`).join('|');
const sortedJSON = (sols) => sols.map((s) => JSON.stringify(s)).sort();

// solve와 독립인 무식한 열거: 조각마다 8원소 모양(중복 제거) x 판 경계 상자 안 모든 평행이동.
function bruteForce(board, pieces) {
  const boardSet = new Set(board.map((t) => key([t])));
  const xs = board.map((t) => t[0]);
  const ys = board.map((t) => t[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const options = pieces.map((p) => {
    const shapes = new Map();
    for (const e of D4) {
      const s = normalize(applyElem(p.start, e));
      shapes.set(key(s), s);
    }
    const out = [];
    for (const s of shapes.values()) {
      for (let dy = y0 - 2; dy <= y1 + 2; dy++) {
        for (let dx = x0 - 2; dx <= x1 + 2; dx++) {
          const t = translate(s, dx, dy);
          const ks = t.map((q) => key([q]));
          if (ks.every((k) => boardSet.has(k))) out.push({ ks, sig: `${p.id}:${key(t)}` });
        }
      }
    }
    return out;
  });
  const found = new Set();
  const used = new Set();
  const sigs = [];
  (function rec(i) {
    if (i === pieces.length) {
      if (used.size === boardSet.size) found.add(sigs.join('|'));
      return;
    }
    for (const o of options[i]) {
      if (o.ks.some((k) => used.has(k))) continue;
      o.ks.forEach((k) => used.add(k));
      sigs.push(o.sig);
      rec(i + 1);
      sigs.pop();
      o.ks.forEach((k) => used.delete(k));
    }
  })(0);
  return found;
}

function checkAgainstBrute(board, pieces) {
  const sols = solve(board, pieces);
  const sigs = sols.map((s) => sigOf(pieces, s));
  assert.equal(new Set(sigs).size, sigs.length, 'solutions distinct');
  assert.deepEqual(new Set(sigs), bruteForce(board, pieces));
  for (const sol of sols) {
    assert.deepEqual(sol.map((r) => r.id), pieces.map((p) => p.id), 'records in piece order');
    for (const r of sol) {
      assert.deepEqual(Object.keys(r).sort(), ['dx', 'dy', 'elem', 'id']);
      assert.ok(Number.isInteger(r.dx) && Number.isInteger(r.dy));
      const g = orientations(pieces.find((p) => p.id === r.id).start).find((o) => o.elems.includes(r.elem));
      assert.equal(r.elem, g.elems[0], 'elem is the first element of its orientation group');
    }
    assert.equal(isSolved({ board, pieces }, placedFrom({ pieces }, sol)), true);
  }
  return sols;
}

test('solve: U board (L4 + I3, 7 cells) has exactly the 2 hand-made solutions', () => {
  const pz = uPuzzle();
  const sols = solve(pz.board, pz.pieces);
  assert.equal(sols.length, 2);
  assert.deepEqual(sortedJSON(sols), sortedJSON(pz.solutions));
  checkAgainstBrute(pz.board, pz.pieces);
});

test('solve: elem is relative to start (start given in another orientation and position)', () => {
  // L4 시작을 fx로, I3 시작을 세로로. 해답은 같은 자리지만 elem이 달라진다.
  const pz = uPuzzle({ l4Start: translate(shapeOf(lib('L4'), 'fx'), 4, 7), i3Start: shapeOf(lib('I3'), 'r90') });
  const sols = checkAgainstBrute(pz.board, pz.pieces);
  assert.equal(sols.length, 2);
  const want = new Set(uPuzzle().solutions.map((s) => sigOf(uPuzzle().pieces, s)));
  assert.deepEqual(new Set(sols.map((s) => sigOf(pz.pieces, s))), want);
  // I3 세로 -> 가로 묶음 {r90, r270, fx_r90, fx_r270}의 첫 원소
  for (const s of sols) assert.equal(s[1].elem, 'r90');
});

test('solve: 2x1 rectangle = trap + tS has 4 solutions', () => {
  const pieces = [{ id: 't', start: lib('trap') }, { id: 's', start: lib('tS') }];
  assert.equal(checkAgainstBrute(cells([[0, 0], [1, 0]]), pieces).length, 4);
});

test('solve: 2x2 square = two big triangles has 4 solutions (2 diagonals x 2 assignments)', () => {
  const pieces = [{ id: 'p', start: lib('tB') }, { id: 'q', start: lib('tB') }];
  assert.equal(checkAgainstBrute(cells([[0, 0], [1, 0], [0, 1], [1, 1]]), pieces).length, 4);
});

test('solve matches brute force on mixed triangle/cell boards', () => {
  const sq = cells([[0, 0], [1, 0], [0, 1], [1, 1]]);
  const mix = [
    { id: 'b', start: shapeOf(lib('tB'), 'r90') },
    { id: 'p', start: lib('para') },
    { id: 's', start: lib('tS') },
    { id: 't', start: shapeOf(lib('tS'), 'r180') },
  ];
  assert.ok(checkAgainstBrute(sq, mix).length > 0);

  const sq3 = cells([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]);
  const three = [
    { id: 'l', start: shapeOf(lib('L3'), 'fx') },
    { id: 'm', start: lib('L3') },
    { id: 'i', start: lib('I3') },
  ];
  assert.ok(checkAgainstBrute(sq3, three).length > 0);

  // 칸 + 반 칸이 섞인 판: 깃발(0,0) + 장화(0,2) + 작은 삼각형(1,1 왼쪽 위 반)을 합쳐 만든 판(풀림이 보장됨)
  const odd = [...lib('flag'), ...translate(lib('boot'), 0, 2), ...half(1, 1, 'NW')];
  const tri = [
    { id: 'f', start: shapeOf(lib('flag'), 'r90') },
    { id: 'o', start: shapeOf(lib('boot'), 'fx_r270') },
    { id: 'z', start: lib('tS') },
  ];
  assert.ok(checkAgainstBrute(odd, tri).length > 0);
});

test('solve: 4 cell pieces on a 4x4 board match brute force', () => {
  const b = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) b.push([x, y]);
  const pieces = [
    { id: 'a', start: lib('L4') },
    { id: 'b', start: shapeOf(lib('L4'), 'r180') },
    { id: 'c', start: lib('O4') },
    { id: 'd', start: lib('T4') },
  ];
  // 이 조합은 4x4를 못 덮는다: 해답 없음을 두 방법이 똑같이 말하는지 확인
  assert.equal(checkAgainstBrute(cells(b), pieces).length, 0);
  const pieces2 = [
    { id: 'a', start: lib('L4') },
    { id: 'b', start: lib('L4') },
    { id: 'c', start: lib('O4') },
    { id: 'd', start: lib('O4') },
  ];
  assert.ok(checkAgainstBrute(cells(b), pieces2).length > 0);
});

test('solve: area mismatch or impossible board gives no solutions', () => {
  assert.deepEqual(solve(U_BOARD, [{ id: 'a', start: lib('L4') }]), []);
  assert.deepEqual(solve(U_BOARD, [{ id: 'a', start: lib('L4') }, { id: 'b', start: lib('L3') }]), []);
  // 넓이는 같지만 모양이 안 맞음: 1x7 줄에 L4 + I3
  const line = cells([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]);
  assert.deepEqual(solve(line, uPuzzle().pieces), []);
});

test('solve: empty board and no pieces', () => {
  assert.deepEqual(solve([], []), [[]]);
  assert.deepEqual(solve([], [{ id: 'a', start: [] }]), []);
  assert.deepEqual(solve(cell(0, 0), [{ id: 'a', start: [] }]), []);
});

test('solve: limit caps the number of solutions', () => {
  const sq = cells([[0, 0], [1, 0], [0, 1], [1, 1]]);
  const pieces = [{ id: 'p', start: lib('tB') }, { id: 'q', start: lib('tB') }];
  assert.equal(solve(sq, pieces, { limit: 2 }).length, 2);
  assert.equal(solve(sq, pieces, { limit: 1 }).length, 1);
  assert.equal(solve(sq, pieces, {}).length, 4);
});

test('solve: does not mutate inputs and is deterministic', () => {
  const pz = uPuzzle();
  const before = JSON.stringify([pz.board, pz.pieces]);
  const a = solve(pz.board, pz.pieces);
  const b = solve(pz.board, pz.pieces);
  assert.equal(JSON.stringify([pz.board, pz.pieces]), before);
  assert.deepEqual(a, b);
});

// ---- needs ----

const onePiece = (libId, startElem, targetElem = 'id') => {
  const target = shapeOf(lib(libId), targetElem);
  const pieces = [{ id: 'x', lib: libId, start: shapeOf(lib(libId), startElem) }];
  const pz = { board: target, pieces };
  pz.solutions = solve(pz.board, pieces);
  return pz;
};

test('needs: single L4 board, start = fx -> flip true, turn false', () => {
  const pz = onePiece('L4', 'fx');
  assert.equal(pz.solutions.length, 1);
  assert.deepEqual(needs(pz), { x: { flip: true, turn: false } });
  assert.equal(minMovesOf(pz), 1);
});

test('needs: single L4 board, other starts', () => {
  // 시작 = 목표: 아무 이동 없음
  assert.deepEqual(needs(onePiece('L4', 'id')), { x: { flip: false, turn: false } });
  // 시작 = r90: 되돌리는 원소는 r270 하나 -> 돌리기 필요, 뒤집기 아님
  assert.deepEqual(needs(onePiece('L4', 'r90')), { x: { flip: false, turn: true } });
  // 시작 = fx_r90: 되돌리는 원소는 fx_r90(대각선 뒤집기) -> 둘 다
  assert.deepEqual(needs(onePiece('L4', 'fx_r90')), { x: { flip: true, turn: true } });
  // 시작 = fx_r180(위쪽·아래쪽 뒤집기): 되돌리는 원소 fx_r180 -> 뒤집기만
  assert.deepEqual(needs(onePiece('L4', 'fx_r180')), { x: { flip: true, turn: false } });
  assert.equal(minMovesOf(onePiece('L4', 'fx_r90')), 2);
  assert.equal(minMovesOf(onePiece('L4', 'id')), 0);
});

test('needs: symmetric pieces use every element that makes the shape', () => {
  // tS(NE 반) 묶음: NE{id,fx_r90} SE{r90,fx_r180} SW{r180,fx_r270} NW{r270,fx}
  assert.deepEqual(needs(onePiece('tS', 'id', 'fx')), { x: { flip: false, turn: false } }); // NW: fx로 가능
  assert.deepEqual(needs(onePiece('tS', 'id', 'r180')), { x: { flip: false, turn: true } }); // SW: r180 또는 fx_r270
  assert.deepEqual(needs(onePiece('tS', 'id', 'r90')), { x: { flip: false, turn: false } }); // SE: fx_r180으로 가능
  // para 묶음: {id,r180} {r90,r270} {fx,fx_r180} {fx_r90,fx_r270}
  assert.deepEqual(needs(onePiece('para', 'id', 'fx')), { x: { flip: true, turn: false } });
  assert.deepEqual(needs(onePiece('para', 'id', 'fx_r90')), { x: { flip: true, turn: true } });
  assert.deepEqual(needs(onePiece('para', 'id', 'r180')), { x: { flip: false, turn: false } });
  assert.equal(minMovesOf(onePiece('para', 'id', 'fx_r90')), 2);
  assert.equal(minMovesOf(onePiece('tS', 'id', 'r180')), 1);
});

test('needs: true only if it holds in every solution', () => {
  // U판: L4는 해답1 r90(돌리기), 해답2 fx_r90(뒤집기+돌리기) -> flip은 한 해답에서만 -> false, turn은 둘 다 -> true
  const pz = uPuzzle();
  assert.deepEqual(needs(pz), { a: { flip: false, turn: true }, b: { flip: false, turn: false } });
  // I3를 세로로 시작하면 두 해답 모두 돌리기 필요
  const pz2 = uPuzzle({ i3Start: shapeOf(lib('I3'), 'r90') });
  pz2.solutions = solve(pz2.board, pz2.pieces);
  assert.deepEqual(needs(pz2), { a: { flip: false, turn: true }, b: { flip: false, turn: true } });
  // L4를 fx_r90(아래 ㄴ자 모양)으로 시작: 아래 ㄴ자 해답은 이동 없음(id), 위 ㄱ자 해답은 fx_r180(위쪽·아래쪽 뒤집기)
  // -> 뒤집기는 한 해답에서만, 돌리기는 어디에서도 필요 없음
  const pz3 = uPuzzle({ l4Start: shapeOf(lib('L4'), 'fx_r90') });
  pz3.solutions = solve(pz3.board, pz3.pieces);
  assert.deepEqual(needs(pz3).a, { flip: false, turn: false });
  assert.equal(minMovesOf(pz3), 0);
});

test('needs reads the shape, not the stored elem name', () => {
  // para fx 모양을 fx_r180으로 저장해도 같은 판정
  const p = lib('para');
  const pz = {
    board: shapeOf(p, 'fx'),
    pieces: [{ id: 'x', start: p }],
    solutions: [[{ id: 'x', elem: 'fx_r180', dx: 0, dy: 0 }]],
  };
  assert.deepEqual(needs(pz), { x: { flip: true, turn: false } });
  assert.equal(minMovesOf(pz), 1);
});

test('needs: a solution without a record for the piece counts as not needed', () => {
  const pz = onePiece('L4', 'fx');
  pz.pieces.push({ id: 'y', start: lib('I3') });
  assert.deepEqual(needs(pz).y, { flip: false, turn: false });
  assert.deepEqual(needs(pz).x, { flip: true, turn: false });
});

test('needs / minMovesOf with no solutions', () => {
  const pz = { board: [], pieces: [{ id: 'x', start: lib('L4') }], solutions: [] };
  assert.deepEqual(needs(pz), { x: { flip: false, turn: false } });
  assert.equal(minMovesOf(pz), Infinity);
});

// ---- minMovesOf ----

test('minMovesOf: minimum over solutions of the sum of pieceMoves', () => {
  // 기본 시작: 해답1 = L4 r90(1) + I3 id(0) = 1, 해답2 = L4 fx_r90(2) + I3 0 = 2 -> 1
  assert.equal(minMovesOf(uPuzzle()), 1);
  // I3 세로 시작: 해답1 = 1 + 1 = 2, 해답2 = 2 + 1 = 3 -> 2
  const pz = uPuzzle({ i3Start: shapeOf(lib('I3'), 'r90') });
  pz.solutions = solve(pz.board, pz.pieces);
  assert.equal(minMovesOf(pz), 2);
  // L4 fx 시작: 위 ㄱ자 = r90(기본) -> fx(기본)에서 fx_r90(2번), 아래 ㄴ자 = fx_r90(기본) -> fx(기본)에서 r90(1번). 최소 1.
  const pz2 = uPuzzle({ l4Start: shapeOf(lib('L4'), 'fx') });
  pz2.solutions = solve(pz2.board, pz2.pieces);
  assert.equal(minMovesOf(pz2), 1);
});

test('minMovesOf with a single cell O4 (all elements same shape) is 0', () => {
  const pz = { board: lib('O4'), pieces: [{ id: 'o', start: lib('O4') }] };
  pz.solutions = solve(pz.board, pz.pieces);
  assert.equal(pz.solutions.length, 1);
  assert.equal(minMovesOf(pz), 0);
  assert.deepEqual(needs(pz), { o: { flip: false, turn: false } });
});
