import test from 'node:test';
import assert from 'node:assert/strict';
import { key, translate, normalize, cell } from '../src/core/grid.js';
import { applyElem } from '../src/core/pieces.js';
import { placedTris, canPlace, isSolved, wrongTris } from '../src/core/board.js';
import { lib, cells, U_BOARD, uPuzzle, placedFrom, shapeOf } from './fixtures.mjs';

const keysOf = (tris) => new Set(tris.map((t) => key([t])));

test('placedTris = translate(normalize(tris), dx, dy)', () => {
  const L4 = lib('L4');
  const raw = applyElem(L4, 'r90'); // 정규화 안 된 절대 위치
  assert.equal(key(placedTris({ tris: raw, at: [3, -2] })), key(translate(normalize(raw), 3, -2)));
  assert.equal(key(placedTris({ tris: L4, at: [0, 0] })), key(L4));
  // 같은 모양이면 어디에 있던 tris든 at이 정규화 모양의 최소 모서리 위치다.
  assert.equal(key(placedTris({ tris: translate(L4, 9, 9), at: [1, 1] })), key(translate(L4, 1, 1)));
});

test('placedTris does not mutate input', () => {
  const tris = [[5, 5, 0], [5, 5, 1]];
  placedTris({ tris, at: [1, 1] });
  assert.deepEqual(tris, [[5, 5, 0], [5, 5, 1]]);
});

test('canPlace: inside and free is true', () => {
  const I3 = translate(lib('I3'), 0, 0);
  assert.equal(canPlace(U_BOARD, [], I3), true);
  assert.equal(canPlace(U_BOARD, [translate(lib('I3'), 0, 2)], I3), true);
});

test('canPlace: off board is false', () => {
  assert.equal(canPlace(U_BOARD, [], translate(lib('I3'), 0, 1)), false); // 가운데 줄은 (0,1)만 판
  assert.equal(canPlace(U_BOARD, [], translate(lib('I3'), 1, 0)), false); // 오른쪽으로 삐져나감
  assert.equal(canPlace(U_BOARD, [], [[0, 0, 0], [-1, 0, 1]]), false);
  // 칸 안 사분 삼각형 하나만 판 밖이어도 false
  assert.equal(canPlace([[0, 0, 0], [0, 0, 1]], [], [[0, 0, 1], [0, 0, 2]]), false);
});

test('canPlace: overlap with another piece is false (even one quarter)', () => {
  const top = translate(lib('I3'), 0, 0);
  assert.equal(canPlace(U_BOARD, [top], top), false);
  assert.equal(canPlace(U_BOARD, [[[2, 0, 3]]], top), false);
  assert.equal(canPlace(U_BOARD, [[[0, 1, 0]], top], cell(0, 1)), false);
  assert.equal(canPlace(U_BOARD, [[[0, 1, 0]]], [[0, 1, 2]]), true);
});

test('canPlace: others may also be one flat Tri list', () => {
  const top = translate(lib('I3'), 0, 0);
  assert.equal(canPlace(U_BOARD, top, cell(1, 0)), false);
  assert.equal(canPlace(U_BOARD, top, cell(0, 1)), true);
});

test('judge accepts every stored solution', () => {
  const pz = uPuzzle();
  for (const sol of pz.solutions) assert.equal(isSolved(pz, placedFrom(pz, sol)), true, JSON.stringify(sol));
});

test('isSolved false when a piece is off by one cell', () => {
  const pz = uPuzzle();
  for (const sol of pz.solutions) {
    for (let i = 0; i < sol.length; i++) {
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const placed = placedFrom(pz, sol);
        placed[i] = { ...placed[i], at: [placed[i].at[0] + ox, placed[i].at[1] + oy] };
        assert.equal(isSolved(pz, placed), false);
      }
    }
  }
});

