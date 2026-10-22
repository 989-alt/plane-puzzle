// 이동 패널(뒤집기 4 + 시계 방향 돌리기 3 + 시계 반대 방향 돌리기 3, 숨김 모드는 되돌리기·처음으로 2개 더) 자리 고르기.
// 큐브 왕국 src/scene/ringPlace.js 의 회피 규칙을 옮겼다. 순수 함수만 둔다(DOM 없음, 무대 px 사각형만 쓴다).
// 패널이 조각을 덮으면 그 조각을 누르거나 끌려던 손가락이 패널(버튼이나 판)에 떨어져 조각이 한 번 더 바뀐다
// (큐브 왕국 2026-10-22 감사 F). 그래서 패널 전체 사각형이 어떤 조각 칸·화면 UI와도 겹치지 않는 자리 중
// 고른 조각에 가장 가까운 곳을 고른다. 그런 자리가 없으면 가장 덜 덮는 자리. 언제나 화면 안.
//
// 모양(layout): 'wide' = 두 줄(위: 뒤집기 4 [+ 되돌리기·처음으로], 아래: 시계 방향 3 + 시계 반대 방향 3),
//               'tall' = 두 칸(왼쪽: 뒤집기 4 [+ 되돌리기·처음으로], 오른쪽: 시계 방향 3 + 시계 반대 방향 3).

export const BTN_W = 52; // 버튼 너비(px, 최소 48)
export const BTN_H = 56; // 버튼 높이(px): 화살표 그림 + 짧은 글자
const GAP = 4; // 같은 묶음 버튼 사이
const GROUP = 10; // 묶음 사이
const LINE = 6; // 두 줄(두 칸) 사이
const INSET = 8; // 패널 안쪽 여백
const EDGE = 6; // 화면 가장자리 여유
const PAD = 6; // 조각·UI와 띄우는 거리
const STEP = 8; // 후보 간격(px)
const TALL_COST = 60; // 'tall' 모양을 쓸 때 더하는 비용(가능하면 두 줄 모양)

export const FLIP_MOVES = ['flipUp', 'flipDown', 'flipLeft', 'flipRight'];
export const CW_MOVES = ['cw90', 'cw180', 'cw270'];
export const CCW_MOVES = ['ccw90', 'ccw180', 'ccw270'];
export const PANEL_MOVES = [...FLIP_MOVES, ...CW_MOVES, ...CCW_MOVES];

export const CAP_WIDE = 16; // 묶음 이름(뒤집기·시계 방향·시계 반대 방향) 한 줄 높이(두 줄 모양)
export const CAP_TALL = 28; // 두 칸 모양은 칸이 좁아 이름이 두 줄
const RUN6 = 6 * BTN_W + 4 * GAP + GROUP; // 버튼 3+3 한 줄 길이
const SIZE = {
  wide: { w: 2 * INSET + RUN6, h: 2 * INSET + 2 * BTN_H + LINE + 2 * CAP_WIDE },
  tall: { w: 2 * INSET + 2 * BTN_W + LINE, h: 2 * INSET + 6 * BTN_H + 4 * GAP + GROUP + 2 * CAP_TALL },
};
export const GROUP_CAPTION = { flip: '뒤집기', cw: '시계 방향', ccw: '시계 반대 방향' };

export function panelSize(layout = 'wide') {
  return { ...SIZE[layout] };
}

// 버튼 자리(패널 왼쪽 위 기준 px). {move | action, group, x, y, w, h}
export function panelButtons(layout = 'wide', hidden = false) {
  // 한 줄(칸)의 k번째 버튼 위치: 앞 묶음 3개(또는 4개) 다음에 묶음 간격
  const along = (k, firstGroup) => k * (BTN_W + GAP) + (k >= firstGroup ? GROUP - GAP : 0);
  const alongV = (k, firstGroup) => k * (BTN_H + GAP) + (k >= firstGroup ? GROUP - GAP : 0);
  const line1 = [...FLIP_MOVES.map((m) => ({ move: m, group: 'flip' }))];
  if (hidden) line1.push({ action: 'undo', group: 'queue' }, { action: 'reset', group: 'queue' });
  const line2 = [...CW_MOVES.map((m) => ({ move: m, group: 'cw' })), ...CCW_MOVES.map((m) => ({ move: m, group: 'ccw' }))];
  const out = [];
  if (layout === 'tall') {
    const C = CAP_TALL;
    line1.forEach((b, k) => out.push({ ...b, x: INSET, y: INSET + C + alongV(k, 4), w: BTN_W, h: BTN_H }));
    line2.forEach((b, k) => out.push({ ...b, x: INSET + BTN_W + LINE, y: INSET + C + alongV(k, 3) + (k >= 3 ? C : 0), w: BTN_W, h: BTN_H }));
  } else {
    const C = CAP_WIDE;
    line1.forEach((b, k) => out.push({ ...b, x: INSET + along(k, 4), y: INSET + C, w: BTN_W, h: BTN_H }));
    line2.forEach((b, k) => out.push({ ...b, x: INSET + along(k, 3), y: INSET + 2 * C + BTN_H + LINE, w: BTN_W, h: BTN_H }));
  }
  return out;
}

