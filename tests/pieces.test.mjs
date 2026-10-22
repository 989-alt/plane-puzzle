import test from 'node:test';
import assert from 'node:assert/strict';
import { rotCW, flipLR, flipUD, normalize, key, translate, cell, half } from '../src/core/grid.js';
import {
  MOVES, applyMove, D4, applyElem, MIN_MOVES, orientations, LIBRARY, pieceMoves,
} from '../src/core/pieces.js';

const piece = (id) => {
  const p = LIBRARY.find((x) => x.id === id);
  assert.ok(p, `missing piece ${id}`);
  return p.tris;
};
const transpose = (tris) => normalize(rotCW(rotCW(rotCW(flipLR(tris))))); // (x,y) -> (y,x)

// 변을 공유하는 이웃 사분 삼각형.
function neighbors([x, y, q]) {
  const out = [[x, y, (q + 1) % 4], [x, y, (q + 3) % 4]];
  if (q === 0) out.push([x, y - 1, 2]);
  if (q === 1) out.push([x + 1, y, 3]);
  if (q === 2) out.push([x, y + 1, 0]);
  if (q === 3) out.push([x - 1, y, 1]);
  return out;
}
function connected(tris) {
  const all = new Set(tris.map((t) => t.join(',')));
  const seen = new Set([tris[0].join(',')]);
  const stack = [tris[0]];
  while (stack.length) {
    for (const n of neighbors(stack.pop())) {
      const k = n.join(',');
      if (all.has(k) && !seen.has(k)) { seen.add(k); stack.push(n); }
    }
  }
  return seen.size === all.size;
}

test('MOVES list', () => {
  assert.deepEqual(MOVES, ['flipUp', 'flipDown', 'flipLeft', 'flipRight', 'cw90', 'cw180', 'cw270', 'ccw90', 'ccw180', 'ccw270']);
});

test('D4 and MIN_MOVES', () => {
  assert.deepEqual(D4, ['id', 'r90', 'r180', 'r270', 'fx', 'fx_r90', 'fx_r180', 'fx_r270']);
  assert.deepEqual(MIN_MOVES, { id: 0, r90: 1, r180: 1, r270: 1, fx: 1, fx_r180: 1, fx_r90: 2, fx_r270: 2 });
});

test('applyElem definitions', () => {
  const L4 = piece('L4');
  assert.equal(key(applyElem(L4, 'id')), key(L4));
  assert.equal(key(applyElem(L4, 'r90')), key(rotCW(L4)));
  assert.equal(key(applyElem(L4, 'fx')), key(flipLR(L4)));
  assert.equal(key(applyElem(L4, 'fx_r90')), key(rotCW(flipLR(L4))));
  assert.equal(key(normalize(applyElem(L4, 'fx_r180'))), key(normalize(flipUD(L4))));
  assert.equal(key(normalize(applyElem(L4, 'fx_r270'))), key(transpose(L4)));
  assert.throws(() => applyElem(L4, 'nope'));
});

test('applyElem keeps absolute position (no normalize) so a grabbed tri can be tracked', () => {
  assert.deepEqual(applyElem([[2, 5, 0]], 'r90'), rotCW([[2, 5, 0]]));
});

test('orientations counts L4=8 O4=1 T4=4', () => {
  assert.equal(orientations(piece('L4')).length, 8);
  assert.equal(orientations(piece('O4')).length, 1);
  assert.equal(orientations(piece('T4')).length, 4);
});

test('orientations groups cover D4 exactly once, first group has id', () => {
  for (const p of LIBRARY) {
    const os = orientations(p.tris);
    assert.deepEqual(os.flatMap((o) => o.elems).sort(), [...D4].sort(), p.id);
    assert.ok(os[0].elems.includes('id'));
    assert.equal(key(os[0].tris), key(normalize(p.tris)));
    for (const o of os) {
      for (const e of o.elems) assert.equal(key(normalize(applyElem(p.tris, e))), key(o.tris), `${p.id} ${e}`);
    }
    assert.equal(new Set(os.map((o) => key(o.tris))).size, os.length, `${p.id} groups distinct`);
  }
});

