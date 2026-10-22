// 게임 화면 HUD: 단계·연속 칩, 점수, 내 마당 배지, 도구 버튼, 말풍선. 그리기와 콜백만 둔다(게임 규칙·저장 금지).
// 큐브 왕국 src/ui/hud.js 이식(섬 그림 대신 마당 아이콘).
import { toNextIsland } from '../core/progress.js';

const $ = (sel) => document.querySelector(sel);

export const LEVEL_NAMES = ['', '1단계 · 완성 모양', '2단계 · 판 모양', '3단계 · 이동 조건', '4단계 · 최소 이동'];
export const ISLAND_NAMES = ['빈 마당', '타일 오두막', '타일 마을', '타일 성'];
// 마당 한 단계에 필요한 문제 수는 progress.js 규칙에서 가져온다(처음 마당에서 다음 단계까지 남은 수).
const PER_YARD = toNextIsland(0);

export const levelName = (level) => LEVEL_NAMES[level] ?? '';
export const fmtMult = (m) => `×${Number.isInteger(m) ? m : m.toFixed(1)}`;

const tools = new Map();
let bubbleTimer = 0;
let wired = false;

// yard: 마당 단계(0~3), toNext: 다음 마당 단계까지 남은 문제 수(마지막 단계면 null).
export function renderHud({ stage = 1, levelName: name, streak = 0, mult = 1, score = 0, yard = 0, toNext = null } = {}) {
  $('#stageText').textContent = name ?? levelName(stage);
  $('#comboChip').hidden = !(streak > 0);
  $('#comboText').textContent = `${streak}연속 ${fmtMult(mult)}`;
  $('#scoreText').textContent = Number(score).toLocaleString('ko-KR');
  $('#yardName').textContent = ISLAND_NAMES[yard] ?? '';
  $('#yardNext').textContent = toNext == null ? '내 마당 · 가장 큰 마당이에요' : `내 마당 · 다음 단계까지 ${toNext}문제`;
  const done = toNext == null ? PER_YARD : PER_YARD - toNext;
  $('#yardBar').style.width = `${Math.max(0, Math.min(1, done / PER_YARD)) * 100}%`;
}

// 말풍선(위 가운데, 미션 띠 자리). 떠 있는 동안 미션 띠를 감춘다.
export function showBubble(text, ms = 2500) {
  const b = $('#bubble');
  $('#bubbleText').textContent = text;
  b.classList.add('on');
  $('#stage')?.classList.add('talking');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, ms);
}

export function hideBubble() {
  clearTimeout(bubbleTimer);
  $('#bubble').classList.remove('on');
  $('#stage')?.classList.remove('talking');
}

export function setEasyAvailable(on) {
  $('#easyBtn').hidden = !on;
}

// name: 'restart' | 'skip' | 'help' | 'easy' | 'retry'
export function onTool(name, cb) {
  if (!tools.has(name)) tools.set(name, []);
  tools.get(name).push(cb);
  if (wired) return;
  wired = true;
  document.querySelector('#screen-game')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-tool]');
    if (!btn) return;
    (tools.get(btn.dataset.tool) ?? []).forEach((f) => f());
  });
}