test('isSolved false for wrong orientation, missing piece, or tray piece', () => {
  const pz = uPuzzle();
  const placed = placedFrom(pz, pz.solutions[0]);
  // L4를 다른 방향(r270)으로 같은 자리에
  assert.equal(isSolved(pz, [{ ...placed[0], tris: shapeOf(lib('L4'), 'r270') }, placed[1]]), false);
  assert.equal(isSolved(pz, [placed[0]]), false);
  assert.equal(isSolved(pz, [placed[0], { ...placed[1], at: null }]), false);
  assert.equal(isSolved(pz, []), false);
});

test('isSolved false when union equals board but pieces overlap', () => {
  // 판 2칸, 조각 셋: 두 칸 다 덮지만 한 칸이 겹침
  const pz = { board: cells([[0, 0], [1, 0]]), pieces: [], solutions: [] };
  const placed = [
    { id: 'p', tris: cell(0, 0), at: [0, 0] },
    { id: 'q', tris: cell(0, 0), at: [1, 0] },
    { id: 'r', tris: cell(0, 0), at: [1, 0] },
  ];
  assert.equal(isSolved(pz, placed), false);
  assert.equal(isSolved(pz, placed.slice(0, 2)), true);
});

test('wrongTris empty for every stored solution (alt solution included)', () => {
  const pz = uPuzzle();
  for (const sol of pz.solutions) assert.equal(wrongTris(pz, placedFrom(pz, sol)).size, 0);
});

test('wrongTris empty when pieces sit on spots from different solutions', () => {
  // I3는 해답2의 자리(윗줄), L4는 해답1의 자리(위 ㄱ자): 겹치지만 둘 다 어떤 해답의 자기 자리다.
  const pz = uPuzzle();
  const p1 = placedFrom(pz, pz.solutions[0]);
  const p2 = placedFrom(pz, pz.solutions[1]);
  assert.equal(wrongTris(pz, [p1[0], p2[1]]).size, 0);
});

test('wrongTris marks off-board and never-used triangles only', () => {
  const pz = uPuzzle();
  const p1 = placedFrom(pz, pz.solutions[0]);
  // L4(ㄱ자)를 한 칸 아래로: (0,1)(1,1)(2,1)(0,2). (1,1)(2,1)은 판 밖, (0,1)(0,2)는 해답2의 L4 자리.
  const shifted = [{ ...p1[0], at: [0, 1] }];
  assert.deepEqual(wrongTris(pz, shifted), keysOf(cells([[1, 1], [2, 1]])));
  // I3를 세로로 왼쪽 열에: (0,0) 해답2 자리, (0,2) 해답1 자리, (0,1)은 어떤 해답에서도 I3 자리가 아님.
  const vertical = [{ id: 'b', tris: shapeOf(lib('I3'), 'r90'), at: [0, 0] }];
  assert.deepEqual(wrongTris(pz, vertical), keysOf(cell(0, 1)));
});

test('wrongTris checks per quarter, not per cell', () => {
  // 판 1칸을 tS 두 개(오른쪽 위 반, 왼쪽 아래 반)로 덮는 해답 하나.
  const tS = lib('tS'); // NE 반
  const pz = {
    board: cell(0, 0),
    pieces: [{ id: 'p', start: tS }, { id: 'q', start: tS }],
    solutions: [[{ id: 'p', elem: 'id', dx: 0, dy: 0 }, { id: 'q', elem: 'r180', dx: 0, dy: 0 }]],
  };
  // p를 NW 반(r270)으로 놓으면: N은 p 자리, W는 q 자리일 뿐 p 자리가 아님.
  const placed = [{ id: 'p', tris: shapeOf(tS, 'r270'), at: [0, 0] }];
  assert.deepEqual(wrongTris(pz, placed), new Set([key([[0, 0, 3]])]));
});

test('wrongTris ignores tray pieces and returns string keys', () => {
  const pz = uPuzzle();
  assert.equal(wrongTris(pz, [{ id: 'a', tris: lib('L4'), at: null }]).size, 0);
  const w = wrongTris(pz, [{ id: 'b', tris: lib('I3'), at: [5, 5] }]);
  assert.equal(w.size, 12);
  for (const k of w) assert.equal(typeof k, 'string');
});
