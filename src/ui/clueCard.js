// 단서 카드 그리기. 큐브 왕국 src/ui/clueCard.js 이식. 크기는 cqw(무대 너비의 1%).
//   1단계: "판 위의 빛나는 모양대로 채워요"(완성 그림은 판 위에 그린다)
//   2단계: 판 윤곽 그림
//   3단계: 조각별 이동 조건 카드(처음 모양 작은 그림 + 문구). 조건이 없는 조각은 카드가 없다.
//   4단계: "이동 N번 안에 맞혀 보세요" + 지금 이동 수
import { normalize } from '../core/grid.js';
import { loopsOf, loopsPath } from '../view/geom.js';
import { shade, gemParts } from '../view/gems.js';

const NS = 'http://www.w3.org/2000/svg';
const SHORT = ['', '완성 모양', '판 모양', '이동 조건', '최소 이동'];
// 조건 카드 문구(교과서 용어, 해요체)
export const COND_TEXT = {
  flip: [['뒤집어야'], ' 맞아요'],
  turn: [['돌려야', 'turn'], ' 맞아요'],
  flipturn: [['뒤집고'], ' ', ['돌려야', 'turn'], ' 맞아요'],
};
export const condText = (kind) => `이 조각은 ${COND_TEXT[kind].map((x) => (Array.isArray(x) ? x[0] : x)).join('')}`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};


const svgEl = (name, attrs, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
};

// 삼각형 묶음 → 작은 svg(칸 10 단위). box: 가로·세로 최대(cqw). gem: 조각 색이면 판 위 조각과 같은 금테 보석 모양.
function miniSvg(tris, { fill, stroke, box, cls, label, gem = null }) {
  const t = normalize(tris);
  let w = 0, h = 0;
  for (const [x, y] of t) { w = Math.max(w, x + 1); h = Math.max(h, y + 1); }
  const U = 10;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `-1 -1 ${w * U + 2} ${h * U + 2}`);
  if (cls) svg.setAttribute('class', cls);
  if (label) svg.setAttribute('aria-label', label);
  else svg.setAttribute('aria-hidden', 'true');
  const k = Math.min(box[0] / w, box[1] / h);
  svg.style.width = `${(w * k).toFixed(2)}cqw`;
  svg.style.height = `${(h * k).toFixed(2)}cqw`;
  if (gem) {
    const parts = gemParts(t, U, gem);
    svgEl('path', { d: parts.frame, fill: '#D29A3C', stroke: '#6E400F', 'stroke-width': 0.6, 'stroke-linejoin': 'round' }, svg);
    for (const f of parts.facets) svgEl('path', { d: f.d, fill: f.fill }, svg);
    svgEl('path', { d: parts.face, fill: gem }, svg);
    svgEl('path', { d: parts.rim, fill: 'none', stroke: shade(gem, -0.55), 'stroke-width': 0.3 }, svg);
    return svg;
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', loopsPath(loopsOf(t), U));
  path.setAttribute('fill', fill);
  path.setAttribute('stroke', stroke);
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function level1() {
  const ic = el('div', 'lead-ic');
  ic.innerHTML = '<svg aria-hidden="true"><use href="#i-sparkle"/></svg>';
  const p = el('div', 'cap lead');
  p.append('판 위의 ', el('b', '', '빛나는 모양'), '대로', document.createElement('br'), '채워요');
  return [ic, p];
}

function level2(puzzle) {
  const fig = miniSvg(puzzle.board, { fill: '#F6E3B8', stroke: '#7A4A12', box: [13, 8.5], cls: 'mini-board', label: '판 모양' });
  return [fig, el('div', 'cap', '이 모양 판을 빈틈없이 채워요')];
}

function condRow(piece, kind) {
  const row = el('div', 'cond');
  row.dataset.piece = piece.id;
  const c = piece.color || '#4A90D9';
  row.append(miniSvg(piece.start, { box: [3, 3], gem: c }));
  const t = el('div', 'cond-t');
  t.append('이 조각은 ', ...COND_TEXT[kind].map((x) => (Array.isArray(x) ? el('em', x[1] || '', x[0]) : x)));
  row.append(t);
  return row;
}

function level3(puzzle, conds) {
  const list = el('div', 'conds');
  for (const pc of puzzle.pieces) if (conds[pc.id]) list.append(condRow(pc, conds[pc.id]));
  if (!list.children.length) return level2(puzzle);
  return [list];
}

function goal(minMoves, moves, small) {
  const box = el('div', small ? 'goal small' : 'goal');
  const t = el('div', 'goal-t');
  t.append('이동 ', el('b', '', String(minMoves)), '번 안에', document.createElement('br'), '맞혀 보세요');
  if (small) t.replaceChildren('이동 ', el('b', '', String(minMoves)), '번 안에 맞혀 보세요');
  const now = el('div', 'goal-now');
  now.id = 'goalNow';
  now.innerHTML = '<svg aria-hidden="true"><use href="#i-star"/></svg>';
  now.append(el('span', '', `지금 ${moves}번`));
  now.classList.toggle('over', moves > minMoves);
  box.append(t, now);
  return box;
}

// card: 단서 카드 요소(.lvl, .clue-body 를 담음).
// opts: {level, easy, puzzle, conds: {조각id: 'flip'|'turn'|'flipturn'}, goal: {minMoves, moves} | null}
export function renderClue(card, { level, easy = false, puzzle, conds = {}, goal: gl = null }) {
  const lvl = card.querySelector('.lvl');
  if (lvl) {
    lvl.textContent = easy ? `쉬운 단서 · ${SHORT[level]}` : SHORT[level];
    lvl.classList.toggle('is-easy', easy);
  }
  const body = card.querySelector('.clue-body') ?? card;
  let parts;
  if (level === 1) parts = level1();
  else if (level === 2) parts = level2(puzzle);
  else if (level === 3) parts = level3(puzzle, conds);
  else parts = [];
  if (gl) parts.push(goal(gl.minMoves, gl.moves, level !== 4));
  body.replaceChildren(...parts);
  body.dataset.level = String(level);
}

// 4단계 이동 수만 바꾼다(카드 전체를 다시 그리지 않는다).
export function updateMoves(card, moves, minMoves) {
  const now = card.querySelector('#goalNow');
  if (!now) return;
  now.querySelector('span').textContent = `지금 ${moves}번`;
  now.classList.toggle('over', moves > minMoves);
}
