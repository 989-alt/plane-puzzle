// 게임 흐름: 시작 → (첫 접속이면) 조작 안내 → 게임 ↔ 정답 → 다음 문제. 큐브 왕국 src/main.js 이식(2D SVG, three.js 없음).
// 문제 은행(data/puzzles-s{단계}.json)에서 단계마다 무작위로 고르고(최근 10개 제외), 무대 맞춤(geom.fitPuzzle)·SVG 렌더·
// 입력·판정·점수·저장을 잇는다. 무대 맞춤에는 실제로 잰 화면 UI 사각형(HUD·단서 카드·도구 막대·말풍선)을 넘긴다.
// ?e2e 이면 시험 훅 window.__pp(조각·흐름, tests/e2e/flow_test.py)와 window.__ppUi(화면, tests/e2e/ui_test.py)를 연다.
import { key, normalize, translate } from './core/grid.js';
import { applyMove, applyElem, MOVES } from './core/pieces.js';
import { canPlace, wrongTris, isSolved } from './core/board.js';
import { needs } from './core/solver.js';
import * as L from './core/layout.js';
import {
  createProgress, recordSolve, recordSkip, canUseEasy, easyLevel, islandStage, toNextIsland, multiplier,
} from './core/progress.js';
import { load, save } from './core/storage.js';
import { stageSize, fitPuzzle, triCentroid, screenToTri } from './view/geom.js';
import { createView } from './view/render.js';
import { attachInput } from './view/input.js';
import {
  initScreens, showScreen, currentScreen, openTutorial, onStart, onTutorialDone, onNext,
  showWin, setTitleStats, detectInputKind, onPortrait,
} from './ui/screens.js';
import { renderHud, showBubble, hideBubble, setEasyAvailable, onTool, levelName } from './ui/hud.js';
import { renderClue, updateMoves } from './ui/clueCard.js';

const RECENT_MAX = 10; // 최근에 낸 문제는 이만큼 피한다
const TEXT = {
  mismatch: '모양이 조금 달라요',
  pending: '카드에 남은 이동이 있어요. 조각을 다시 놓아 보세요',
  hiddenIntro: '이제 놓는 순간 모양이 드러나요. 미리 생각해 봐요!',
};
const qs = new URLSearchParams(location.search);
const E2E = qs.has('e2e');
const $ = (sel) => document.querySelector(sel);

