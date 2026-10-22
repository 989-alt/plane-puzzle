// board·solver 시험이 함께 쓰는 손으로 만든 퍼즐. (*.test.mjs가 아니므로 시험 파일로 실행되지 않는다.)
import { cell, normalize } from '../src/core/grid.js';
import { applyElem, LIBRARY } from '../src/core/pieces.js';

export const lib = (id) => LIBRARY.find((p) => p.id === id).tris;
export const cells = (list) => list.flatMap(([x, y]) => cell(x, y));

// U자(ㄷ자) 판 7칸:
//   X X X
//   X . .
//   X X X
// L4 + I3로 덮는 방법은 정확히 2가지: I3가 윗줄(L4는 아래 ㄴ자) 또는 아랫줄(L4는 위 ㄱ자).
export const U_BOARD = cells([[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 2], [2, 2]]);

export function uPuzzle({ l4Start = lib('L4'), i3Start = lib('I3') } = {}) {
  return {
    id: 't-u',
    stage: 1,
    board: U_BOARD,
    pieces: [
      { id: 'a', lib: 'L4', start: l4Start, color: 'red' },
      { id: 'b', lib: 'I3', start: i3Start, color: 'blue' },
    ],
    // 손으로 구한 해답. L4 기본(세로 막대, 발은 아래 오른쪽):
    //   r90    -> 윗줄 3칸 + 왼쪽 아래 1칸 (ㄱ자, 판 위쪽)
    //   fx_r90 -> 왼쪽 위 1칸 + 아랫줄 3칸 (ㄴ자, 판 아래쪽)
    solutions: [
      [{ id: 'a', elem: 'r90', dx: 0, dy: 0 }, { id: 'b', elem: 'id', dx: 0, dy: 2 }],
      [{ id: 'a', elem: 'fx_r90', dx: 0, dy: 1 }, { id: 'b', elem: 'id', dx: 0, dy: 0 }],
    ],
  };
}

// 저장 해답 하나를 놓인 상태(placed)로 바꾼다. tris는 일부러 정규화하지 않는다(placedTris가 정규화해야 함).
export function placedFrom(puzzle, solution) {
  return solution.map((r) => {
    const p = puzzle.pieces.find((x) => x.id === r.id);
    return { id: r.id, tris: applyElem(p.start, r.elem), at: [r.dx, r.dy] };
  });
}

export const shapeOf = (tris, e) => normalize(applyElem(tris, e));
