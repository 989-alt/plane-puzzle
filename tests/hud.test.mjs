// Task 7: 실제 화면 UI 사각형(index.html + styles/*.css 를 1280x800·1024x768 Edge 에서 잰 값, tests/ui-rects.json)으로
// 시작 배치·패널 회피를 다시 확인한다. Task 6 시험은 hudRects(가상 자리)만 썼다.
// ui-rects.json 은 `python tests/e2e/ui_test.py --dump-rects` 가 만들고, ui_test.py every_puzzle_layout 이
// 모든 문제에서 실제 사각형이 이 값 안에 드는지 확인한다(값이 실제와 어긋나면 그 e2e 가 실패한다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { normalize } from '../src/core/grid.js';
import { stageSize, fitPuzzle, cellBoxes, fingerOverBoard, fitStage } from '../src/view/geom.js';
import { placePanel } from '../src/view/panelPlace.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const bank = (s) => JSON.parse(readFileSync(join(ROOT, `data/puzzles-s${s}.json`), 'utf8'));
const RECTS = JSON.parse(readFileSync(join(ROOT, 'tests/ui-rects.json'), 'utf8'));
const VIEWS = [[1280, 800], [1024, 768]];

const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const rectOf = (p) => ({ l: p.x, t: p.y, r: p.x + p.w, b: p.y + p.h });

test('real ui rects describe the CSS layout (names, inside the 16:10 stage)', () => {
  for (const [vw, vh] of VIEWS) {
    const { W, H } = stageSize(vw, vh);
    for (const s of [1, 2, 3, 4]) {
      const ui = RECTS[`${vw}x${vh}`][String(s)];
      assert.deepEqual(ui.map((u) => u.name).sort(), ['bubble', 'chip', 'clue', 'mission', 'score', 'tools', 'yard']);
      for (const u of ui) assert.ok(u.l >= 0 && u.t >= 0 && u.r <= W + 0.5 && u.b <= H + 0.5 && u.r > u.l && u.b > u.t, `${vw} s${s} ${u.name}`);
      // 단서 카드는 오른쪽, 그림 속 판(금테)과 겹치지 않는다
      const g = fitStage(W, H, 4, 4);
      const clue = ui.find((u) => u.name === 'clue');
      assert.ok(!hit(clue, g.outer), `clue over board ${vw} s${s}`);
    }
  }
});

test('every puzzle fits around the real HUD at 1280x800 and 1024x768 (cells >= 40px, no piece under UI)', () => {
  const small = [];
  for (const [vw, vh] of VIEWS) {
    const { W, H } = stageSize(vw, vh);
    for (const s of [1, 2, 3, 4]) {
      const ui = RECTS[`${vw}x${vh}`][String(s)];
      for (const p of bank(s)) {
        const { g, starts } = fitPuzzle(W, H, p, ui);
        if (g.S < 40) small.push(`${p.id}@${vw}:${g.S}`);
        const boxes = p.pieces.flatMap((pc) => cellBoxes(normalize(pc.start), starts[pc.id], g, pc.id));
        for (const b of boxes) {
          assert.ok(b.l >= 0 && b.t >= 0 && b.r <= W && b.b <= H, `${p.id} off stage`);
          for (const u of ui) assert.ok(!hit(b, u), `${p.id}@${vw} piece ${b.i} under ${u.name}`);
          assert.ok(!hit(b, g.outer), `${p.id} piece on painted board`);
        }
      }
    }
  }
  assert.deepEqual(small, []);
});

test('panel never covers pieces or the real HUD (every puzzle, every piece, both sizes, hidden on/off)', () => {
  let opened = 0;
  const bad = [];
  for (const [vw, vh] of VIEWS) {
    const { W, H } = stageSize(vw, vh);
    for (const s of [1, 2, 3, 4]) {
      const ui = RECTS[`${vw}x${vh}`][String(s)];
      for (const p of bank(s)) {
        const { g, starts } = fitPuzzle(W, H, p, ui);
        const boxes = p.pieces.flatMap((pc) => cellBoxes(normalize(pc.start), starts[pc.id], g, pc.id));
        for (const pc of p.pieces) {
          for (const hidden of [false, true]) {
            const panel = placePanel({ boxes, sel: pc.id, ui, W, H, hidden });
            opened += 1;
            const r = rectOf(panel);
            const n = boxes.filter((b) => hit(r, b)).length + ui.filter((u) => hit(r, u)).length;
            const on = panel.x >= 0 && panel.y >= 0 && panel.x + panel.w <= W && panel.y + panel.h <= H;
            if (n > 0 || !on) bad.push(`${p.id}/${pc.id}@${vw}${hidden ? 'h' : ''}: ${n}`);
          }
        }
      }
    }
  }
  assert.ok(opened > 1000, `opened ${opened}`);
  assert.deepEqual(bad, []);
});

test('hidden reveal needs the finger point itself over the painted board (rect touching is not enough)', () => {
  const { W, H } = stageSize(1280, 800);
  const g = fitStage(W, H, 5, 4);
  const o = g.outer;
  const midY = (o.t + o.b) / 2;
  assert.equal(fingerOverBoard([o.l + 1, midY], g), true);
  assert.equal(fingerOverBoard([(o.l + o.r) / 2, midY], g), true);
  assert.equal(fingerOverBoard([o.r, o.b], g), true);
  // 손가락이 금테 바로 바깥: 조각 사각형이 판에 걸쳐 있어도 아니다
  assert.equal(fingerOverBoard([o.l - 1, midY], g), false);
  assert.equal(fingerOverBoard([o.l - g.S * 0.25, midY], g), false);
  assert.equal(fingerOverBoard([(o.l + o.r) / 2, o.t - 2], g), false);
  assert.equal(fingerOverBoard([(o.l + o.r) / 2, o.b + 2], g), false);
});

// 외부 주소 금지(글꼴·그림·스크립트 모두 저장소 안). SVG 이름공간 주소는 내려받지 않으므로 뺀다.
test('no external URLs in index.html, styles and src', () => {
  const files = ['index.html'];
  const walk = (dir) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const p = `${dir}/${f}`;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (/\.(js|css|html)$/.test(f)) files.push(p);
    }
  };
  walk('src');
  walk('styles');
  const bad = [];
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s'")]*/gi)) {
      if (m[0].startsWith('http://www.w3.org/')) continue;
      bad.push(`${f}: ${m[0]}`);
    }
  }
  assert.ok(files.length >= 10, `${files.length} files`);
  assert.deepEqual(bad, []);
});
