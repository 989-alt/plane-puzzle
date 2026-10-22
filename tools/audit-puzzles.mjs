// 문제 은행 전수 감사. node tools/audit-puzzles.mjs → 콘솔 보고, 실패가 하나라도 있으면 종료 코드 1.
// A 형식·연결·판 크기  B 저장 해답이 모두 isSolved  C solve 재실행 해답 = 저장 해답
// D 조건 카드가 모든 해답에서 참(+ 뒤집기·돌리기가 필요한 조각 존재)  E minMoves 재계산 일치
// F 실제 조작 흉내: 조각마다 start에서 MOVES 버튼만으로(BFS) 해답 모양에 닿는 최소 버튼 수 = pieceMoves,
//   그 모양을 해답 자리에 놓으면 판이 완성되고, 버튼 수 합의 최솟값 = minMoves.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { normalize, translate, key, connected } from '../src/core/grid.js';
import { D4, MOVES, applyMove, applyElem, LIBRARY, pieceMoves } from '../src/core/pieces.js';
import { isSolved } from '../src/core/board.js';
import { solve, needs, minMovesOf } from '../src/core/solver.js';
import { PALETTE, STAGE_RULES, MAX_W, MAX_H, bbox, holeFree, cardsFor } from './gen-puzzles.mjs';

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F'];
const STAGES = [1, 2, 3, 4];
const PER_STAGE = 40;
const CARD_VALUES = new Set(['flip', 'turn', 'flipturn']);
const isTri = (t) => Array.isArray(t) && t.length === 3 && t.every(Number.isInteger) && t[2] >= 0 && t[2] <= 3;
const libOf = (id) => LIBRARY.find((p) => p.id === id);

// from 모양에서 MOVES 버튼만 눌러 to 모양(정규화 비교)에 닿는 최소 버튼 수. 닿지 못하면 null.
export function buttonDistance(from, to) {
  const target = key(normalize(to));
  const s0 = normalize(from);
  const dist = new Map([[key(s0), 0]]);
  const queue = [s0];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(key(cur));
    if (key(cur) === target) return d;
    for (const m of MOVES) {
      const nx = applyMove(cur, m);
      const k = key(nx);
      if (!dist.has(k)) {
        dist.set(k, d + 1);
        queue.push(nx);
      }
    }
  }
  return null;
}