// ---------- 문제 은행 ----------
const banks = new Map();
function bank(stage) {
  if (!banks.has(stage)) {
    const p = fetch(`data/puzzles-s${stage}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`문제 은행 ${stage}단계를 받지 못함(${r.status})`);
        return r.json();
      })
      .then((list) => {
        if (!Array.isArray(list) || list.length === 0) throw new Error(`문제 은행 ${stage}단계가 비어 있음`);
        return list;
      });
    p.catch(() => banks.delete(stage)); // 실패하면 다음에 다시 받는다
    banks.set(stage, p);
  }
  return banks.get(stage);
}
const stageOfId = (id) => Number((/^s([1-4])-/.exec(id) || [0, '1'])[1]);
async function findPuzzle(id) {
  const list = await bank(stageOfId(id));
  return list.find((p) => p.id === id) ?? list[0];
}

const recent = [];
async function pickPuzzle(stage) {
  const list = await bank(stage);
  const fresh = list.filter((p) => !recent.includes(p.id));
  const pool = fresh.length ? fresh : list.filter((p) => p.id !== recent[recent.length - 1]);
  return pool[Math.floor(Math.random() * pool.length)];
}
function remember(id) {
  const i = recent.indexOf(id);
  if (i >= 0) recent.splice(i, 1);
  recent.push(id);
  while (recent.length > RECENT_MAX) recent.shift();
}

// ---------- 상태 ----------
let progress = createProgress({ solvedTotal: load('solvedTotal', 0), best: load('best', 0) });
let puzzle = null; // 은행 문제 그대로 {id, stage, board, pieces, solutions, minMoves, cards}
let level = 1; // 지금 보이는 단서 단계(쉬운 단서면 stage − 1)
let hidden = false; // 숨김 모드(3·4단계, 쉬운 단서를 쓰면 끔)
let conds = {}; // 조각별 이동 조건 카드
let usedEasy = false;
let attemptNo = 0;
let attemptId = '';
let startAt = 0; // performance.now() 기준 문제 시작 시각
let pausedAt = null; // 멈춘 시각(도움말·세로 화면 안내가 떠 있는 동안 경과 시간을 멈춘다)
const pauseReasons = new Set(); // 'help' | 'portrait'
let loadFailed = false;
let solved = false;
let started = false;
let shakes = 0; // 확인용: 흔들기 횟수
let introShown = false; // 숨김 모드 첫 안내 말풍선(한 번만)
let loading = Promise.resolve();

const nowOrPaused = () => pausedAt ?? performance.now();
const elapsedSec = () => (nowOrPaused() - startAt) / 1000;
function pauseTimer(reason = 'help') {
  pauseReasons.add(reason);
  if (pausedAt === null) pausedAt = performance.now();
}
function resumeTimer(reason = 'help') {
  pauseReasons.delete(reason);
  if (pausedAt === null || pauseReasons.size) return;
  startAt += performance.now() - pausedAt;
  pausedAt = null;
}

function hud() {
  renderHud({
    stage: progress.stage, levelName: levelName(progress.stage), streak: progress.streak,
    mult: multiplier(progress.streak), score: progress.score,
    yard: islandStage(progress.solvedTotal), toNext: toNextIsland(progress.solvedTotal),
  });
}

function persist() {
  save('best', progress.best);
  save('solvedTotal', progress.solvedTotal);
  setTitleStats({ best: progress.best, yard: islandStage(progress.solvedTotal) });
}

// ---------- 무대·화면 UI 사각형 ----------
const stageEl = $('#stage');
const svg = $('#board');
let W = 1280;
let H = 800;
let g = null; // fitPuzzle 의 칸 크기·원점(무대 px)
let bounds = null; // 트레이 경계(칸)
let ctx = null; // {board, bounds}
let ui = []; // 무대 맞춤·패널 회피에 쓴 화면 UI 사각형(무대 px, 단서 카드는 쉬운 단서 자리까지 잡은 것)
let view = null;
let input = null;
let bstate = null; // 조각 상태(core/layout.js)
let wrong = new Set();
const actions = [];

function layoutStage() {
  const s = stageSize(window.innerWidth, window.innerHeight);
  W = s.W;
  H = s.H;
  stageEl.style.width = `${W}px`;
  stageEl.style.height = `${H}px`;
}

const relRect = (r) => {
  const base = stageEl.getBoundingClientRect();
  return { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top };
};
const union = (a, b) => (a ? { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) } : b);

// 지금 보이는 화면 UI 사각형(무대 px, 이름 붙임). 숨겨진 것은 뺀다. 말풍선은 늘 같은 자리의 고정 상자다.
function liveUiRects() {
  const out = [];
  for (const e of stageEl.querySelectorAll('[data-ui]')) {
    if (e.hidden) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    out.push({ name: e.dataset.ui, ...relRect(r) });
  }
  return out;
}

// 조각 배치용 UI 사각형: 문제를 푸는 동안 커질 수 있는 것까지 미리 잡는다.
// - 단서 카드: 지금 단계 단서와 쉬운 단서(한 단계 아래) 중 큰 것 + 쉬운 단서 버튼(2단계부터)
// - 연속 칩·점수: 긴 글자("10연속 ×3", "99,999")로 잰다
function fitUiRects(p, stage) {
  const combo = $('#comboChip');
  const comboText = $('#comboText');
  const score = $('#scoreText');
  const saved = [combo.hidden, comboText.textContent, score.textContent];
  combo.hidden = false;
  comboText.textContent = '10연속 ×3';
  score.textContent = '99,999';
  const easyBtn = $('#easyBtn');
  const easyHidden = easyBtn.hidden;
  easyBtn.hidden = stage < 2;
  const card = $('#clueCard');
  let clue = null;
  const variants = [[stage, false]];
  if (stage >= 2) variants.push([easyLevel(stage), true]);
  for (const [lvl, easy] of variants) {
    renderClue(card, clueOpts(p, stage, lvl, easy, 0));
    clue = union(clue, relRect(card.getBoundingClientRect()));
  }
  const rects = liveUiRects().map((r) => (r.name === 'clue' ? { ...r, ...union(r, clue) } : r));
  easyBtn.hidden = easyHidden;
  [combo.hidden, comboText.textContent, score.textContent] = saved;
  if (puzzle) showClue();
  return rects;
}

// ---------- 단서 ----------
const CARD_OF = (n) => (n.flip && n.turn ? 'flipturn' : n.flip ? 'flip' : n.turn ? 'turn' : null);
// 조건 카드: 은행에 적힌 cards(3단계), 없으면 해답에서 구한다(4단계 쉬운 단서 = 3단계 단서).
function condsFor(p) {
  if (p.cards && Object.keys(p.cards).length) return p.cards;
  const out = {};
  for (const [id, n] of Object.entries(needs(p))) {
    const c = CARD_OF(n);
    if (c) out[id] = c;
  }
  return out;
}
function clueOpts(p, stage, lvl, easy, moves) {
  return {
    level: lvl, easy, puzzle: p, conds: lvl === 3 ? condsFor(p) : {},
    goal: stage === 4 ? { minMoves: p.minMoves, moves } : null,
  };
}
function showClue() {
  renderClue($('#clueCard'), clueOpts(puzzle, progress.stage, level, usedEasy, bstate ? bstate.moves : 0));
  conds = level === 3 ? condsFor(puzzle) : {};
}

// ---------- 그리기·입력 ----------
function render() {
  view.update(bstate);
  if (level === 1) {
    wrong = wrongTris(puzzle, bstate.pieces);
    view.setWrong(wrong);
  } else {
    wrong = new Set();
    view.setWrong(null);
  }
  if (progress.stage === 4) updateMoves($('#clueCard'), bstate.moves, puzzle.minMoves);
}

// 상태를 바꾸고 바로 다시 그린다(동기: input.js 가 dispatch 직후 애니메이션을 튼다).
function dispatch(a) {
  actions.push(a.type);
  bstate = L.applyAction(bstate, a, ctx);
  render();
}

function onInputEvent(name) {
  if (name === 'move' || name === 'drop' || name === 'queue') scheduleCheck();
}

function attach() {
  input?.detach();
  input = attachInput(view, () => bstate, dispatch, { hidden, getUi: () => ui, onEvent: onInputEvent });
}

// 무대에 문제를 맞춘다(실패하면 던지고 아무것도 바꾸지 않는다).
function fit(p, stage) {
  layoutStage();
  const rects = fitUiRects(p, stage);
  const f = fitPuzzle(W, H, p, rects);
  return { ui: rects, g: f.g, bounds: f.bounds };
}

// fresh: 새 문제(시작 배치), 아니면 지금 상태를 새 경계에 다시 맞춘다(refit).
function mount(f, p, fresh) {
  input?.detach();
  input = null;
  ui = f.ui;
  g = f.g;
  bounds = f.bounds;
  ctx = { board: p.board, bounds };
  view = createView(svg, p, { g, ui });
  bstate = fresh ? L.initialState(p, bounds, { hidden }) : L.refit(bstate, ctx);
  view.setGhost(level === 1);
  render();
  attach();
}

function begin(p) {
  const nextStage = progress.stage;
  const f = fit(p, nextStage); // 배치가 안 되면 여기서 던지고 지금 문제는 그대로 둔다
  input?.cancel();
  puzzle = p;
  level = nextStage;
  hidden = nextStage >= 3;
  usedEasy = false;
  solved = false;
  attemptNo += 1;
  attemptId = `${puzzle.id}#${attemptNo}`;
  startAt = nowOrPaused();
  remember(puzzle.id);
  hideBubble();
  svg.classList.remove('shake');
  bstate = null;
  showClue();
  mount(f, p, true);
  setEasyAvailable(false);
  hud();
  if (hidden && !introShown) {
    introShown = true;
    showBubble(TEXT.hiddenIntro, 3500);
  }
}

// 현재 단계 은행에서 새 문제. 시작 배치가 안 되는 문제는 건너뛴다.
function nextPuzzle() {
  loading = (async () => {
    try {
      await document.fonts?.ready;
      for (let n = 0; n < 5; n++) {
        const p = await pickPuzzle(progress.stage);
        try {
          begin(p);
          setLoadFailed(false);
          return;
        } catch (err) {
          console.warn('문제를 시작할 수 없어 다른 문제를 고릅니다', p.id, err);
          remember(p.id);
        }
      }
      throw new Error('시작 배치가 되는 문제를 찾지 못함');
    } catch (err) {
      console.warn('문제를 불러오지 못했습니다', err);
      setLoadFailed(true);
    }
  })();
  return loading;
}

function setLoadFailed(on) {
  loadFailed = on;
  const card = $('#loadFail');
  if (card) card.hidden = !on;
  if (on) setEasyAvailable(false);
}

// ---------- 판정·정답 ----------
// 놓기·이동·카드 뒤에, 애니메이션이 끝나면 판정한다.
function scheduleCheck() {
  const id = attemptId;
  const v = view;
  const step = () => {
    if (attemptId !== id || v !== view) return;
    if (v.busy()) { requestAnimationFrame(step); return; }
    check();
  };
  requestAnimationFrame(step);
}

// 모든 조각이 판 위일 때만 본다. 숨김 모드는 카드 줄이 모두 비어야 정답(남은 카드가 있으면 말풍선).
function check() {
  if (!puzzle || solved || !bstate || currentScreen() !== 'game') return;
  if (!bstate.pieces.every((p) => p.at)) return;
  // 카드 줄에 남은 이동이 있으면 아직 드러나지 않은 모양이다: 맞든 틀리든 흔들지 않고 남은 카드를 알린다.
  if (bstate.pieces.some((p) => p.queue.length > 0)) {
    showBubble(TEXT.pending, 3500);
    return;
  }
  if (isSolved(puzzle, bstate.pieces)) {
    win();
  } else {
    shake();
    showBubble(TEXT.mismatch);
  }
}

function shake() {
  shakes += 1;
  svg.classList.remove('shake');
  void svg.getBoundingClientRect(); // 애니메이션 다시 시작
  svg.classList.add('shake');
  setTimeout(() => svg.classList.remove('shake'), 480);
}

function win() {
  solved = true;
  setEasyAvailable(false);
  input?.cancel();
  hideBubble();
  const seconds = elapsedSec();
  const before = progress;
  const minMovesHit = progress.stage === 4 && bstate.moves <= puzzle.minMoves;
  const res = recordSolve(progress, { puzzleId: attemptId, seconds, usedEasy, minMovesHit });
  if (res.gained === 0) return; // 같은 시도를 두 번 판정(점수는 한 번만)
  progress = res.state;
  persist();
  const yardBefore = islandStage(before.solvedTotal);
  const yardAfter = islandStage(progress.solvedTotal);
  const toNext = toNextIsland(progress.solvedTotal);
  const nextHint = res.promoted
    ? `다음: ${levelName(progress.stage)}`
    : (toNext == null ? '가장 큰 마당을 지었어요' : `마당이 자라기까지 ${toNext}문제`);
  showWin({
    gained: res.gained, base: 100, speed: Math.max(0, 60 - Math.floor(seconds)),
    streak: progress.streak, mult: multiplier(progress.streak), usedEasy, bonus: res.bonus,
    yardBefore, yardAfter, nextHint,
  });
  hud();
}

// 1초마다 경과 시간을 보고 쉬운 단서 버튼을 띄운다.
function tick() {
  if (!puzzle || solved || usedEasy || loadFailed || pausedAt !== null) return;
  setEasyAvailable(canUseEasy(progress.stage, elapsedSec()));
}
setInterval(tick, 1000);

// 숨김 모드를 끈다: 쌓인 카드를 바로 적용해 드러낸다(이미 센 이동이라 이동 수는 그대로).
function revealAll(st) {
  let s = { ...st, hidden: false };
  for (const pc of st.pieces) for (const move of pc.queue) s = L.applyAction(s, { type: 'move', id: pc.id, move }, ctx);
  return { ...s, moves: st.moves, pieces: s.pieces.map((p) => ({ ...p, queue: [] })) };
}

// 쉬운 단서: 한 단계 쉬운 단서, 점수 절반. 3·4단계는 숨김 모드를 끈다(누르면 결과가 바로 보임).
function useEasy() {
  if (!puzzle || solved || usedEasy || !canUseEasy(progress.stage, elapsedSec())) return;
  usedEasy = true;
  level = easyLevel(progress.stage);
  setEasyAvailable(false);
  input?.cancel();
  view.finish();
  if (hidden) {
    hidden = false;
    bstate = revealAll(bstate);
    attach();
  }
  view.setGhost(level === 1);
  showClue();
  render();
  scheduleCheck();
}

let skipping = false; // 건너뛰기 두 번 누름 막기(새 문제를 받는 동안은 한 번만)
function skip() {
  if (skipping) return;
  if (solved && currentScreen() === 'game') return;
  // 문제를 못 불러온 상태면 연속 기록은 그대로 두고 다시 불러오기만 한다.
  if (!puzzle || loadFailed) {
    nextPuzzle();
    return;
  }
  skipping = true;
  progress = recordSkip(progress);
  persist();
  nextPuzzle().finally(() => { skipping = false; });
}

// 다시 놓기: 모든 조각을 처음 모양·처음 자리로. 이동 수는 그대로 쌓인다(다시 놓기 전 이동도 4단계 별 판정에 센다). 시간도 그대로 간다.
function restart() {
  if (!puzzle || solved || !bounds) return;
  input?.cancel();
  view.finish();
  bstate = { ...L.initialState(puzzle, bounds, { hidden }), moves: bstate.moves };
  render();
}

// 창 크기가 바뀌면 무대를 다시 맞춘다(칸 크기·트레이 경계가 바뀐다: 판 조각은 그대로, 트레이 조각은 refit).
let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    if (window.innerHeight > window.innerWidth) return; // 세로 화면 안내 중에는 맞추지 않는다
    const before = [W, H];
    layoutStage();
    if (!puzzle || !bstate || (before[0] === W && before[1] === H)) return;
    try {
      input?.cancel();
      view?.finish();
      mount(fit(puzzle, progress.stage), puzzle, false);
    } catch (err) {
      console.warn('화면 크기에 맞추지 못했습니다', err);
    }
  });
}
window.addEventListener('resize', onResize);

