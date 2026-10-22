// SVG 렌더: 판(밝은 안쪽 면 + 칸 선), 1단계 완성 그림(ghost), 끌기 놓을 자리 미리보기, 조각(두께·그림자·무늬),
// 1단계 붉은 표시, 숨김 모드 이동 카드 줄, 뒤집기·돌리기 애니메이션.
// 무대 배경 그림은 CSS(cover)로 깔고 svg는 그 위에 투명하게 겹친다. svg 좌표 = 무대 px(viewBox 0 0 W H).
import { normalize, translate } from '../core/grid.js';
import { elemMarked } from '../core/layout.js';
import { loopsOf, loopsPath, innerCellEdges, triPolygon, pieceRect, cellBoxes } from './geom.js';

const NS = 'http://www.w3.org/2000/svg';

// 교과서식 화살표 기호(24x24, 선). 패널 버튼과 이동 카드가 같이 쓴다.
// 뒤집기: 점선 = 뒤집는 기준선, 화살표 = 뒤집는 쪽. 돌리기: 호의 길이 = 90°·180°·270°, 화살촉 = 방향.
const arc = (deg, cw) => {
  const r = 8.4;
  const c = [12, 12.5];
  const a0 = -90; // 12시에서 시작
  const a1 = a0 + (cw ? deg : -deg);
  const pt = (a) => [c[0] + r * Math.cos((a * Math.PI) / 180), c[1] + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  const large = deg > 180 ? 1 : 0;
  // 화살촉: 끝점에서 진행 방향(접선)으로
  const t = ((a1 + (cw ? 90 : -90)) * Math.PI) / 180;
  const n = ((a1 + 180) * Math.PI) / 180;
  const tip = [x1 + 3 * Math.cos(t), y1 + 3 * Math.sin(t)];
  const w1 = [x1 + 3.6 * Math.cos(n), y1 + 3.6 * Math.sin(n)];
  const w2 = [x1 - 3.6 * Math.cos(n), y1 - 3.6 * Math.sin(n)];
  const f = (p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  return `<path d="M${f([x0, y0])}A${r} ${r} 0 ${large} ${cw ? 1 : 0} ${f([x1, y1])}"/>`
    + `<path d="M${f(w1)}L${f(tip)}L${f(w2)}" />`
    + '<circle cx="12" cy="12.5" r="1.5" fill="currentColor" stroke="none"/>';
};
// 뒤집기(교과서 그림): 색칠한 도형, 점선(뒤집는 기준선) 건너편에 뒤집은 모양(빈 도형), 넘어가는 화살표.
const flip = (axis, solid, hollow, path, head) => `<path d="${axis}" stroke-dasharray="2.2 2.2" stroke-width="1.6"/>`
  + `<polygon points="${solid}" fill="currentColor" stroke="currentColor" stroke-width="1.4"/>`
  + `<polygon points="${hollow}" fill="none" stroke-width="1.6"/>`
  + `<path d="${path}"/><path d="${head}"/>`;
const T_LEFT = '4,20 10,20 4,12';
const T_RIGHT = '20,20 14,20 20,12';
const T_TOP = '4,4 4,10 11,4';
const T_BOTTOM = '4,20 4,14 11,20';
export const MOVE_ICON = {
  flipRight: flip('M12 2v20', T_LEFT, T_RIGHT, 'M6 8Q12 1 18 8', 'M13.7 7L18 8L17.7 3.6'),
  flipLeft: flip('M12 2v20', T_RIGHT, T_LEFT, 'M18 8Q12 1 6 8', 'M10.3 7L6 8L6.3 3.6'),
  flipDown: flip('M2 12h20', T_TOP, T_BOTTOM, 'M16 6Q23 12 16 18', 'M17 13.7L16 18L20.4 17.7'),
  flipUp: flip('M2 12h20', T_BOTTOM, T_TOP, 'M16 18Q23 12 16 6', 'M17 10.3L16 6L20.4 6.3'),
  cw90: arc(90, true),
  cw180: arc(180, true),
  cw270: arc(270, true),
  ccw90: arc(90, false),
  ccw180: arc(180, false),
  ccw270: arc(270, false),
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  reset: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/>',
};
export const MOVE_LABEL = {
  flipUp: '위쪽으로 뒤집기', flipDown: '아래쪽으로 뒤집기', flipLeft: '왼쪽으로 뒤집기', flipRight: '오른쪽으로 뒤집기',
  cw90: '시계 방향으로 90° 돌리기', cw180: '시계 방향으로 180° 돌리기', cw270: '시계 방향으로 270° 돌리기',
  ccw90: '시계 반대 방향으로 90° 돌리기', ccw180: '시계 반대 방향으로 180° 돌리기', ccw270: '시계 반대 방향으로 270° 돌리기',
  undo: '되돌리기', reset: '처음으로',
};
export const MOVE_SHORT = {
  flipUp: '위쪽', flipDown: '아래쪽', flipLeft: '왼쪽', flipRight: '오른쪽',
  cw90: '90°', cw180: '180°', cw270: '270°', ccw90: '90°', ccw180: '180°', ccw270: '270°',
  undo: '되돌리기', reset: '처음으로',
};

// 이동 한 번의 애니메이션 단계: 뒤집기 = 축 방향 scale −1 트윈 220ms, 돌리기 = 90°당 180ms.
function moveComp(move, pivot) {
  if (move === 'flipUp' || move === 'flipDown') return { type: 'sy', p: pivot, ms: 220 };
  if (move === 'flipLeft' || move === 'flipRight') return { type: 'sx', p: pivot, ms: 220 };
  const deg = { cw90: 90, cw180: 180, cw270: 270, ccw90: -90, ccw180: -180, ccw270: -270 }[move];
  return { type: 'rot', deg, p: pivot, ms: (Math.abs(deg) / 90) * 180 };
}
// 단계 c를 거꾸로 되돌린 변환(남은 비율 f: 1 = 다 되돌림(이전 모습), 0 = 그대로).
function invStr(c, f) {
  if (f <= 0) return '';
  const [px, py] = c.p || [0, 0];
  if (c.type === 'rot') return `rotate(${(-c.deg * f).toFixed(3)} ${px} ${py})`;
  if (c.type === 'tr') return `translate(${(-c.dx * f).toFixed(2)} ${(-c.dy * f).toFixed(2)})`;
  const s = Math.cos(Math.PI * f).toFixed(4);
  const sc = c.type === 'sx' ? `${s} 1` : `1 ${s}`;
  return `translate(${px} ${py}) scale(${sc}) translate(${-px} ${-py})`;
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function shade(hex, f) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return hex;
  const to = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  const ch = (v) => Math.round(v + (to - v) * p);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

// 무늬: 사분 [x, y, q] 안 흰 점 + 짧은 홈(사분 바깥 변 한쪽 끝(v=0: 시계 방향 첫 꼭짓점, 1: 둘째)을 가리킴).
// 돌리면 함께 돌고, 뒤집으면 홈이 반대쪽 꼭짓점을 가리켜 뒤집었는지 보인다.
function markShapes(mark, S, parent, { faint = false } = {}) {
  const g0 = { ox: 0, oy: 0, S };
  const [A, B, C] = triPolygon(mark.slice(0, 3), g0);
  const cx = (A[0] + B[0] + C[0]) / 3;
  const cy = (A[1] + B[1] + C[1]) / 3;
  const T = mark[3] ? B : A;
  const len = 0.62;
  const tx = cx + (T[0] - cx) * len;
  const ty = cy + (T[1] - cy) * len;
  const g = el('g', { class: 'pp-mark', 'pointer-events': 'none', opacity: faint ? 0.55 : 1 }, parent);
  el('line', {
    x1: cx.toFixed(2), y1: cy.toFixed(2), x2: tx.toFixed(2), y2: ty.toFixed(2),
    stroke: '#fff', 'stroke-width': (S * 0.075).toFixed(2), 'stroke-linecap': 'round',
  }, g);
  el('circle', {
    cx: cx.toFixed(2), cy: cy.toFixed(2), r: (S * 0.085).toFixed(2),
    fill: '#fff', stroke: 'rgba(40,20,0,.55)', 'stroke-width': (S * 0.025).toFixed(2),
  }, g);
  return g;
}

const prefersReduced = () => {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// svg: 무대 위 <svg>, puzzle: 문제, opts.g: fitPuzzle 의 칸 크기·원점(무대 px), opts.reducedMotion: 강제(시험용),
// opts.ui: 화면 UI 사각형(무대 px) — 숨김 모드 카드 줄이 덮지 않게.
export function createView(svg, puzzle, opts = {}) {
  const g = opts.g;
  const { S } = g;
  const SHADOW_REST = `translate(${(S * 0.08).toFixed(2)} ${(S * 0.21).toFixed(2)})`;
  const SHADOW_LIFT = `translate(${(S * 0.16).toFixed(2)} ${(S * 0.4).toFixed(2)})`;
  const uiRects = opts.ui || [];
  const colorOf = Object.fromEntries(puzzle.pieces.map((p) => [p.id, p.color || '#4A90D9']));
  const reduced = () => (opts.reducedMotion === undefined ? prefersReduced() : !!opts.reducedMotion);

  svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
  svg.setAttribute('width', g.W);
  svg.setAttribute('height', g.H);
  svg.style.touchAction = 'none';
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // ---- defs ----
  const defs = el('defs', {}, svg);
  const blur = el('filter', { id: 'pp-blur', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
  el('feGaussianBlur', { stdDeviation: (S * 0.085).toFixed(2) }, blur);
  // 안쪽 그림자(판이 살짝 파인 느낌)
  const inset = el('filter', { id: 'pp-inset', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
  el('feFlood', { 'flood-color': '#4a2300', 'flood-opacity': '0.55', result: 'c' }, inset);
  el('feComposite', { in: 'c', in2: 'SourceAlpha', operator: 'out', result: 'o' }, inset);
  el('feGaussianBlur', { in: 'o', stdDeviation: (S * 0.06).toFixed(2), result: 'b' }, inset);
  el('feOffset', { in: 'b', dx: (S * 0.04).toFixed(2), dy: (S * 0.06).toFixed(2), result: 'd' }, inset);
  el('feComposite', { in: 'd', in2: 'SourceAlpha', operator: 'in', result: 'i' }, inset);
  const merge = el('feMerge', {}, inset);
  el('feMergeNode', { in: 'SourceGraphic' }, merge);
  el('feMergeNode', { in: 'i' }, merge);
  for (const p of puzzle.pieces) {
    const c = colorOf[p.id];
    const lg = el('linearGradient', { id: `pp-face-${p.id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': shade(c, 0.28) }, lg);
    el('stop', { offset: '0.55', 'stop-color': c }, lg);
    el('stop', { offset: '1', 'stop-color': shade(c, -0.1) }, lg);
  }

  // ---- 판 ----
  const boardLayer = el('g', { class: 'pp-board', transform: `translate(${g.ox} ${g.oy})`, 'pointer-events': 'none' }, svg);
  const bLoops = loopsOf(puzzle.board);
  const bPath = loopsPath(bLoops, S);
  el('path', { d: bPath, fill: 'rgba(255,243,214,0.52)', filter: 'url(#pp-inset)' }, boardLayer);
  const lines = innerCellEdges(puzzle.board).map(([a, b]) => `M${(a[0] * S) / 2},${(a[1] * S) / 2}L${(b[0] * S) / 2},${(b[1] * S) / 2}`).join('');
  el('path', { d: lines, fill: 'none', stroke: 'rgba(95,50,10,0.38)', 'stroke-width': 1.2 }, boardLayer);
  el('path', { d: bPath, fill: 'none', stroke: 'rgba(80,38,5,0.85)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, boardLayer);

  const ghostLayer = el('g', { class: 'pp-ghost', 'pointer-events': 'none', display: 'none' }, svg);
  const snapLayer = el('g', { class: 'pp-snap', 'pointer-events': 'none' }, svg);
  const piecesLayer = el('g', { class: 'pp-pieces' }, svg);
  const wrongLayer = el('g', { class: 'pp-wrong', 'pointer-events': 'none' }, svg);
  const queueLayer = el('g', { class: 'pp-queues', 'pointer-events': 'none' }, svg);

  // ---- 1단계 완성 그림: 첫 해답 자리, 조각 색 반투명 + 점선 ----
  const sol = (puzzle.solutions && puzzle.solutions[0]) || [];
  for (const r of sol) {
    const p = puzzle.pieces.find((q) => q.id === r.id);
    if (!p) continue;
    const start = normalize(p.start);
    const m = elemMarked(start, [...start[0], 0], r.elem);
    const gg = el('g', { transform: `translate(${g.ox + r.dx * S} ${g.oy + r.dy * S})`, 'data-ghost': r.id }, ghostLayer);
    const d = loopsPath(loopsOf(m.tris), S);
    el('path', {
      d, fill: colorOf[r.id], 'fill-opacity': 0.5, stroke: shade(colorOf[r.id], -0.35), 'stroke-width': 2,
      'stroke-dasharray': `${(S * 0.14).toFixed(1)} ${(S * 0.09).toFixed(1)}`, 'stroke-linejoin': 'round',
    }, gg);
    markShapes(m.mark, S, gg, { faint: true });
  }

  // ---- 조각 ----
  const nodes = new Map(); // id -> {g, anim, shapeKey, pos, tris, queueKey, qg}
  let current = null; // 마지막 state
  const anims = new Map(); // id -> {cancel}
  const dragOff = new Map(); // id -> [dx, dy] px

  function buildShape(id, node, tris, mark) {
    const anim = node.anim;
    while (anim.firstChild) anim.removeChild(anim.firstChild);
    const c = colorOf[id];
    const d = loopsPath(loopsOf(tris), S);
    node.shadow = el('path', {
      class: 'pp-shadow', d, fill: 'rgba(40,18,0,0.5)', filter: 'url(#pp-blur)', 'pointer-events': 'none',
      transform: SHADOW_REST,
    }, anim);
    el('path', {
      class: 'pp-edge', d, fill: shade(c, -0.42), transform: `translate(0 ${(S * 0.1).toFixed(2)})`,
    }, anim);
    el('path', {
      class: 'pp-face', d, fill: `url(#pp-face-${id})`, stroke: shade(c, -0.5), 'stroke-width': 1.6,
      'stroke-linejoin': 'round',
    }, anim);
    const inner = innerCellEdges(tris).map(([a, b]) => `M${(a[0] * S) / 2},${(a[1] * S) / 2}L${(b[0] * S) / 2},${(b[1] * S) / 2}`).join('');
    if (inner) el('path', { d: inner, fill: 'none', stroke: 'rgba(0,0,0,0.16)', 'stroke-width': 1, 'pointer-events': 'none' }, anim);
    // 윗면 테두리 안쪽 밝은 선(빛 받는 모서리)
    const clipId = `pp-clip-${id}`;
    let clip = svg.querySelector(`#${clipId}`);
    if (clip) clip.remove();
    clip = el('clipPath', { id: clipId }, defs);
    el('path', { d }, clip);
    el('path', {
      d, fill: 'none', stroke: 'rgba(255,255,255,0.45)', 'stroke-width': (S * 0.09).toFixed(2),
      'clip-path': `url(#${clipId})`, transform: `translate(${(S * 0.035).toFixed(2)} ${(S * 0.035).toFixed(2)})`,
      'pointer-events': 'none',
    }, anim);
    markShapes(mark, S, anim);
  }

  function nodeFor(id) {
    if (nodes.has(id)) return nodes.get(id);
    const gEl = el('g', { class: 'pp-piece', 'data-id': id }, piecesLayer);
    const anim = el('g', { class: 'pp-anim' }, gEl);
    const qg = el('g', { class: 'pp-queue', 'data-queue': id }, queueLayer);
    const node = { g: gEl, anim, qg, shapeKey: '', queueKey: '' };
    nodes.set(id, node);
    return node;
  }

  const topLeft = (pos) => [g.ox + pos[0] * S, g.oy + pos[1] * S];

  function placeNode(id) {
    const node = nodes.get(id);
    const [x, y] = topLeft(node.pos);
    const off = dragOff.get(id) || [0, 0];
    node.g.setAttribute('transform', `translate(${(x + off[0]).toFixed(2)} ${(y + off[1]).toFixed(2)})`);
    node.qg.setAttribute('transform', `translate(${off[0].toFixed(2)} ${off[1].toFixed(2)})`);
  }

  // 숨김 모드 이동 카드 줄: 조각 위(자리가 없으면 아래)에 작은 카드. 많으면 앞을 "+n"으로 줄인다.
  const CARD = 28;
  const CARD_GAP = 4;
  const MAX_CARDS = 6;
  function queueRect(pc) {
    if (!pc.queue || pc.queue.length === 0) return null;
    const n = Math.min(pc.queue.length, MAX_CARDS);
    const w = n * CARD + (n - 1) * CARD_GAP;
    const r = pieceRect(pc.tris, pc.pos, g);
    const x = Math.min(Math.max(4, r.l), g.W - w - 4);
    // 조각 위에, 화면 밖이거나 화면 UI와 겹치면 아래에(둘 다 안 되면 위)
    const at = (y) => ({ l: x, t: y, r: x + w, b: y + CARD });
    const ok = (q) => q.t >= 4 && q.b <= g.H - 4 && !uiRects.some((u) => q.l < u.r && u.l < q.r && q.t < u.b && u.t < q.b);
    const above = at(r.t - CARD - 8);
    const below = at(r.b + S * 0.12 + 6);
    if (ok(above)) return above;
    if (ok(below)) return below;
    return above.t >= 4 ? above : below;
  }
  function buildQueue(pc, node) {
    const qg = node.qg;
    while (qg.firstChild) qg.removeChild(qg.firstChild);
    const rect = queueRect(pc);
    if (!rect) return;
    const q = pc.queue;
    const shown = q.length > MAX_CARDS ? q.slice(q.length - (MAX_CARDS - 1)) : q;
    const items = q.length > MAX_CARDS ? [`+${q.length - shown.length}`, ...shown] : shown;
    items.forEach((m, k) => {
      const x = rect.l + k * (CARD + CARD_GAP);
      const cg = el('g', { class: 'pp-card', transform: `translate(${x} ${rect.t})`, 'data-move': m }, qg);
      el('rect', { width: CARD, height: CARD, rx: 6, fill: '#FFF8E6', stroke: '#7A4A12', 'stroke-width': 1.5 }, cg);
      if (MOVE_ICON[m]) {
        const ic = el('g', {
          transform: `translate(3 3) scale(${(CARD - 6) / 24})`, fill: 'none', stroke: m.startsWith('flip') ? '#7A3FB0' : '#B5600A',
          'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', color: '#B5600A',
        }, cg);
        ic.innerHTML = MOVE_ICON[m];
      } else {
        const t = el('text', { x: CARD / 2, y: CARD / 2 + 5, 'text-anchor': 'middle', 'font-size': 13, fill: '#5A2C00', 'font-weight': 700 }, cg);
        t.textContent = m;
      }
    });
  }

  function cancelAnim(id) {
    const a = anims.get(id);
    if (a) a.cancel();
  }

  // 상태를 그린다. 모양이 바뀐 조각은 다시 만들고, 진행 중인 애니메이션은 끝낸다.
  function update(state) {
    current = state;
    const seen = new Set();
    for (const pc of state.pieces) {
      seen.add(pc.id);
      const node = nodeFor(pc.id);
      const sk = `${JSON.stringify(pc.tris)}|${pc.mark.join(',')}`;
      const moved = !node.pos || node.pos[0] !== pc.pos[0] || node.pos[1] !== pc.pos[1];
      if (sk !== node.shapeKey || moved) cancelAnim(pc.id);
      if (sk !== node.shapeKey) {
        buildShape(pc.id, node, pc.tris, pc.mark);
        node.shapeKey = sk;
      }
      node.pos = pc.pos;
      node.tris = pc.tris;
      node.g.classList.toggle('on-board', !!pc.at);
      const qk = `${pc.queue.join(',')}|${pc.pos.join(',')}|${sk}`;
      if (qk !== node.queueKey) {
        buildQueue(pc, node);
        node.queueKey = qk;
      }
      placeNode(pc.id);
    }
    for (const [id, node] of nodes) {
      if (seen.has(id)) continue;
      node.g.remove();
      node.qg.remove();
      nodes.delete(id);
    }
  }

  // 변환 단계들을 차례로 재생한다(조각은 이미 마지막 모습으로 그려져 있다). comps 의 기준점은 무대 px.
  function play(id, comps) {
    const node = nodes.get(id);
    if (!node || comps.length === 0 || reduced()) return Promise.resolve();
    cancelAnim(id);
    const [ox, oy] = topLeft(node.pos);
    const local = comps.map((c) => ({ ...c, p: c.p ? [+(c.p[0] - ox).toFixed(2), +(c.p[1] - oy).toFixed(2)] : null }));
    const f = local.map(() => 1);
    const apply = () => node.anim.setAttribute('transform', local.map((c, j) => invStr(c, f[j])).filter(Boolean).join(' '));
    apply();
    return new Promise((resolve) => {
      let j = 0;
      let t0 = null;
      let raf = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        node.anim.removeAttribute('transform');
        anims.delete(id);
        resolve();
      };
      const tick = (now) => {
        if (done) return;
        if (t0 === null) t0 = now;
        const c = local[j];
        // hold: 앞부분은 멈춰 보여 준다(숨김 모드에서 드러난 모양을 잠깐 보인 뒤 트레이로)
        const wait = c.hold || 0;
        const t = Math.min(1, Math.max(0, now - t0 - wait) / c.ms);
        f[j] = 1 - ease(t);
        apply();
        if (t >= 1 && now - t0 >= wait + c.ms) {
          f[j] = 0;
          j += 1;
          t0 = now;
          if (j >= local.length) { finish(); return; }
        }
        raf = requestAnimationFrame(tick);
      };
      anims.set(id, { cancel: finish });
      raf = requestAnimationFrame(tick);
    });
  }

  const centerOf = (tris, pos) => {
    const r = pieceRect(tris, pos, g);
    return [(r.l + r.r) / 2, (r.t + r.b) / 2];
  };
  const slideComp = (from, to) => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dist = Math.hypot(dx, dy);
    return dist < 0.5 ? null : { type: 'tr', dx, dy, ms: Math.min(360, 140 + dist * 0.6) };
  };

  return {
    g,
    svg,
    puzzle,
    update,
    // 이동 한 번(보이는 모드). 상태는 이미 바뀌어 그려져 있다: 이전 모습(opt.from = 이전 {tris, pos})에서
    // 조각 가운데 기준으로 뒤집기·돌리기를 보여 주고, 비키느라 자리가 바뀌었으면 미끄러져 간다.
    animateMove(id, move, { from } = {}) {
      const node = nodes.get(id);
      if (!node) return Promise.resolve();
      const c0 = from ? centerOf(from.tris, from.pos) : centerOf(node.tris, node.pos);
      const c1 = centerOf(node.tris, node.pos);
      return play(id, [moveComp(move, c0), slideComp(c0, c1)].filter(Boolean));
    },
    // 숨김 모드 놓기: 손가락 칸 가운데(pivot, 무대 px)를 기준으로 쌓인 이동을 차례로 보여 준 뒤,
    // 드러난 자리(spot = 그 결과 모양의 왼쪽 위, 무대 px)에서 지금 자리로 미끄러진다(실패해 트레이로 돌아갈 때).
    playReveal(id, queue, { pivot, spot }) {
      const node = nodes.get(id);
      if (!node) return Promise.resolve();
      const [x, y] = topLeft(node.pos);
      const comps = queue.map((m) => moveComp(m, pivot));
      const sl = slideComp(spot, [x, y]);
      if (sl) comps.push({ ...sl, hold: 320 });
      return play(id, comps);
    },
    // 놓은 뒤 칸에 맞추거나 트레이로 돌아갈 때: 놓은 자리(fromPx = 그려져 있던 왼쪽 위, 무대 px)에서 미끄러진다.
    slide(id, fromPx) {
      const node = nodes.get(id);
      if (!node) return Promise.resolve();
      const sl = slideComp(fromPx, topLeft(node.pos));
      return play(id, sl ? [{ ...sl, ms: Math.min(sl.ms, 220) }] : []);
    },
    // 끄는 중: 조각을 손가락 따라 px 단위로 옮긴다(칸 맞춤은 놓을 때). 지연 없이 바로 쓴다.
    setDrag(id, dx, dy) {
      const node = nodes.get(id);
      if (!node) return;
      cancelAnim(id);
      dragOff.set(id, [dx, dy]);
      if (!node.g.classList.contains('lifted')) {
        node.g.classList.add('lifted');
        piecesLayer.appendChild(node.g); // 맨 위로
        if (node.shadow) node.shadow.setAttribute('transform', SHADOW_LIFT);
      }
      placeNode(id);
    },
    clearDrag(id) {
      const node = nodes.get(id);
      dragOff.delete(id);
      if (!node) return;
      node.g.classList.remove('lifted');
      if (node.shadow) node.shadow.setAttribute('transform', SHADOW_REST);
      placeNode(id);
    },
    raise(id) {
      const node = nodes.get(id);
      if (node) piecesLayer.appendChild(node.g);
    },
    // 끌기 미리보기: 놓으면 판에 들어갈 자리(무대 칸 pos). null이면 지운다.
    setSnap(tris, pos) {
      while (snapLayer.firstChild) snapLayer.removeChild(snapLayer.firstChild);
      if (!tris) return;
      el('path', {
        d: loopsPath(loopsOf(translate(tris, pos[0], pos[1])), S), transform: `translate(${g.ox} ${g.oy})`,
        fill: 'rgba(255,255,255,0.28)', stroke: '#FFF7D6', 'stroke-width': 2.5, 'stroke-dasharray': '7 5',
        'stroke-linejoin': 'round',
      }, snapLayer);
    },
    // 1단계 붉은 표시: 판 좌표 삼각형 키("x,y,q") 집합.
    setWrong(keys) {
      while (wrongLayer.firstChild) wrongLayer.removeChild(wrongLayer.firstChild);
      for (const k of keys || []) {
        const t = String(k).split(',').map(Number);
        const pts = triPolygon(t, g).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        el('polygon', {
          class: 'pp-wrong-tri', points: pts, fill: 'rgba(225,29,42,0.55)', stroke: '#B0101C', 'stroke-width': 1.5,
          'stroke-linejoin': 'round',
        }, wrongLayer);
      }
    },
    setGhost(show) {
      ghostLayer.setAttribute('display', show ? 'inline' : 'none');
    },
    // 조각 전체 사각형(무대 px) {id: DOMRect 꼴}
    pieceBoxes() {
      const out = {};
      for (const pc of current ? current.pieces : []) {
        const r = pieceRect(pc.tris, pc.pos, g);
        out[pc.id] = { x: r.l, y: r.t, width: r.r - r.l, height: r.b - r.t, left: r.l, top: r.t, right: r.r, bottom: r.b };
      }
      return out;
    },
    // 패널이 피할 사각형: 조각 칸(아래 두께 포함) + 숨김 모드 카드 줄. [{i, l, t, r, b}]
    cellBoxes() {
      const out = [];
      for (const pc of current ? current.pieces : []) {
        for (const b of cellBoxes(pc.tris, pc.pos, g, pc.id)) out.push({ ...b, b: b.b + S * 0.12 });
        const q = queueRect(pc);
        if (q) out.push({ i: pc.id, ...q });
      }
      return out;
    },
    queueRect: (id) => {
      const pc = current && current.pieces.find((q) => q.id === id);
      return pc ? queueRect(pc) : null;
    },
    busy: () => anims.size > 0,
    finish() {
      for (const a of [...anims.values()]) a.cancel();
    },
    nodeOf: (id) => (nodes.get(id) || {}).g || null,
  };
}
