// 단계별 문제 은행 생성기. node tools/gen-puzzles.mjs → data/puzzles-s1..s4.json
// 스펙 4.5 "거꾸로 만들기": 조각을 서로 변을 맞대 붙여 판을 먼저 만들고, 조각마다 놓인 모양에 무작위 D4 원소를
// 적용한 것을 시작 모양(start)으로 삼은 뒤, 해답 탐색기로 해답 수·이동 조건·최소 이동 수를 구해 채택 조건을 거른다.
// 시드 고정(mulberry32, 단계마다 따로)이라 같은 코드면 두 번 돌려도 바이트까지 같은 파일이 나온다.
//
// 자리 약속: 놓인 삼각형 = translate(normalize(applyElem(start, elem)), dx, dy). 해답 기록 {id, elem, dx, dy}.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { normalize, translate, key, connected } from '../src/core/grid.js';
import { D4, applyElem, orientations, LIBRARY } from '../src/core/pieces.js';
import { solve, needs, minMovesOf } from '../src/core/solver.js';

const SEED = 20261022;
const PER_STAGE = 40;
const SOLUTION_LIMIT = 7; // 7개째가 나오면 "6개 초과"로 버린다
const MAX_SOLUTIONS = 6;
export const MAX_W = 6; // 판 경계 상자 가로(칸)
export const MAX_H = 6; // 판 경계 상자 세로(칸)
const MIN_FILL = 0.6; // 판 넓이(칸) / 경계 상자 넓이. 한 덩어리 모양으로 읽히게 한다.
const PLACE_SLACK = 2; // 조각을 붙일 때 가장 촘촘한 후보에서 이만큼(점수)까지 허용해 모양을 다양하게
const START_TRIES = 6; // 같은 판에서 시작 모양을 다시 뽑아 보는 횟수
const MAX_ATTEMPTS = 200000; // 단계마다 판 만들기 시도 상한(넘으면 오류)

// 조각 색 6가지(조각마다 다르게). 밝은 나무·보석 타일 느낌의 채도 있는 색.
export const PALETTE = ['#E8574B', '#F29E38', '#F2CD3C', '#5BB860', '#4A8FD9', '#9A6AD0'];

// 단계별 규칙(브리프): 조각 수, 삼각형 조각 수(1·2단계는 칸 조각만), 4단계 최소 이동 수 범위.
export const STAGE_RULES = {
  1: { minPieces: 3, maxPieces: 3, minTri: 0, maxTri: 0 },
  2: { minPieces: 3, maxPieces: 4, minTri: 0, maxTri: 0 },
  3: { minPieces: 3, maxPieces: 4, minTri: 1, maxTri: 2 },
  4: { minPieces: 4, maxPieces: 5, minTri: 1, maxTri: 2, minMoves: [3, 8] },
};

// ---- 시드 난수 (큐브 왕국 gen-puzzles.mjs와 같은 mulberry32) ----
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const rand = mulberry32(seed);
  const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)); // 양 끝 포함
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return { rand, randInt, pick, shuffle };
}

const k1 = (t) => key([t]);
const CELL_LIB = LIBRARY.filter((p) => p.kind === 'cell');
const TRI_LIB = LIBRARY.filter((p) => p.kind === 'tri');

// 변을 공유하는 이웃 사분 삼각형(grid.js connected와 같은 규칙).
function neighbors([x, y, q]) {
  const out = [[x, y, (q + 1) % 4], [x, y, (q + 3) % 4]];
  if (q === 0) out.push([x, y - 1, 2]);
  if (q === 1) out.push([x + 1, y, 3]);
  if (q === 2) out.push([x, y + 1, 0]);
  if (q === 3) out.push([x - 1, y, 1]);
  return out;
}

// 칸 단위 경계 상자 {x0, y0, w, h}.
export function bbox(tris) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of tris) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 판 넓이(칸) / 경계 상자 넓이.
export function fillRatio(tris) {
  const { w, h } = bbox(tris);
  return tris.length / 4 / (w * h);
}

// 구멍 없음: 경계 상자를 한 칸씩 넓힌 영역에서 판이 아닌 삼각형들이 모두 바깥과 이어져 있으면 true.
export function holeFree(tris) {
  const { x0, y0, w, h } = bbox(tris);
  const on = new Set(tris.map(k1));
  const rest = [];
  for (let y = y0 - 1; y <= y0 + h; y++) {
    for (let x = x0 - 1; x <= x0 + w; x++) {
      for (let q = 0; q < 4; q++) if (!on.has(k1([x, y, q]))) rest.push([x, y, q]);
    }
  }
  return connected(rest);
}