test('applyMove flipLeft == flipRight, flipUp == flipDown', () => {
  for (const p of LIBRARY) {
    assert.deepEqual(applyMove(p.tris, 'flipLeft'), applyMove(p.tris, 'flipRight'));
    assert.deepEqual(applyMove(p.tris, 'flipUp'), applyMove(p.tris, 'flipDown'));
  }
});

test('applyMove semantics and normalize', () => {
  const L4 = translate(piece('L4'), 5, 9);
  assert.deepEqual(applyMove(L4, 'flipLeft'), normalize(flipLR(L4)));
  assert.deepEqual(applyMove(L4, 'flipUp'), normalize(flipUD(L4)));
  assert.deepEqual(applyMove(L4, 'cw90'), normalize(rotCW(L4)));
  assert.deepEqual(applyMove(L4, 'cw180'), normalize(rotCW(rotCW(L4))));
  assert.deepEqual(applyMove(L4, 'cw270'), normalize(rotCW(rotCW(rotCW(L4)))));
  assert.deepEqual(applyMove(L4, 'ccw90'), applyMove(L4, 'cw270'));
  assert.deepEqual(applyMove(L4, 'ccw180'), applyMove(L4, 'cw180'));
  assert.deepEqual(applyMove(L4, 'ccw270'), applyMove(L4, 'cw90'));
  assert.throws(() => applyMove(L4, 'jump'));
});

test('each move costs exactly MIN_MOVES of its element (1 move => cost 1 or 0)', () => {
  const L4 = piece('L4');
  for (const m of MOVES) assert.equal(pieceMoves(L4, applyMove(L4, m)), 1, m);
});

test('pieceMoves L4', () => {
  const L4 = piece('L4');
  assert.equal(pieceMoves(L4, L4), 0);
  assert.equal(pieceMoves(L4, translate(L4, 3, 3)), 0);
  assert.equal(pieceMoves(L4, flipLR(L4)), 1);
  assert.equal(pieceMoves(L4, transpose(L4)), 2);
  assert.equal(pieceMoves(L4, rotCW(flipLR(L4))), 2);
  assert.equal(pieceMoves(L4, flipUD(L4)), 1);
});

test('pieceMoves uses the cheapest element for symmetric pieces', () => {
  // T4는 좌우 대칭이라 전치(2번)와 같은 모양이 돌리기 1번으로도 나온다.
  const T4 = piece('T4');
  assert.equal(pieceMoves(T4, transpose(T4)), 1);
  assert.equal(pieceMoves(T4, flipLR(T4)), 0);
  assert.equal(pieceMoves(piece('O4'), transpose(piece('O4'))), 0);
});

test('pieceMoves null for different shapes', () => {
  assert.equal(pieceMoves(piece('L4'), piece('T4')), null);
  assert.equal(pieceMoves(piece('L4'), piece('S4')), null);
});

test('tS and para have 4 orientations', () => {
  assert.equal(orientations(piece('tS')).length, 4);
  assert.equal(orientations(piece('para')).length, 4);
});

test('para is a genuine parallelogram: 180 symmetric, not flip symmetric', () => {
  const os = orientations(piece('para'));
  const idGroup = os.find((o) => o.elems.includes('id')).elems;
  assert.ok(idGroup.includes('r180'));
  assert.ok(!idGroup.includes('fx'));
  assert.ok(!idGroup.includes('fx_r180'));
});

