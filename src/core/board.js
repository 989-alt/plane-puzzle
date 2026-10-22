// 판정: 놓기 가능, 정답, 1단계 붉은 표시. 순수 함수만 둔다(DOM·저장소 금지).
//
// 자리 약속(해답 기록·놓인 조각 모두 같음): 놓인 삼각형 = translate(normalize(모양), dx, dy).
// 즉 dx·dy는 정규화한 모양의 최소 모서리(x·y 최솟값)가 가는 칸이다.
// - 해답 기록 {id, elem, dx, dy}: 모양 = applyElem(start, elem)
// - 놓인 조각 {id, tris, at:[dx, dy]}: 모양 = tris(지금 모양). at이 null·undefined이면 판 밖(트레이)이라 판정에서 뺀다.
import { normalize, translate, key } from './grid.js';
import { applyElem } from './pieces.js';

const k1 = (t) => key([t]);
const keySet = (tris) => new Set(tris.map(k1));
const onBoard = (p) => Array.isArray(p.at);

export function placedTris(piece) {
  const [dx, dy] = piece.at;
  return translate(normalize(piece.tris), dx, dy);
}

// tris(이미 판 좌표)가 모두 판 안이고 다른 조각과 겹치지 않으면 true.
// others: 다른 조각들의 놓인 삼각형 목록(Tri[][]), 또는 그것을 하나로 합친 Tri[].
export function canPlace(boardTris, others, tris) {
  const board = keySet(boardTris);
  const flat = others.length > 0 && typeof others[0][0] === 'number' ? others : others.flat();
  const taken = keySet(flat);
  return tris.every((t) => {
    const k = k1(t);
    return board.has(k) && !taken.has(k);
  });
}

// 판에 놓인 조각들의 합집합이 판 삼각형 집합과 정확히 같고 겹침이 없으면 true.
export function isSolved(puzzle, placed) {
  const board = keySet(puzzle.board);
  const seen = new Set();
  for (const p of placed) {
    if (!onBoard(p)) continue;
    for (const t of placedTris(p)) {
      const k = k1(t);
      if (seen.has(k) || !board.has(k)) return false;
      seen.add(k);
    }
  }
  return seen.size === board.size;
}

// 조각마다, 저장 해답 어느 하나에서라도 그 조각이 차지하는 삼각형의 합집합.
function solutionSpots(puzzle) {
  const start = new Map(puzzle.pieces.map((p) => [p.id, p.start]));
  const spots = new Map();
  for (const sol of puzzle.solutions) {
    for (const r of sol) {
      if (!spots.has(r.id)) spots.set(r.id, new Set());
      const set = spots.get(r.id);
      for (const t of translate(normalize(applyElem(start.get(r.id), r.elem)), r.dx, r.dy)) set.add(k1(t));
    }
  }
  return spots;
}

// 붉게 칠할 삼각형 키 집합: 판 밖이거나, 그 조각이 어떤 저장 해답에서도 차지하지 않는 삼각형.
// 해답이 여러 개면 어느 해답의 자리든 맞는 자리로 본다(Review Focus 4).
export function wrongTris(puzzle, placed) {
  const board = keySet(puzzle.board);
  const spots = solutionSpots(puzzle);
  const wrong = new Set();
  for (const p of placed) {
    if (!onBoard(p)) continue;
    const mine = spots.get(p.id);
    for (const t of placedTris(p)) {
      const k = k1(t);
      if (!board.has(k) || !mine || !mine.has(k)) wrong.add(k);
    }
  }
  return wrong;
}
