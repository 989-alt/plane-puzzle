// 조각 보석 모양(조작 안내 그림의 금테 + 깎은 보석 칸). 순수 함수: DOM 없이 path d 문자열과 색만 만든다.
// 칸마다(반 칸·사분 삼각형 칸 포함) 보석 하나: 바깥 다각형을 틈만큼 안으로 줄이고, 다시 비스듬한 면 폭만큼 줄여
// 가운데 평평한 면을 만든다. 두 다각형 사이 변마다 사다리꼴 면 하나: 왼쪽 위를 보는 면은 밝게, 오른쪽 아래는 어둡게.
import { loopsOf, loopsPath } from './geom.js';

export function shade(hex, f) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return hex;
  const to = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  const ch = (v) => Math.round(v + (to - v) * p);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// 시계 방향(화면) 다각형을 d만큼 안으로 줄인다(변을 평행 이동한 직선들의 교점).
export function insetPoly(poly, d) {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1];
    const len = Math.hypot(ux, uy) || 1;
    const nx = -uy / len, ny = ux / len; // 안쪽 법선
    return { p: [a[0] + nx * d, a[1] + ny * d], u: [ux, uy], n: [nx, ny] };
  });
  return poly.map((_, i) => {
    const A = lines[(i + n - 1) % n];
    const B = lines[i];
    const cross = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(cross) < 1e-9) return B.p;
    const s = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / cross;
    return [A.p[0] + A.u[0] * s, A.p[1] + A.u[1] * s];
  });
}

// 칸마다 보석 바탕 다각형(로컬 px). 마주 보는 두 사분만 있는 칸은 사분마다 따로 둔다(꼭짓점 하나로만 닿으므로).
export function gemPolys(tris, S) {
  const cells = new Map();
  for (const t of tris) {
    const k = `${t[0]},${t[1]}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(t);
  }
  const h = S / 2;
  const out = [];
  for (const list of cells.values()) {
    const qs = list.map((t) => t[2]).sort();
    const split = qs.length === 2 && (qs[1] - qs[0]) === 2;
    const groups = split ? list.map((t) => [t]) : [list];
    for (const grp of groups) {
      for (const loop of loopsOf(grp)) out.push(loop.map(([x, y]) => [x * h, y * h]));
    }
  }
  return out;
}

const f2 = (v) => +v.toFixed(2);
const polyD = (p) => `M${p.map(([x, y]) => `${f2(x)},${f2(y)}`).join('L')}Z`;

// 조각 하나의 보석 부품. 같은 밝기의 면은 한 path로 묶어 요소 수를 줄인다.
// -> {frame: 테두리(조각 윤곽) d, facets: [{d, fill}], face: 가운데 면 d, rim: 보석 바깥 선 d, hi: 가운데 면 둘레 d}
export function gemParts(tris, S, color, { gap = 0.075, bevel = 0.14 } = {}) {
  const polys = gemPolys(tris, S);
  const L = [-0.447, -0.894]; // 빛: 위(조금 왼쪽) — 윗면이 가장 밝고 왼쪽 면이 그다음
  const facetD = new Map();
  let face = '', rim = '';
  for (const p of polys) {
    const p0 = insetPoly(p, S * gap);
    // 작은 삼각형 칸은 면 폭을 줄인다(안쪽 원 반지름 2A/P 의 절반 남짓) — 줄인 다각형이 뒤집히지 않게
    let area = 0, per = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      area += a[0] * b[1] - b[0] * a[1];
      per += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const rIn = Math.abs(area) / per;
    const p1 = insetPoly(p0, Math.min(S * bevel, (rIn - S * gap) * 0.55));
    rim += polyD(p0);
    face += polyD(p1);
    const n = p0.length;
    for (let i = 0; i < n; i++) {
      const a = p0[i], b = p0[(i + 1) % n];
      const ux = b[0] - a[0], uy = b[1] - a[1];
      const len = Math.hypot(ux, uy) || 1;
      const t = (uy / len) * L[0] + (-ux / len) * L[1]; // 바깥 법선 · 빛
      const k = (Math.round(t * 4) / 4) * (t > 0 ? 0.5 : 0.4); // 밝게 +0.5 ~ 어둡게 −0.4
      const fill = shade(color, k);
      facetD.set(fill, (facetD.get(fill) || '') + polyD([a, b, p1[(i + 1) % n], p1[i]]));
    }
  }
  return {
    frame: loopsPath(loopsOf(tris), S),
    facets: [...facetD].map(([fill, d]) => ({ d, fill })),
    face,
    rim,
    hi: face,
  };
}

// 붉은 표시용 사분 다각형: 바깥 변만 틈만큼 안으로(보석 면 위에만 덮인다). 로컬 px, 칸 [x, y, q].
export function tintTri([x, y, q], S, gap = 0.075) {
  const l = x * S, t = y * S, r = l + S, b = t + S, c = [l + S / 2, t + S / 2], d = S * gap;
  if (q === 0) return [[l + d, t + d], [r - d, t + d], c];
  if (q === 1) return [[r - d, t + d], [r - d, b - d], c];
  if (q === 2) return [[r - d, b - d], [l + d, b - d], c];
  return [[l + d, b - d], [l + d, t + d], c];
}
