// 이동 패널 자리(src/view/panelPlace.js). 큐브 왕국 ringPlace.js 이식.
// Review Focus 2: 패널이 열린 채 다른 조각을 누르거나 끌어도 탭이 버튼에 맞지 않도록, 패널은 어떤 조각·UI도 덮지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalize } from '../src/core/grid.js';
import { stageSize, fitPuzzle, hudRects, cellBoxes } from '../src/view/geom.js';
import { placePanel, panelSize, panelButtons, panelCaptions, BTN_W, BTN_H, PANEL_MOVES } from '../src/view/panelPlace.js';

const ROOT = new URL('../', import.meta.url);
const bank = (s) => JSON.parse(readFileSync(fileURLToPath(new URL(`data/puzzles-s${s}.json`, ROOT)), 'utf8'));
const ALL = [1, 2, 3, 4].flatMap(bank);
const SIZES = [stageSize(1280, 800), stageSize(1024, 768)];

const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const rectOf = (p) => ({ l: p.x, t: p.y, r: p.x + p.w, b: p.y + p.h });
const onScreen = (p, W, H) => p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H;

function startBoxes(puzzle, { W, H }) {
  const ui = hudRects(W, H);
  const { g, starts } = fitPuzzle(W, H, puzzle, ui);
  const boxes = puzzle.pieces.flatMap((pc) => cellBoxes(normalize(pc.start), starts[pc.id], g, pc.id));
  return { boxes, ui };
}

test('panel never covers pieces or ui', () => {
  let opened = 0;
  const bad = [];
  for (const size of SIZES) {
    for (const p of ALL) {
      const { boxes, ui } = startBoxes(p, size);
      for (const pc of p.pieces) {
        for (const hidden of [false, true]) {
          const panel = placePanel({ boxes, sel: pc.id, ui, W: size.W, H: size.H, hidden });
          opened += 1;
          const r = rectOf(panel);
          const n = boxes.filter((b) => hit(r, b)).length + ui.filter((u) => hit(r, u)).length;
          if (n > 0 || !onScreen(panel, size.W, size.H)) bad.push(`${p.id}/${pc.id}@${size.W}${hidden ? 'h' : ''}: ${n}`);
        }
      }
    }
  }
  assert.ok(opened > 1000, `opened ${opened}`);
  assert.deepEqual(bad, []);
});

test('panel sits next to the selected piece when there is room', () => {
  const W = 1280, H = 800;
  const boxes = [{ i: 'a', l: 100, t: 400, r: 220, b: 460 }];
  const p = placePanel({ boxes, sel: 'a', ui: [], W, H });
  const r = rectOf(p);
  const gap = Math.max(0, r.l - 220, 100 - r.r, r.t - 460, 400 - r.b);
  assert.ok(gap <= 24, `gap ${gap} ${JSON.stringify(p)}`);
  assert.ok(!hit(r, boxes[0]));
});

test('panel stays fully on screen near every edge', () => {
  const W = 1024, H = 640;
  for (const [l, t] of [[0, 0], [W - 60, 0], [0, H - 60], [W - 60, H - 60], [480, H - 60], [480, 0]]) {
    const boxes = [{ i: 'a', l, t, r: l + 60, b: t + 60 }];
    const p = placePanel({ boxes, sel: 'a', ui: [], W, H });
    assert.ok(onScreen(p, W, H), `${l},${t} ${JSON.stringify(p)}`);
    assert.ok(!hit(rectOf(p), boxes[0]), `${l},${t}`);
  }
});