// 묶음 이름 자리(패널 왼쪽 위 기준 px): 각 묶음 첫 버튼 바로 위, 묶음 너비. {group, text, x, y, w, h}
export function panelCaptions(layout = 'wide', hidden = false) {
  const btns = panelButtons(layout, hidden);
  const C = layout === 'tall' ? CAP_TALL : CAP_WIDE;
  return ['flip', 'cw', 'ccw'].map((group) => {
    const gb = btns.filter((b) => b.group === group);
    const x = Math.min(...gb.map((b) => b.x));
    const y = Math.min(...gb.map((b) => b.y)) - C;
    const w = Math.max(...gb.map((b) => b.x + b.w)) - x;
    return { group, text: GROUP_CAPTION[group], x, y, w, h: C };
  });
}

const overlap = (a, b) => {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
};
const grow = (r, d) => ({ l: r.l - d, t: r.t - d, r: r.r + d, b: r.b + d });
const rectOf = (p) => ({ l: p.x, t: p.y, r: p.x + p.w, b: p.y + p.h });
const fits = (p, W, H) => p.x >= EDGE && p.y >= EDGE && p.x + p.w <= W - EDGE && p.y + p.h <= H - EDGE;
const clear = (r, rects) => {
  const g = grow(r, PAD);
  for (const b of rects) if (g.l < b.r && b.l < g.r && g.t < b.b && b.t < g.b) return false;
  return true;
};

// boxes: [{i, l, t, r, b}] 조각 칸(과 숨김 모드 이동 카드 줄) 화면 사각형(무대 px), sel: 고른 조각 id,
// ui: [{l, t, r, b}] 덮으면 안 되는 화면 UI, W·H: 무대 크기, prev: 지금 떠 있는 패널(아직 아무것도 덮지 않으면 그대로).
// -> {x, y, w, h, layout} 패널 왼쪽 위(무대 px)와 크기.
export function placePanel({ boxes, sel, ui = [], W, H, prev = null }) {
  const all = [...boxes, ...ui];
  if (prev && SIZE[prev.layout] && fits(prev, W, H) && clear(rectOf(prev), all)) return prev;
  // 고른 조각 사각형(없으면 화면 가운데 점)
  let sl = Infinity, st = Infinity, sr = -Infinity, sb = -Infinity;
  for (const q of boxes) {
    if (q.i !== sel) continue;
    sl = Math.min(sl, q.l); st = Math.min(st, q.t); sr = Math.max(sr, q.r); sb = Math.max(sb, q.b);
  }
  if (!Number.isFinite(sl)) { sl = sr = W / 2; st = sb = H / 2; }
  const cx = (sl + sr) / 2;
  const cy = (st + sb) / 2;
  // 비용 = 고른 조각과 패널 사이 틈 + 가운데 거리 조금(조각 옆 가운데 쪽을 고르게) + 모양 비용.
  // 같은 비용이면 위쪽·왼쪽·두 줄 모양 순(결정적).
  const better = (a, b) => !b || a.cost < b.cost || (a.cost === b.cost && (a.y < b.y || (a.y === b.y && (a.x < b.x
    || (a.x === b.x && a.layout < b.layout)))));
  let best = null; // 아무것도 덮지 않는 자리 중 가장 싼 곳
  let least = null; // 덮는 넓이가 가장 작은 곳(깨끗한 자리가 없을 때)
  for (const layout of ['wide', 'tall']) {
    const { w, h } = SIZE[layout];
    for (const x of steps(EDGE, W - EDGE - w)) {
      for (const y of steps(EDGE, H - EDGE - h)) {
        const gx = Math.max(0, sl - (x + w), x - sr);
        const gy = Math.max(0, st - (y + h), y - sb);
        const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
        const c = { x, y, w, h, layout, cost: Math.hypot(gx, gy) + 0.05 * d + (layout === 'tall' ? TALL_COST : 0) };
        if (best && !better(c, best)) continue;
        const r = rectOf(c);
        if (clear(r, all)) {
          best = c;
          continue;
        }
        if (best) continue;
        // 다른 조각·UI를 덮는 넓이(무겁게) + 고른 조각을 덮는 넓이(가볍게)
        const g = grow(r, PAD);
        let s = 0;
        for (const q of boxes) s += overlap(g, q) * (q.i === sel ? 0.3 : 1);
        for (const u of ui) s += overlap(g, u) * 2;
        c.score = s * 10 + c.cost;
        if (!least || c.score < least.score) least = c;
      }
    }
  }
  if (best) return pick(best);
  if (least) return pick(least);
  // 화면이 패널보다 작다: 왼쪽 위에 붙인다
  return { x: 0, y: 0, ...SIZE.wide, layout: 'wide' };
}

const pick = (c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, layout: c.layout });

// lo..hi 를 STEP 간격으로(끝점 hi 포함). hi < lo 면 빈 목록.
function steps(lo, hi) {
  if (hi < lo) return [];
  const out = [];
  for (let v = lo; v < hi; v += STEP) out.push(v);
  out.push(hi);
  return out;
}