// ---- 조각 고르기 ----
// 같은 라이브러리 조각은 한 문제에 한 번만(바꿔 끼우기가 해답 수를 부풀리므로), 대칭 조각은 1개 이하.
// n = 조각 수(단계 범위 안에서 문제 번호마다 번갈아 정해 고르게 나눈다).
function pickPieces(rng, rule, n) {
  for (;;) {
    const t = rng.randInt(rule.minTri, Math.min(rule.maxTri, n - 1));
    const chosen = [
      ...rng.shuffle([...TRI_LIB]).slice(0, t),
      ...rng.shuffle([...CELL_LIB]).slice(0, n - t),
    ];
    if (chosen.filter((p) => p.symmetric).length <= 1) return rng.shuffle(chosen);
  }
}

// ---- 판 만들기: 조각을 하나씩 변을 맞대 붙인다 ----
// 후보 점수 = 경계 상자 넓이×4 − 맞닿은 변 수(작을수록 촘촘). 가장 좋은 점수 + PLACE_SLACK 안에서 무작위로 고른다.
function assemble(rng, libs) {
  const first = rng.pick(orientations(libs[0].tris)).tris;
  const placed = [first];
  const taken = new Set(first.map(k1));
  for (let i = 1; i < libs.length; i++) {
    const union = placed.flat();
    const ub = bbox(union);
    const cands = [];
    for (const g of orientations(libs[i].tris)) {
      const gb = bbox(g.tris);
      for (let dy = ub.y0 - gb.h; dy <= ub.y0 + ub.h; dy++) {
        for (let dx = ub.x0 - gb.w; dx <= ub.x0 + ub.w; dx++) {
          const t = translate(g.tris, dx, dy);
          if (t.some((q) => taken.has(k1(q)))) continue;
          let contacts = 0;
          for (const q of t) for (const nb of neighbors(q)) if (taken.has(k1(nb))) contacts++;
          if (contacts === 0) continue;
          const b = bbox([...union, ...t]);
          if (b.w > MAX_W || b.h > MAX_H) continue;
          cands.push({ t, score: b.w * b.h * 4 - contacts });
        }
      }
    }
    if (cands.length === 0) return null;
    const best = Math.min(...cands.map((c) => c.score));
    const near = cands.filter((c) => c.score <= best + PLACE_SLACK);
    const c = rng.pick(near);
    placed.push(c.t);
    for (const q of c.t) taken.add(k1(q));
  }
  return placed;
}

// 해답 기록이 가리키는 놓인 삼각형.
const placeOf = (start, r) => translate(normalize(applyElem(start, r.elem)), r.dx, r.dy);

// 3단계 이동 조건 카드: needs가 참인 조각만. 'flip' | 'turn' | 'flipturn'.
export function cardsFor(puzzle) {
  const nd = needs(puzzle);
  const cards = {};
  for (const p of puzzle.pieces) {
    const { flip, turn } = nd[p.id];
    if (flip && turn) cards[p.id] = 'flipturn';
    else if (flip) cards[p.id] = 'flip';
    else if (turn) cards[p.id] = 'turn';
  }
  return cards;
}

// 판 하나(조각별 놓인 모양)에서 시작 모양을 뽑아 채택 조건을 만족하는 문제를 만든다. 실패하면 null.
function makePuzzle(rng, stage, libs, placedShapes) {
  const rule = STAGE_RULES[stage];
  const origin = bbox(placedShapes.flat());
  const shapes = placedShapes.map((t) => translate(t, -origin.x0, -origin.y0));
  const board = normalize(shapes.flat());
  const ids = 'abcdef'.slice(0, libs.length).split('');
  for (let attempt = 0; attempt < START_TRIES; attempt++) {
    const colors = rng.shuffle([...PALETTE]);
    const pieces = libs.map((lib, i) => ({
      id: ids[i],
      lib: lib.id,
      start: normalize(applyElem(normalize(shapes[i]), rng.pick(D4))),
      color: colors[i],
    }));
    const solutions = solve(board, pieces, { limit: SOLUTION_LIMIT });
    if (solutions.length === 0 || solutions.length > MAX_SOLUTIONS) return null; // 판이 정하는 값: 다시 뽑아도 같다
    const pz = { id: '', stage, board, pieces, solutions };
    const nd = Object.values(needs(pz));
    if (!nd.some((x) => x.flip) || !nd.some((x) => x.turn)) continue;
    const minMoves = minMovesOf(pz);
    if (!Number.isFinite(minMoves)) continue;
    if (rule.minMoves && (minMoves < rule.minMoves[0] || minMoves > rule.minMoves[1])) continue;
    const cards = stage === 3 ? cardsFor(pz) : {};
    if (stage === 3 && Object.keys(cards).length === 0) continue;
    // 만든 배치(거꾸로 만들기의 원래 답)가 해답 목록에 들어 있는지 스스로 확인.
    const own = pieces.map((p, i) => key(shapes[i]));
    const hasOwn = solutions.some((sol) => sol.every((r, i) => key(placeOf(pieces[i].start, r)) === own[i]));
    if (!hasOwn) throw new Error('generator: assembled layout missing from solutions');
    return { stage, board, pieces, solutions, minMoves, cards };
  }
  return null;
}

