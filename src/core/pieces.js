// 조각 변환(뒤집기 4종·돌리기 6종), D4 대칭 원소, 조각 모음. 순수 함수만 둔다(DOM·저장소 금지).
import { rotCW, flipLR, flipUD, normalize, key, cell, half } from './grid.js';

export const MOVES = ['flipUp', 'flipDown', 'flipLeft', 'flipRight', 'cw90', 'cw180', 'cw270', 'ccw90', 'ccw180', 'ccw270'];

const rot = (tris, n) => {
  let t = tris;
  for (let i = 0; i < n; i++) t = rotCW(t);
  return t;
};

const MOVE_FN = {
  flipUp: flipUD,
  flipDown: flipUD,
  flipLeft: flipLR,
  flipRight: flipLR,
  cw90: (t) => rot(t, 1),
  cw180: (t) => rot(t, 2),
  cw270: (t) => rot(t, 3),
  ccw90: (t) => rot(t, 3),
  ccw180: (t) => rot(t, 2),
  ccw270: (t) => rot(t, 1),
};

// 이동 1회를 적용하고 정규화한 결과.
export function applyMove(tris, move) {
  const fn = MOVE_FN[move];
  if (!fn) throw new Error(`unknown move: ${move}`);
  return normalize(fn(tris));
}

// D4 원소. fx_rN = 왼쪽·오른쪽 뒤집기 먼저, 그다음 시계 방향 90° N번.
export const D4 = ['id', 'r90', 'r180', 'r270', 'fx', 'fx_r90', 'fx_r180', 'fx_r270'];

const ELEM = {
  id: [false, 0], r90: [false, 1], r180: [false, 2], r270: [false, 3],
  fx: [true, 0], fx_r90: [true, 1], fx_r180: [true, 2], fx_r270: [true, 3],
};

// 원소를 적용한다. 정규화하지 않으므로 잡은 삼각형 하나가 어디로 가는지 따라갈 수 있다.
export function applyElem(tris, e) {
  const spec = ELEM[e];
  if (!spec) throw new Error(`unknown D4 element: ${e}`);
  const [flip, n] = spec;
  return rot(flip ? flipLR(tris) : tris, n);
}

// 각 원소를 만드는 최소 버튼 수. fx_r180 = 위쪽·아래쪽으로 뒤집기 1번, fx_r90·fx_r270(대각선 뒤집기) = 뒤집기+돌리기 2번.
export const MIN_MOVES = { id: 0, r90: 1, r180: 1, r270: 1, fx: 1, fx_r180: 1, fx_r90: 2, fx_r270: 2 };

// 같은 모양을 내는 원소끼리 묶는다. 순서는 D4 순서대로 처음 나온 모양 기준(첫 묶음에 'id').
export function orientations(tris) {
  const groups = new Map();
  for (const e of D4) {
    const t = normalize(applyElem(tris, e));
    const k = key(t);
    if (groups.has(k)) groups.get(k).elems.push(e);
    else groups.set(k, { tris: t, elems: [e] });
  }
  return [...groups.values()];
}

// from 모양을 to 모양으로 바꾸는 최소 이동 수(밀기는 세지 않음). 같은 모양이 아니면 null.
export function pieceMoves(fromTris, toTris) {
  const target = key(normalize(toTris));
  let best = null;
  for (const e of D4) {
    if (key(normalize(applyElem(fromTris, e))) === target) {
      if (best === null || MIN_MOVES[e] < best) best = MIN_MOVES[e];
    }
  }
  return best;
}

const cells = (list) => list.flatMap(([x, y]) => cell(x, y));

// 칸 조각(거울상 J·Z 등은 뒤집기로 얻으므로 넣지 않음).
const CELL_PIECES = {
  L3: [[0, 0], [0, 1], [1, 1]],
  L4: [[0, 0], [0, 1], [0, 2], [1, 2]],
  S4: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T4: [[0, 0], [1, 0], [2, 0], [1, 1]],
  I3: [[0, 0], [1, 0], [2, 0]],
  O4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  P5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  F5: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  N5: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  Y5: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  L5: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  U5: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  V5: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
};

// 삼각형 조각. 변은 격자선이나 칸 대각선 위에 놓인다.
const TRI_PIECES = {
  // 작은 직각이등변삼각형(빗변 아닌 두 변 1).
  tS: half(0, 0, 'NE'),
  // 큰 직각이등변삼각형(빗변 아닌 두 변 2), 직각은 왼쪽 아래. 모서리 칸 1개 + 두 변을 따라 반 칸 2개 = 사분 8개.
  tB: [...half(0, 0, 'SW'), ...cell(0, 1), ...half(1, 1, 'SW')],
  // 평행사변형: 가로 변 1, 비스듬한 변은 칸 대각선. 180° 대칭이지만 뒤집으면 기울기가 바뀐다.
  para: [...half(0, 0, 'SE'), ...half(1, 0, 'NW')],
  // 직각사다리꼴: 칸 1 + 반 칸 1(윗변 1, 아랫변 2).
  trap: [...cell(0, 0), ...half(1, 0, 'SW')],
  // 깃발: 세로 칸 2(깃대) + 위쪽 오른편 삼각 깃발 반 칸 1.
  flag: [...cells([[0, 0], [0, 1]]), ...half(1, 0, 'NW')],
  // 장화: L자 칸 3 + 앞코 반 칸 1.
  boot: [...cells([[0, 0], [0, 1], [1, 1]]), ...half(2, 1, 'SW')],
};

function entry(id, kind, raw) {
  const tris = normalize(raw);
  return { id, kind, tris, symmetric: orientations(tris).length < 8 };
}

export const LIBRARY = [
  ...Object.entries(CELL_PIECES).map(([id, list]) => entry(id, 'cell', cells(list))),
  ...Object.entries(TRI_PIECES).map(([id, raw]) => entry(id, 'tri', raw)),
];
