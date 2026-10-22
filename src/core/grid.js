// 사분 삼각형 격자. 정사각형 칸 (x,y)(화면 좌표, y는 아래로 증가)을 두 대각선으로 4등분한 삼각형 하나가 Tri = [x, y, q].
// q: 0=위(N) 1=오른쪽(E) 2=아래(S) 3=왼쪽(W). 순수 함수만 둔다(DOM·저장소 금지). 입력 배열은 바꾸지 않는다.

// 화면에서 시계 방향 90° 돌리기: 칸 (x,y) -> (-y-1, x), q -> q+1.
export function rotCW(tris) {
  return tris.map(([x, y, q]) => [-y - 1, x, (q + 1) % 4]);
}

// 왼쪽·오른쪽으로 뒤집기: 칸 (x,y) -> (-x-1, y), 오른쪽(1)과 왼쪽(3)이 바뀐다.
export function flipLR(tris) {
  return tris.map(([x, y, q]) => [-x - 1, y, q === 1 ? 3 : q === 3 ? 1 : q]);
}

// 위쪽·아래쪽으로 뒤집기: 칸 (x,y) -> (x, -y-1), 위(0)와 아래(2)가 바뀐다.
export function flipUD(tris) {
  return tris.map(([x, y, q]) => [x, -y - 1, q === 0 ? 2 : q === 2 ? 0 : q]);
}

export function translate(tris, dx, dy) {
  return tris.map(([x, y, q]) => [x + dx, y + dy, q]);
}

const cmp = (a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2];

// 최소 x·y를 0으로 옮기고 (y, x, q) 순으로 정렬한 새 배열.
export function normalize(tris) {
  if (tris.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of tris) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return tris.map(([x, y, q]) => [x - minX, y - minY, q]).sort(cmp);
}

// 순서와 무관한 문자열 키. 위치는 그대로 반영한다(모양 비교는 key(normalize(t))).
export function key(tris) {
  return tris.map((t) => [t[0], t[1], t[2]]).sort(cmp).map((t) => t.join(',')).join(';');
}

// 칸 하나 = 사분 삼각형 4개.
export function cell(x, y) {
  return [[x, y, 0], [x, y, 1], [x, y, 2], [x, y, 3]];
}

const HALF = { NE: [0, 1], SE: [1, 2], SW: [2, 3], NW: [3, 0] };

// 칸의 반(직각삼각형). dir은 직각이 놓인 모서리: 'NE' = 위+오른쪽 사분.
export function half(x, y, dir) {
  const qs = HALF[dir];
  if (!qs) throw new Error(`unknown half dir: ${dir}`);
  return qs.map((q) => [x, y, q]);
}