test('tB is a right isosceles triangle with legs 2', () => {
  const tB = piece('tB');
  assert.equal(tB.length, 8);
  // 2x2 정사각형 안에서, 직각 꼭짓점이 (0,2)(왼쪽 아래)일 때 빗변 y=x 아래쪽에 있는 사분 삼각형 전부.
  const expected = [];
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      for (let q = 0; q < 4; q++) {
        const c = [[0.5, 1 / 6], [5 / 6, 0.5], [0.5, 5 / 6], [1 / 6, 0.5]][q];
        if (y + c[1] > x + c[0]) expected.push([x, y, q]);
      }
    }
  }
  assert.equal(expected.length, 8);
  const os = orientations(tB);
  assert.ok(os.some((o) => key(o.tris) === key(normalize(expected))), 'tB matches the triangle under some orientation');
  const n = normalize(tB);
  assert.equal(Math.max(...n.map((t) => t[0])), 1);
  assert.equal(Math.max(...n.map((t) => t[1])), 1);
  assert.equal(os.length, 4);
});

test('library ids and kinds', () => {
  const ids = LIBRARY.map((p) => p.id);
  assert.deepEqual(ids, ['L3', 'L4', 'S4', 'T4', 'I3', 'O4', 'P5', 'F5', 'N5', 'Y5', 'L5', 'U5', 'V5', 'tS', 'tB', 'para', 'trap', 'flag', 'boot']);
  for (const p of LIBRARY) assert.equal(p.kind, p.id.startsWith('t') || ['para', 'trap', 'flag', 'boot'].includes(p.id) ? 'tri' : 'cell', p.id);
});

test('cell pieces have whole cells with the expected cell counts', () => {
  const sizes = { L3: 3, L4: 4, S4: 4, T4: 4, I3: 3, O4: 4, P5: 5, F5: 5, N5: 5, Y5: 5, L5: 5, U5: 5, V5: 5 };
  for (const p of LIBRARY.filter((x) => x.kind === 'cell')) {
    assert.equal(p.tris.length, sizes[p.id] * 4, p.id);
    const cells = new Set(p.tris.map(([x, y]) => `${x},${y}`));
    assert.equal(cells.size, sizes[p.id], p.id);
  }
});

test('tri piece quarter counts', () => {
  const sizes = { tS: 2, tB: 8, para: 4, trap: 6, flag: 10, boot: 14 };
  for (const [id, n] of Object.entries(sizes)) assert.equal(piece(id).length, n, id);
});

test('orientation counts for every library piece; symmetric = count < 8', () => {
  const want = { L3: 4, L4: 8, S4: 4, T4: 4, I3: 2, O4: 1, P5: 8, F5: 8, N5: 8, Y5: 8, L5: 8, U5: 4, V5: 4, tS: 4, tB: 4, para: 4, trap: 8, flag: 8, boot: 8 };
  for (const p of LIBRARY) {
    const n = orientations(p.tris).length;
    assert.equal(n, want[p.id], p.id);
    assert.equal(p.symmetric, n < 8, p.id);
  }
});

test('every library piece: even quarter count, no duplicates, normalized, edge-connected', () => {
  for (const p of LIBRARY) {
    assert.equal(p.tris.length % 2, 0, p.id);
    assert.equal(new Set(p.tris.map((t) => t.join(','))).size, p.tris.length, p.id);
    assert.deepEqual(p.tris, normalize(p.tris), p.id);
    assert.ok(connected(p.tris), `${p.id} connected`);
  }
});

test('connected helper rejects a split shape', () => {
  assert.ok(!connected([...half(0, 0, 'NE'), ...half(5, 5, 'NE')]));
  assert.ok(!connected([[0, 0, 0], [0, 0, 2]]));
  assert.ok(connected([[0, 0, 1], [1, 0, 3]]));
  assert.ok(connected(cell(0, 0)));
});

test('no two library pieces are the same shape (mirror images excluded)', () => {
  for (let i = 0; i < LIBRARY.length; i++) {
    for (let j = i + 1; j < LIBRARY.length; j++) {
      assert.equal(pieceMoves(LIBRARY[i].tris, LIBRARY[j].tris), null, `${LIBRARY[i].id} vs ${LIBRARY[j].id}`);
    }
  }
});
