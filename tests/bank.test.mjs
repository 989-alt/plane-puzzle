// 문제 은행(data/puzzles-s1..s4.json)·생성기·전수 감사 시험.
// 채택 조건은 감사 도구와 따로, solver·pieces 함수로 직접 다시 확인한다(감사 도구만 믿지 않기 위해).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { key, normalize, translate, connected } from '../src/core/grid.js';
import { D4, applyElem, LIBRARY, MOVES, applyMove, pieceMoves } from '../src/core/pieces.js';
import { isSolved } from '../src/core/board.js';
import { solve, needs, minMovesOf } from '../src/core/solver.js';
import { PALETTE, STAGE_RULES, generateAll, fileText } from '../tools/gen-puzzles.mjs';
import { auditPuzzle, auditBank, buttonDistance } from '../tools/audit-puzzles.mjs';

const ROOT = new URL('../', import.meta.url);
const STAGES = [1, 2, 3, 4];
const fileOf = (s) => fileURLToPath(new URL(`data/puzzles-s${s}.json`, ROOT));
const readBank = (s) => JSON.parse(readFileSync(fileOf(s), 'utf8'));
const banks = Object.fromEntries(STAGES.map((s) => [s, readBank(s)]));
const all = STAGES.flatMap((s) => banks[s]);
const libOf = (id) => LIBRARY.find((p) => p.id === id);
const placeOf = (start, r) => translate(normalize(applyElem(start, r.elem)), r.dx, r.dy);
const clone = (x) => JSON.parse(JSON.stringify(x));

// 조각 수·삼각형 조각 수 기대값(브리프 그대로).
const PIECES = { 1: [3, 3], 2: [3, 4], 3: [3, 4], 4: [4, 5] };
const TRI = { 1: [0, 0], 2: [0, 0], 3: [1, 2], 4: [1, 2] };