// ---------- 화면 흐름 ----------
function enterGame() {
  showScreen('game');
  if (started) return;
  started = true;
  nextPuzzle();
}

layoutStage();
initScreens();
hud();
setTitleStats({ best: progress.best, yard: islandStage(progress.solvedTotal) });

onStart(() => {
  if (load('tutorialSeen', false)) enterGame();
  else openTutorial({ inputKind: detectInputKind(), mode: 'start' });
});
onTutorialDone(({ dontShowAgain, mode }) => {
  if (dontShowAgain) save('tutorialSeen', true);
  // 도움말로 연 안내는 닫기만 한다(같은 문제·같은 배치로 돌아간다).
  if (mode === 'help') {
    resumeTimer('help');
    showScreen('game');
    scheduleCheck(); // 안내가 떠 있는 동안 끝난 놓기의 판정을 다시 한다
  } else enterGame();
});
onNext(() => {
  if (currentScreen() !== 'win') return; // 두 번 눌러도 한 번만
  showScreen('game');
  nextPuzzle();
});
onTool('help', () => {
  input?.cancel();
  pauseTimer('help'); // 도움말을 보는 동안 시간은 멈춘다
  openTutorial({ inputKind: detectInputKind(), mode: 'help' });
});
onTool('retry', () => nextPuzzle());
onTool('easy', useEasy);
onTool('skip', skip);
onTool('restart', restart);
// 세로 화면 안내가 떠 있는 동안은 풀 수 없으니 시간도 멈춘다.
onPortrait((on) => {
  if (on) {
    input?.cancel();
    pauseTimer('portrait');
  } else {
    resumeTimer('portrait');
    onResize();
  }
});