// 형식 검사. 이 검사가 실패하면 나머지 검사는 하지 않는다(엉뚱한 예외 대신 A 실패로 보고).
function checkFormat(pz) {
  const err = [];
  const rule = STAGE_RULES[pz.stage];
  if (!rule) return [`stage ${pz.stage} unknown`];
  if (typeof pz.id !== 'string' || !new RegExp(`^s${pz.stage}-\\d{3}$`).test(pz.id)) err.push(`bad id ${pz.id}`);
  if (!Array.isArray(pz.board) || pz.board.length === 0 || !pz.board.every(isTri)) return [...err, 'board not a Tri[]'];
  if (!Array.isArray(pz.pieces)) return [...err, 'pieces missing'];
  if (!Array.isArray(pz.solutions)) return [...err, 'solutions missing'];
  if (!Number.isInteger(pz.minMoves)) err.push(`minMoves not an integer: ${pz.minMoves}`);
  if (!pz.cards || typeof pz.cards !== 'object' || Array.isArray(pz.cards)) err.push('cards not an object');

  // 조각
  const n = pz.pieces.length;
  if (n < rule.minPieces || n > rule.maxPieces) err.push(`piece count ${n} outside ${rule.minPieces}~${rule.maxPieces}`);
  const libs = [];
  for (const p of pz.pieces) {
    const lib = libOf(p.lib);
    if (!lib) { err.push(`piece ${p.id}: unknown lib ${p.lib}`); continue; }
    libs.push(lib);
    if (!Array.isArray(p.start) || !p.start.every(isTri)) { err.push(`piece ${p.id}: start not a Tri[]`); continue; }
    if (key(p.start) !== key(normalize(p.start)) || JSON.stringify(p.start) !== JSON.stringify(normalize(p.start))) err.push(`piece ${p.id}: start not normalized`);
    if (!D4.some((e) => key(normalize(applyElem(lib.tris, e))) === key(p.start))) err.push(`piece ${p.id}: start is not a D4 image of ${p.lib}`);
    if (!PALETTE.includes(p.color)) err.push(`piece ${p.id}: color ${p.color} not in palette`);
  }
  if (new Set(pz.pieces.map((p) => p.id)).size !== n) err.push('duplicate piece id');
  if (new Set(pz.pieces.map((p) => p.lib)).size !== n) err.push('duplicate library piece');
  if (new Set(pz.pieces.map((p) => p.color)).size !== n) err.push('colors not distinct');
  const tri = libs.filter((l) => l.kind === 'tri').length;
  if (tri < rule.minTri || tri > rule.maxTri) err.push(`tri pieces ${tri} outside ${rule.minTri}~${rule.maxTri}`);
  if (libs.filter((l) => l.symmetric).length > 1) err.push('more than one symmetric piece');

  // 판
  const ks = pz.board.map((t) => key([t]));
  if (new Set(ks).size !== ks.length) err.push('board has duplicate tris');
  if (JSON.stringify(pz.board) !== JSON.stringify(normalize(pz.board))) err.push('board not normalized');
  if (!connected(pz.board)) err.push('board not connected');
  if (!holeFree(pz.board)) err.push('board has a hole');
  const b = bbox(pz.board);
  if (b.w > MAX_W || b.h > MAX_H) err.push(`board ${b.w}x${b.h} exceeds ${MAX_W}x${MAX_H}`);
  const area = pz.pieces.reduce((s, p) => s + (Array.isArray(p.start) ? p.start.length : 0), 0);
  if (area !== pz.board.length) err.push(`piece area ${area} != board ${pz.board.length}`);

  // 해답 기록
  if (pz.solutions.length < 1 || pz.solutions.length > 6) err.push(`${pz.solutions.length} solutions (want 1~6)`);
  pz.solutions.forEach((sol, si) => {
    if (!Array.isArray(sol) || sol.length !== n) { err.push(`solution ${si}: wrong length`); return; }
    sol.forEach((r, i) => {
      if (!r || r.id !== pz.pieces[i]?.id) err.push(`solution ${si}: record ${i} id ${r && r.id} out of piece order`);
      if (!r || !Number.isInteger(r.dx) || !Number.isInteger(r.dy)) err.push(`solution ${si}: record ${i} dx/dy not integers`);
    });
  });

  // 카드 형식(내용 검사는 D)
  if (pz.cards && typeof pz.cards === 'object') {
    for (const [pid, v] of Object.entries(pz.cards)) {
      if (!pz.pieces.some((p) => p.id === pid)) err.push(`card for unknown piece ${pid}`);
      if (!CARD_VALUES.has(v)) err.push(`card ${pid}: bad value ${v}`);
    }
    if (pz.stage !== 3 && Object.keys(pz.cards).length > 0) err.push('cards only belong to stage 3');
  }
  return err;
}

const placedFrom = (pz, sol) => sol.map((r) => {
  const p = pz.pieces.find((x) => x.id === r.id);
  return { id: r.id, tris: applyElem(p.start, r.elem), at: [r.dx, r.dy] };
});

// 한 그룹을 돌리고 예외는 그 그룹의 실패로 적는다.
function run(fn) {
  try {
    return fn();
  } catch (e) {
    return [`threw: ${e.message}`];
  }
}

