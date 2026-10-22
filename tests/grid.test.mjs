import test from 'node:test';
import assert from 'node:assert/strict';
import { rotCW, flipLR, flipUD, normalize, key, translate, cell, half, connected } from '../src/core/grid.js';

const L4 = [[0, 0], [0, 1], [0, 2], [1, 2]].flatMap(([x, y]) => cell(x, y));
const MIX = [...cell(0, 0), ...half(1, 0, 'SW'), [0, 1, 0]];

// 사분 삼각형의 무게중심(화면 좌표, y 아래로 증가). 변환이 실제 기하와 맞는지 확인하는 데 쓴다.
function centroid([x, y, q]) {
  const c = [[0.5, 1 / 6], [5 / 6, 0.5], [0.5, 5 / 6], [1 / 6, 0.5]][q];
  return [x + c[0], y + c[1]];
}
const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

test('rotCW four times returns original shape', () => {
  for (const s of [L4, MIX]) {
    assert.deepEqual(normalize(rotCW(rotCW(rotCW(rotCW(s))))), normalize(s));
  }
});

test('rotCW four times is exact identity (no drift)', () => {
  assert.equal(key(rotCW(rotCW(rotCW(rotCW(MIX))))), key(MIX));
});

test('flipLR twice returns original', () => {
  assert.equal(key(flipLR(flipLR(L4))), key(L4));
  assert.equal(key(flipLR(flipLR(MIX))), key(MIX));
});

test('flipUD twice returns original', () => {
  assert.equal(key(flipUD(flipUD(MIX))), key(MIX));
});

test('flipUD equals rotCW^2 after flipLR', () => {
  for (const s of [L4, MIX]) {
    assert.deepEqual(normalize(flipUD(s)), normalize(rotCW(rotCW(flipLR(s)))));
  }
});

test('rotCW cell mapping (x,y)->(-y-1,x), q->q+1', () => {
  assert.deepEqual(rotCW([[2, 5, 0], [2, 5, 3]]), [[-6, 2, 1], [-6, 2, 0]]);
});

test('flip cell mappings', () => {
  assert.deepEqual(flipLR([[2, 5, 1], [2, 5, 0]]), [[-3, 5, 3], [-3, 5, 0]]);
  assert.deepEqual(flipUD([[2, 5, 0], [2, 5, 1]]), [[2, -6, 2], [2, -6, 1]]);
});

test('transforms match real geometry (centroids)', () => {
  // 화면에서 시계 방향 90°: (px,py) -> (-py, px). 좌우 뒤집기: px -> -px. 상하 뒤집기: py -> -py.
  for (let q = 0; q < 4; q++) {
    const t = [3, -2, q];
    const [px, py] = centroid(t);
    assert.ok(near(centroid(rotCW([t])[0]), [-py, px]), `rotCW q=${q}`);
    assert.ok(near(centroid(flipLR([t])[0]), [-px, py]), `flipLR q=${q}`);
    assert.ok(near(centroid(flipUD([t])[0]), [px, -py]), `flipUD q=${q}`);
  }
});

test('cell(0,0) rotated stays the same cell', () => {
  assert.equal(cell(0, 0).length, 4);
  assert.deepEqual(normalize(rotCW(cell(0, 0))), normalize(cell(0, 0)));
});

test('half quarters', () => {
  assert.equal(key(half(0, 0, 'NE')), key([[0, 0, 0], [0, 0, 1]]));
  assert.equal(key(half(0, 0, 'SE')), key([[0, 0, 1], [0, 0, 2]]));
  assert.equal(key(half(0, 0, 'SW')), key([[0, 0, 2], [0, 0, 3]]));
  assert.equal(key(half(0, 0, 'NW')), key([[0, 0, 3], [0, 0, 0]]));
  assert.throws(() => half(0, 0, 'N'));
});

test('half NE rotated clockwise is half SE', () => {
  assert.deepEqual(normalize(rotCW(half(0, 0, 'NE'))), normalize(half(0, 0, 'SE')));
  assert.deepEqual(normalize(rotCW(half(4, 7, 'SE'))), normalize(half(0, 0, 'SW')));
});

test('normalize moves min x,y to 0 and sorts', () => {
  const n = normalize(translate(MIX, -7, 13));
  assert.equal(Math.min(...n.map((t) => t[0])), 0);
  assert.equal(Math.min(...n.map((t) => t[1])), 0);
  assert.deepEqual(n, normalize(MIX));
  const sorted = [...n].sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  assert.deepEqual(n, sorted);
  assert.ok(n.every((t) => !Object.is(t[0], -0) && !Object.is(t[1], -0)));
});

test('normalize does not mutate input', () => {
  const s = [[5, 5, 2], [4, 5, 1]];
  normalize(s);
  assert.deepEqual(s, [[5, 5, 2], [4, 5, 1]]);
});

test('normalize and key of empty shape', () => {
  assert.deepEqual(normalize([]), []);
  assert.equal(key([]), '');
});

test('translate shifts cells, keeps q', () => {
  assert.deepEqual(translate([[1, 2, 3]], 4, -5), [[5, -3, 3]]);
});

test('key is order independent and position sensitive', () => {
  assert.equal(key([[0, 0, 1], [1, 0, 3]]), key([[1, 0, 3], [0, 0, 1]]));
  assert.notEqual(key([[0, 0, 1]]), key([[1, 0, 1]]));
  assert.equal(typeof key(L4), 'string');
});

test('connected: edge-sharing only, split shapes rejected', () => {
  assert.ok(!connected([...half(0, 0, 'NE'), ...half(5, 5, 'NE')]));
  assert.ok(!connected([[0, 0, 0], [0, 0, 2]]));
  assert.ok(connected([[0, 0, 1], [1, 0, 3]]));
  assert.ok(connected(cell(0, 0)));
  assert.ok(connected(L4));
  assert.ok(!connected([[0, 0, 0], [1, 0, 0]])); // 꼭짓점만 닿음
  assert.ok(!connected([]));
});

