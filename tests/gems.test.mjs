// 조각 보석 모양(gems.js): 칸마다 보석 하나, 면 4개(사각) · 3개(삼각), 줄인 다각형이 뒤집히지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gemPolys, gemParts, insetPoly, tintTri } from '../src/view/gems.js';

const full = (x, y) => [0, 1, 2, 3].map((q) => [x, y, q]);
const area = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const count = (d) => (d.match(/M/g) || []).length;

test('gemPolys: one polygon per full cell, half cell is a triangle, opposite quarters split', () => {
  assert.equal(gemPolys([...full(0, 0), ...full(1, 0)], 40).length, 2);
  const half = gemPolys([[0, 0, 0], [0, 0, 1]], 40);
  assert.equal(half.length, 1);
  assert.equal(half[0].length, 3);
  assert.equal(gemPolys([[0, 0, 0], [0, 0, 2]], 40).length, 2);
  assert.equal(gemPolys([[0, 0, 0], [0, 0, 1], [0, 0, 2]], 40).length, 1);
});

test('insetPoly keeps orientation and shrinks', () => {
  const sq = [[0, 0], [40, 0], [40, 40], [0, 40]];
  const p = insetPoly(sq, 4);
  assert.deepEqual(p.map((v) => v.map((n) => Math.round(n))), [[4, 4], [36, 4], [36, 36], [4, 36]]);
});

test('gemParts: facets per edge, faces stay positive (no inverted bevel) for squares, halves and quarters', () => {
  for (const tris of [full(0, 0), [[0, 0, 0], [0, 0, 1]], [[0, 0, 3]], [[0, 0, 0], [0, 0, 1], [0, 0, 2]]]) {
    const parts = gemParts(tris, 44, '#4A90D9');
    assert.equal(count(parts.face), gemPolys(tris, 44).length);
    const facetCount = parts.facets.reduce((s, f) => s + count(f.d), 0);
    assert.equal(facetCount, gemPolys(tris, 44).reduce((s, p) => s + p.length, 0));
    // 가운데 면 넓이가 양수(시계 방향 유지)
    for (const m of parts.face.split('M').filter(Boolean)) {
      const pts = m.replace('Z', '').split('L').map((s) => s.split(',').map(Number));
      assert.ok(area(pts) > 0, `${JSON.stringify(tris)} face inverted`);
    }
    // 밝은 면과 어두운 면이 함께 있다
    assert.ok(parts.facets.length >= 2);
  }
});

test('gemParts output has no orientation mark (no circles, a single frame outline)', () => {
  const parts = gemParts([...full(0, 0), [1, 0, 3]], 44, '#E5533D');
  assert.deepEqual(Object.keys(parts).sort(), ['face', 'facets', 'frame', 'hi', 'rim']);
});

test('tintTri covers only the gem face (outer edge inset)', () => {
  assert.deepEqual(tintTri([0, 0, 0], 40, 0.1), [[4, 4], [36, 4], [20, 20]]);
});