// 문제 하나 감사 → {A:[], B:[], C:[], D:[], E:[], F:[]} (메시지 목록, 비어 있으면 통과).
export function auditPuzzle(pz) {
  const out = Object.fromEntries(GROUPS.map((g) => [g, []]));
  out.A = run(() => checkFormat(pz));
  if (out.A.length) return out;

  out.B = run(() => {
    const err = [];
    pz.solutions.forEach((sol, si) => { if (!isSolved(pz, placedFrom(pz, sol))) err.push(`solution ${si} does not solve`); });
    return err;
  });

  out.C = run(() => {
    const fresh = solve(pz.board, pz.pieces, { limit: 200 });
    if (fresh.length !== pz.solutions.length) return [`solve finds ${fresh.length}, stored ${pz.solutions.length}`];
    const a = fresh.map((s) => JSON.stringify(s)).sort();
    const b = pz.solutions.map((s) => JSON.stringify(s)).sort();
    return JSON.stringify(a) === JSON.stringify(b) ? [] : ['stored solutions differ from solve()'];
  });

  out.D = run(() => {
    const err = [];
    const nd = needs(pz);
    if (!Object.values(nd).some((x) => x.flip)) err.push('no piece needs a flip in every solution');
    if (!Object.values(nd).some((x) => x.turn)) err.push('no piece needs a turn in every solution');
    // 카드가 말하는 조건이 모든 해답에서 참인지(needs가 '모든 해답에서 참'일 때만 true).
    for (const [pid, v] of Object.entries(pz.cards)) {
      if ((v === 'flip' || v === 'flipturn') && !nd[pid].flip) err.push(`card ${pid}=${v} but flip is not needed in every solution`);
      if ((v === 'turn' || v === 'flipturn') && !nd[pid].turn) err.push(`card ${pid}=${v} but turn is not needed in every solution`);
    }
    if (pz.stage === 3) {
      if (JSON.stringify(pz.cards) !== JSON.stringify(cardsFor(pz))) err.push(`cards ${JSON.stringify(pz.cards)} != expected ${JSON.stringify(cardsFor(pz))}`);
      if (Object.keys(pz.cards).length === 0) err.push('stage 3 needs at least one card');
    }
    return err;
  });

  out.E = run(() => {
    const err = [];
    const m = minMovesOf(pz);
    if (m !== pz.minMoves) err.push(`minMoves ${pz.minMoves} != recomputed ${m}`);
    const range = STAGE_RULES[pz.stage].minMoves;
    if (range && (pz.minMoves < range[0] || pz.minMoves > range[1])) err.push(`minMoves ${pz.minMoves} outside ${range[0]}~${range[1]}`);
    return err;
  });

  out.F = run(() => {
    const err = [];
    let best = Infinity;
    pz.solutions.forEach((sol, si) => {
      let sum = 0;
      const placed = [];
      for (const r of sol) {
        const p = pz.pieces.find((x) => x.id === r.id);
        const target = normalize(applyElem(p.start, r.elem));
        const d = buttonDistance(p.start, target);
        const pm = pieceMoves(p.start, target);
        if (d === null) { err.push(`solution ${si} piece ${r.id}: not reachable with buttons`); continue; }
        if (d !== pm) err.push(`solution ${si} piece ${r.id}: buttons ${d} != pieceMoves ${pm}`);
        sum += d;
        placed.push({ id: r.id, tris: target, at: [r.dx, r.dy] });
      }
      if (placed.length === sol.length && !isSolved(pz, placed)) err.push(`solution ${si}: button-made shapes do not complete the board`);
      if (sum < best) best = sum;
    });
    if (best !== pz.minMoves) err.push(`button-only minimum ${best} != minMoves ${pz.minMoves}`);
    return err;
  });
  return out;
}

// 은행 전체 감사. banks = {1: puzzles[], ..., 4: puzzles[]}.
// → {A:[...], ..., F:[...], checked} 메시지마다 문제 id를 붙인다. 은행 단위 검사(40문제·id 유일·중복 판)는 A.
export function auditBank(banks) {
  const report = Object.fromEntries(GROUPS.map((g) => [g, []]));
  const ids = new Set();
  let checked = 0;
  for (const s of STAGES) {
    const list = banks[s] || [];
    if (list.length !== PER_STAGE) report.A.push(`stage ${s}: ${list.length} puzzles (want ${PER_STAGE})`);
    const sigs = new Set();
    list.forEach((pz, i) => {
      if (pz.stage !== s) report.A.push(`${pz.id}: stage ${pz.stage} in stage ${s} file`);
      if (pz.id !== `s${s}-${String(i + 1).padStart(3, '0')}`) report.A.push(`${pz.id}: out of sequence at ${i}`);
      if (ids.has(pz.id)) report.A.push(`${pz.id}: duplicate id`);
      ids.add(pz.id);
      if (Array.isArray(pz.board) && Array.isArray(pz.pieces)) {
        const sig = `${key(normalize(pz.board))}|${pz.pieces.map((p) => p.lib).sort().join(',')}`;
        if (sigs.has(sig)) report.A.push(`${pz.id}: same board and pieces as an earlier puzzle`);
        sigs.add(sig);
      }
      const r = auditPuzzle(pz);
      for (const g of GROUPS) for (const m of r[g]) report[g].push(`${pz.id}: ${m}`);
      checked++;
    });
  }
  report.checked = checked;
  return report;
}

export function loadBanks(dir = fileURLToPath(new URL('../data/', import.meta.url))) {
  return Object.fromEntries(STAGES.map((s) => [s, JSON.parse(readFileSync(`${dir}puzzles-s${s}.json`, 'utf8'))]));
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const t0 = Date.now();
  const report = auditBank(loadBanks());
  const names = {
    A: 'format/connected/size', B: 'stored solutions solve', C: 'solve rerun = stored',
    D: 'condition cards', E: 'minMoves', F: 'button-only reachability',
  };
  let fail = 0;
  console.log(`audited ${report.checked} puzzles in ${Date.now() - t0} ms`);
  for (const g of GROUPS) {
    fail += report[g].length;
    console.log(`${g} ${names[g].padEnd(26)} ${report[g].length === 0 ? 'ok' : `${report[g].length} FAIL`}`);
    for (const m of report[g].slice(0, 20)) console.log(`    ${m}`);
  }
  console.log(fail === 0 ? 'ALL PASS' : `${fail} failures`);
  process.exit(fail === 0 ? 0 : 1);
}