test('generator stage rules match the brief', () => {
  for (const s of STAGES) {
    assert.deepEqual([STAGE_RULES[s].minPieces, STAGE_RULES[s].maxPieces], PIECES[s], `stage ${s} piece count`);
    assert.deepEqual([STAGE_RULES[s].minTri, STAGE_RULES[s].maxTri], TRI[s], `stage ${s} tri count`);
  }
  assert.equal(PALETTE.length, 6);
  assert.equal(new Set(PALETTE).size, 6);
  for (const c of PALETTE) assert.match(c, /^#[0-9A-F]{6}$/);
});

test('4 files x 40 puzzles, ids unique and s{stage}-NNN', () => {
  const ids = new Set();
  for (const s of STAGES) {
    assert.equal(banks[s].length, 40, `stage ${s} size`);
    banks[s].forEach((pz, i) => {
      assert.equal(pz.stage, s);
      assert.equal(pz.id, `s${s}-${String(i + 1).padStart(3, '0')}`);
      ids.add(pz.id);
    });
  }
  assert.equal(ids.size, 160);
});

test('no two puzzles in a stage share the same board and piece set', () => {
  for (const s of STAGES) {
    const sigs = banks[s].map((pz) => `${key(normalize(pz.board))}|${pz.pieces.map((p) => p.lib).sort().join(',')}`);
    assert.equal(new Set(sigs).size, sigs.length, `stage ${s}`);
  }
});

test('pieces: count, kinds, distinct library pieces, symmetric <= 1, start normalized and a D4 image', () => {
  for (const pz of all) {
    const n = pz.pieces.length;
    assert.ok(n >= PIECES[pz.stage][0] && n <= PIECES[pz.stage][1], `${pz.id} piece count ${n}`);
    const libs = pz.pieces.map((p) => libOf(p.lib));
    assert.ok(libs.every(Boolean), `${pz.id} unknown lib`);
    assert.equal(new Set(pz.pieces.map((p) => p.lib)).size, n, `${pz.id} duplicate library piece`);
    assert.equal(new Set(pz.pieces.map((p) => p.id)).size, n, `${pz.id} duplicate piece id`);
    const tri = libs.filter((l) => l.kind === 'tri').length;
    assert.ok(tri >= TRI[pz.stage][0] && tri <= TRI[pz.stage][1], `${pz.id} tri count ${tri}`);
    assert.ok(libs.filter((l) => l.symmetric).length <= 1, `${pz.id} symmetric pieces`);
    for (const p of pz.pieces) {
      assert.deepEqual(p.start, normalize(p.start), `${pz.id}/${p.id} start normalized`);
      const lib = libOf(p.lib).tris;
      assert.ok(D4.some((e) => key(normalize(applyElem(lib, e))) === key(p.start)), `${pz.id}/${p.id} start is a D4 image of ${p.lib}`);
    }
  }
});

test('colors: distinct palette hex values within a puzzle', () => {
  for (const pz of all) {
    const cs = pz.pieces.map((p) => p.color);
    for (const c of cs) assert.ok(PALETTE.includes(c), `${pz.id} color ${c}`);
    assert.equal(new Set(cs).size, cs.length, `${pz.id} colors distinct`);
  }
});

test('board: normalized, connected, area = pieces, bounding box <= 6 x 6 cells', () => {
  for (const pz of all) {
    assert.deepEqual(pz.board, normalize(pz.board), `${pz.id} board normalized`);
    assert.equal(new Set(pz.board.map((t) => key([t]))).size, pz.board.length, `${pz.id} board has no duplicate tris`);
    assert.ok(connected(pz.board), `${pz.id} connected`);
    const area = pz.pieces.reduce((s, p) => s + p.start.length, 0);
    assert.equal(area, pz.board.length, `${pz.id} area`);
    const w = Math.max(...pz.board.map((t) => t[0])) + 1;
    const h = Math.max(...pz.board.map((t) => t[1])) + 1;
    assert.ok(w <= 6 && h <= 6, `${pz.id} bbox ${w}x${h}`);
  }
});

test('solutions: 1~6, stored = solve() rerun, every one isSolved', () => {
  for (const pz of all) {
    assert.ok(pz.solutions.length >= 1 && pz.solutions.length <= 6, `${pz.id} ${pz.solutions.length} solutions`);
    const fresh = solve(pz.board, pz.pieces, { limit: 200 });
    assert.deepEqual(fresh, pz.solutions, `${pz.id} stored solutions equal a fresh solve`);
    for (const sol of pz.solutions) {
      const placed = sol.map((r) => {
        const p = pz.pieces.find((x) => x.id === r.id);
        return { id: r.id, tris: applyElem(p.start, r.elem), at: [r.dx, r.dy] };
      });
      assert.ok(isSolved(pz, placed), `${pz.id} solution solves`);
    }
  }
});

test('every solution needs a flip on some piece and a turn on some piece', () => {
  for (const pz of all) {
    const nd = needs(pz);
    assert.ok(Object.values(nd).some((x) => x.flip), `${pz.id} flip`);
    assert.ok(Object.values(nd).some((x) => x.turn), `${pz.id} turn`);
  }
});

test('minMoves matches minMovesOf for every puzzle; stage 4 is 3~8', () => {
  for (const pz of all) {
    assert.ok(Number.isInteger(pz.minMoves), `${pz.id} minMoves integer`);
    assert.equal(pz.minMoves, minMovesOf(pz), pz.id);
    if (pz.stage === 4) assert.ok(pz.minMoves >= 3 && pz.minMoves <= 8, `${pz.id} minMoves ${pz.minMoves}`);
  }
});

test('cards: stage 3 has a card for exactly the pieces whose needs are true; other stages store {}', () => {
  const want = ({ flip, turn }) => (flip && turn ? 'flipturn' : flip ? 'flip' : turn ? 'turn' : null);
  for (const pz of all) {
    assert.equal(typeof pz.cards, 'object');
    if (pz.stage !== 3) {
      assert.deepEqual(pz.cards, {}, pz.id);
      continue;
    }
    const nd = needs(pz);
    const expected = {};
    for (const p of pz.pieces) if (want(nd[p.id])) expected[p.id] = want(nd[p.id]);
    assert.deepEqual(pz.cards, expected, pz.id);
    assert.ok(Object.keys(pz.cards).length >= 1, `${pz.id} at least one card`);
  }
});

test('buttonDistance: BFS over MOVES agrees with hand values', () => {
  const L4 = libOf('L4').tris;
  assert.equal(buttonDistance(L4, L4), 0);
  assert.equal(buttonDistance(L4, applyMove(L4, 'cw90')), 1);
  assert.equal(buttonDistance(L4, applyMove(L4, 'flipLeft')), 1);
  assert.equal(buttonDistance(L4, applyMove(applyMove(L4, 'flipLeft'), 'cw90')), 2);
  assert.equal(buttonDistance(L4, libOf('I3').tris), null);
  // BFS 결과는 MIN_MOVES 표(pieceMoves)와 모든 조각·원소에서 같아야 한다.
  for (const p of LIBRARY) {
    for (const e of D4) assert.equal(buttonDistance(p.tris, applyElem(p.tris, e)), pieceMoves(p.tris, applyElem(p.tris, e)), `${p.id} ${e}`);
  }
  assert.equal(MOVES.length, 10);
});

test('audit A~F reports 0 failures on the whole bank', () => {
  const report = auditBank(banks);
  for (const g of ['A', 'B', 'C', 'D', 'E', 'F']) assert.deepEqual(report[g], [], `audit ${g}`);
  assert.equal(report.checked, 160);
});

test('audit catches corrupted puzzles (one group per sabotage)', () => {
  const base = banks[3][0];
  const fails = (pz) => Object.entries(auditPuzzle(pz)).filter(([, v]) => v.length).map(([g]) => g);
  assert.deepEqual(fails(base), []);

  let pz = clone(base); pz.board = pz.board.slice(1);
  assert.ok(fails(pz).includes('A'), 'board shrink -> A');

  pz = clone(base); pz.solutions[0][0].dx += 1;
  assert.ok(fails(pz).includes('B'), 'shifted solution -> B');

  const multi = all.find((x) => x.solutions.length >= 2);
  pz = clone(multi); pz.solutions.pop();
  assert.ok(fails(pz).includes('C'), 'dropped solution -> C');

  pz = clone(base); const pid = Object.keys(pz.cards)[0];
  pz.cards[pid] = pz.cards[pid] === 'flip' ? 'turn' : 'flip';
  assert.ok(fails(pz).includes('D'), 'wrong card -> D');

  pz = clone(base); pz.minMoves += 1;
  assert.ok(fails(pz).includes('E'), 'wrong minMoves -> E');

  pz = clone(base); pz.solutions[0][0].elem = 'nope';
  assert.ok(fails(pz).includes('F'), 'unreachable target -> F');
});

// 파일은 `node tools/gen-puzzles.mjs`가 쓴 것(첫 번째 실행), 여기서 다시 만든 것이 두 번째 실행이다.
// git autocrlf로 꺼낸 파일이 CRLF일 수 있어 줄 끝만 맞춰 비교한다.
test('generation is deterministic: regenerating gives the committed files byte for byte', () => {
  const out = generateAll();
  for (const s of STAGES) assert.equal(fileText(out[s]), readFileSync(fileOf(s), 'utf8').replace(/\r\n/g, '\n'), `stage ${s}`);
});