// ---------- 시험 훅 ----------
if (E2E) {
  window.__ppUi = {
    showScreen, showWin, renderHud, showBubble, setEasyAvailable, openTutorial,
  };

  const stageToClient = ([x, y]) => {
    const r = svg.getBoundingClientRect();
    return { x: r.left + (x * r.width) / W, y: r.top + (y * r.height) / H };
  };
  const clientToStage = (x, y) => {
    const r = svg.getBoundingClientRect();
    return [((x - r.left) * W) / r.width, ((y - r.top) * H) / r.height];
  };
  const pieceOf = (pid) => bstate.pieces.find((p) => p.id === pid);
  const hitId = (x, y) => {
    const e = document.elementFromPoint(x, y);
    const pc = e && e.closest ? e.closest('.pp-piece') : null;
    return pc ? pc.getAttribute('data-id') : null;
  };

  window.__pp = {
    // 게임 흐름
    game: () => ({
      screen: currentScreen(), stage: progress.stage, streak: progress.streak, score: progress.score,
      solvedTotal: progress.solvedTotal, best: progress.best, level, hidden, usedEasy, solved,
      puzzleId: puzzle?.id ?? null, attemptId, elapsed: puzzle ? elapsedSec() : 0, shakes,
      paused: pausedAt !== null, pauseReasons: [...pauseReasons], loadFailed,
    }),
    // id(은행 문제)로 바꾼다(지금 단계 그대로).
    async setPuzzle(id) {
      await loading;
      begin(await findPuzzle(id));
      setLoadFailed(false);
      return puzzle.id;
    },
    // 첫 해답대로 모든 조각을 판에 놓고(카드 줄 비움) 판정한다. moves: 그때까지 누른 이동 수(기본 = 최소 이동 수).
    solveCurrent({ moves } = {}) {
      const sol = puzzle.solutions[0];
      bstate = {
        ...bstate,
        moves: moves ?? puzzle.minMoves,
        pieces: bstate.pieces.map((pc) => {
          const r = sol.find((q) => q.id === pc.id);
          const start = normalize(puzzle.pieces.find((q) => q.id === pc.id).start);
          const m = L.elemMarked(start, [...start[0], 0], r.elem);
          return { ...pc, tris: m.tris, mark: m.mark, pos: [r.dx, r.dy], at: [r.dx, r.dy], queue: [] };
        }),
      };
      render();
      check();
      return true;
    },
    check,
    elapsed(sec) {
      startAt = nowOrPaused() - sec * 1000;
      tick();
    },
    setProgress(patch) {
      progress = { ...progress, ...patch };
      hud();
    },
    uiRects: liveUiRects,
    // 조각 상태(Task 6 하네스와 같은 이름)
    get state() { return JSON.parse(JSON.stringify(bstate)); },
    get puzzle() { return puzzle; },
    get g() { return g && { S: g.S, ox: g.ox, oy: g.oy, W, H, outer: g.outer, inner: g.inner }; },
    get bounds() { return bounds; },
    get ui() { return ui; },
    get hidden() { return hidden; },
    get moves() { return bstate.moves; },
    get wrong() { return [...wrong].sort(); },
    get busy() { return !!view && view.busy(); },
    get solved() { return isSolved(puzzle, bstate.pieces) && bstate.pieces.every((p) => p.queue.length === 0); },
    get actions() { return actions.slice(); },
    pieceScreenXY(pid, tri = null) {
      const pc = pieceOf(pid);
      const list = tri ? [tri] : pc.tris;
      for (const t of list) {
        const c = stageToClient(triCentroid([t[0] + pc.pos[0], t[1] + pc.pos[1], t[2]], g));
        if (tri || hitId(c.x, c.y) === pid) return c;
      }
      return stageToClient(triCentroid([pc.tris[0][0] + pc.pos[0], pc.tris[0][1] + pc.pos[1], pc.tris[0][2]], g));
    },
    // 조각 사분 가운데 중 그 조각이 아닌 것(HUD·패널 등)이 맞는 점 목록. 비어 있으면 아무것도 조각을 가리지 않는다.
    covered() {
      const out = [];
      for (const pc of bstate.pieces) {
        for (const t of pc.tris) {
          const c = stageToClient(triCentroid([t[0] + pc.pos[0], t[1] + pc.pos[1], t[2]], g));
          const e = document.elementFromPoint(c.x, c.y);
          const hit = e && e.closest ? e.closest('.pp-piece') : null;
          if (!hit || hit.getAttribute('data-id') !== pc.id) out.push([pc.id, t, e ? (e.id || e.className?.baseVal || e.className || e.tagName) : null]);
        }
      }
      return out;
    },
    panelRect() {
      const el = document.getElementById('pp-panel');
      if (!el || !el.classList.contains('on')) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, layout: el.dataset.layout };
    },
    panelState: () => input.panelState(),
    triAt(x, y) {
      const pid = hitId(x, y);
      if (!pid) return null;
      const pc = pieceOf(pid);
      const [tx, ty, tq] = screenToTri(...clientToStage(x, y), g);
      return { id: pid, tri: [tx - pc.pos[0], ty - pc.pos[1], tq] };
    },
    drawnTopLeft(pid) {
      const node = view.nodeOf(pid);
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(node.getAttribute('transform'));
      return [Number(m[1]), Number(m[2])];
    },
    queueCards: (pid) => svg.querySelectorAll(`[data-queue="${pid}"] .pp-card`).length,
    queueRect: (pid) => view.queueRect(pid),
    wrongOf: (pieces) => [...wrongTris(puzzle, pieces)].sort(),
    wrongPolys: () => svg.querySelectorAll('.pp-wrong-tri').length,
    setState(s) { bstate = s; render(); },
    dispatch,
    stageToClient,
    clientToStage,
    key, normalize, translate, applyMove, applyElem, MOVES, canPlace, L,
    // 상태가 바른지: 판 조각은 판 안, 트레이 조각은 경계 안·판/UI 칸 밖, 겹침 없음
    consistent() {
      const problems = [];
      const seen = new Map();
      for (const pc of bstate.pieces) {
        const placed = translate(pc.tris, pc.pos[0], pc.pos[1]);
        if (pc.at) {
          if (!canPlace(puzzle.board, [], placed)) problems.push(`${pc.id} off board`);
        } else {
          const others = bstate.pieces.filter((o) => o.id !== pc.id && !o.at).map((o) => translate(o.tris, o.pos[0], o.pos[1]));
          if (!L.trayOk(pc.tris, pc.pos, others, bounds)) problems.push(`${pc.id} bad tray spot ${pc.pos}`);
        }
        for (const t of placed) {
          const k = t.join(',');
          if (seen.has(k)) problems.push(`${pc.id} overlaps ${seen.get(k)}`);
          seen.set(k, pc.id);
        }
      }
      return problems;
    },
    get view() { return view; },
    get input() { return input; },
  };
}

// 모듈이 돌기 시작했다: 옛 브라우저 안내는 이 표시를 본다(글꼴을 기다리느라 늦어져도 안내를 띄우지 않는다).
window.__ppBooted = true;
await document.fonts?.ready;
window.__ppReady = true;
{ const ob = document.getElementById('oldBrowser'); if (ob) { ob.hidden = true; ob.style.display = ''; } }