test('when nothing is free the panel is still on screen and least covering', () => {
  const W = 1024, H = 640;
  const boxes = [];
  for (let x = 0; x < W; x += 50) for (let y = 0; y < H; y += 50) boxes.push({ i: 'z', l: x, t: y, r: x + 40, b: y + 40 });
  boxes.push({ i: 'a', l: 500, t: 300, r: 540, b: 340 });
  const p = placePanel({ boxes, sel: 'a', ui: [], W, H });
  assert.ok(onScreen(p, W, H));
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('placement is deterministic, keeps a clear prev, moves a covered prev', () => {
  const W = 1280, H = 800;
  const boxes = [{ i: 'a', l: 600, t: 380, r: 720, b: 440 }];
  const a = placePanel({ boxes, sel: 'a', ui: [], W, H });
  assert.deepEqual(placePanel({ boxes, sel: 'a', ui: [], W, H }), a);
  assert.deepEqual(placePanel({ boxes, sel: 'a', ui: [], W, H, prev: a }), a);
  const grown = [...boxes, { i: 'a', l: a.x + 10, t: a.y + 10, r: a.x + 60, b: a.y + 60 }];
  const moved = placePanel({ boxes: grown, sel: 'a', ui: [], W, H, prev: a });
  assert.notDeepEqual(moved, a);
  assert.ok(!grown.some((b) => hit(rectOf(moved), b)));
  // UI 가 생겨 덮게 되어도 옮긴다
  const ui = [{ l: a.x, t: a.y, r: a.x + 30, b: a.y + 30 }];
  const m2 = placePanel({ boxes, sel: 'a', ui, W, H, prev: a });
  assert.ok(!hit(rectOf(m2), ui[0]));
});

test('buttons: 10 moves (+ undo/reset when hidden), >= 48px, inside the panel, no overlap', () => {
  assert.ok(BTN_W >= 48 && BTN_H >= 48);
  for (const layout of ['wide', 'tall']) {
    for (const hidden of [false, true]) {
      const { w, h } = panelSize(layout);
      const btns = panelButtons(layout, hidden);
      assert.equal(btns.length, hidden ? 12 : 10);
      assert.deepEqual(btns.filter((b) => b.move).map((b) => b.move).sort(), [...PANEL_MOVES].sort());
      if (hidden) assert.deepEqual(btns.filter((b) => b.action).map((b) => b.action), ['undo', 'reset']);
      for (const b of btns) {
        assert.ok(b.w >= 48 && b.h >= 48);
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, `${layout} ${b.move || b.action}`);
      }
      for (let i = 0; i < btns.length; i++) {
        for (let j = i + 1; j < btns.length; j++) {
          const A = btns[i], B = btns[j];
          assert.ok(!hit({ l: A.x, t: A.y, r: A.x + A.w, b: A.y + A.h }, { l: B.x, t: B.y, r: B.x + B.w, b: B.y + B.h }));
        }
      }
    }
  }
});

test('placement is fast (< 15 ms worst) for 5 pieces', () => {
  const p = ALL.find((q) => q.id === 's4-040');
  const { boxes, ui } = startBoxes(p, SIZES[0]);
  placePanel({ boxes, sel: p.pieces[0].id, ui, W: 1280, H: 800 });
  let worst = 0;
  for (const pc of p.pieces) {
    const t0 = performance.now();
    placePanel({ boxes, sel: pc.id, ui, W: 1280, H: 800 });
    worst = Math.max(worst, performance.now() - t0);
  }
  assert.ok(worst < 15, `${worst.toFixed(1)}ms`);
});

test('group captions: 뒤집기 · 시계 방향 · 시계 반대 방향 above each group, inside the panel, not on any button', () => {
  for (const layout of ['wide', 'tall']) {
    for (const hidden of [false, true]) {
      const { w, h } = panelSize(layout);
      const btns = panelButtons(layout, hidden);
      const caps = panelCaptions(layout, hidden);
      assert.deepEqual(caps.map((c) => c.text), ['뒤집기', '시계 방향', '시계 반대 방향']);
      for (const c of caps) {
        const r = { l: c.x, t: c.y, r: c.x + c.w, b: c.y + c.h };
        assert.ok(c.x >= 0 && c.y >= 0 && r.r <= w && r.b <= h, `${layout} ${c.group} inside`);
        for (const b of btns) assert.ok(!hit(r, { l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h }), `${layout} ${c.group} on ${b.move || b.action}`);
        const first = btns.find((b) => b.group === c.group);
        assert.equal(c.y + c.h, Math.min(...btns.filter((b) => b.group === c.group).map((b) => b.y)));
        assert.ok(first.x >= c.x && first.x < c.x + c.w);
      }
    }
  }
});