// 한 단계 40문제. 같은 판·같은 조각 묶음은 한 번만.
export function generateStage(stage) {
  const rng = makeRng(SEED + stage);
  const rule = STAGE_RULES[stage];
  const out = [];
  const seen = new Set();
  let attempts = 0;
  while (out.length < PER_STAGE) {
    if (++attempts > MAX_ATTEMPTS) throw new Error(`stage ${stage}: only ${out.length} puzzles after ${MAX_ATTEMPTS} attempts`);
    const n = rule.minPieces + (out.length % (rule.maxPieces - rule.minPieces + 1));
    const libs = pickPieces(rng, rule, n);
    const shapes = assemble(rng, libs);
    if (!shapes) continue;
    const union = shapes.flat();
    if (fillRatio(union) < MIN_FILL || !holeFree(union)) continue;
    const sig = `${key(normalize(union))}|${libs.map((l) => l.id).sort().join(',')}`;
    if (seen.has(sig)) continue;
    const pz = makePuzzle(rng, stage, libs, shapes);
    if (!pz) continue;
    seen.add(sig);
    const id = `s${stage}-${String(out.length + 1).padStart(3, '0')}`;
    out.push({ id, ...pz });
  }
  return { puzzles: out, attempts };
}

// 네 단계 전부. {1: puzzles[], 2: ..., 3: ..., 4: ...}
export function generateAll() {
  const out = {};
  for (const s of [1, 2, 3, 4]) out[s] = generateStage(s).puzzles;
  return out;
}

// 파일 내용: 문제 하나가 한 줄(키 순서는 만든 순서 그대로라 결정적).
export function fileText(puzzles) {
  return `[\n${puzzles.map((p) => JSON.stringify(p)).join(',\n')}\n]\n`;
}

// ---- 분포 보고 ----
const tally = (vals) => {
  const m = new Map();
  for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, n]) => `${k}:${n}`).join(' ');
};

export function distribution(puzzles) {
  const fills = puzzles.map((p) => fillRatio(p.board));
  return {
    solutions: tally(puzzles.map((p) => p.solutions.length)),
    minMoves: tally(puzzles.map((p) => p.minMoves)),
    pieces: tally(puzzles.map((p) => p.pieces.length)),
    libs: tally(puzzles.flatMap((p) => p.pieces.map((x) => x.lib))),
    size: tally(puzzles.map((p) => { const b = bbox(p.board); return `${b.w}x${b.h}`; })),
    fill: `min ${Math.min(...fills).toFixed(2)} avg ${(fills.reduce((a, b) => a + b, 0) / fills.length).toFixed(2)} max ${Math.max(...fills).toFixed(2)}`,
    fillBands: tally(fills.map((f) => (f >= 0.9 ? '0.9+' : f >= 0.8 ? '0.8-0.9' : f >= 0.7 ? '0.7-0.8' : '0.6-0.7'))),
    cards: tally(puzzles.flatMap((p) => Object.values(p.cards))),
  };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const t0 = Date.now();
  const dir = fileURLToPath(new URL('../data/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  for (const s of [1, 2, 3, 4]) {
    const ts = Date.now();
    const { puzzles, attempts } = generateStage(s);
    writeFileSync(`${dir}puzzles-s${s}.json`, fileText(puzzles));
    console.log(`stage ${s}: ${puzzles.length} puzzles, ${attempts} attempts, ${Date.now() - ts} ms`);
    for (const [k, v] of Object.entries(distribution(puzzles))) console.log(`  ${k.padEnd(9)} ${v}`);
  }
  console.log(`total ${Date.now() - t0} ms`);
}
