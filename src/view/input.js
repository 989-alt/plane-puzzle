// 입력: 조각 끌기(밀기, 칸 맞춤), 탭 → 이동 패널(교과서 버튼 10개), 숨김 모드(이동 카드 줄·되돌리기·처음으로·놓을 때 드러남).
// 포인터 이벤트 하나로 터치(학교 태블릿·크롬북)와 마우스(교사 PC)를 함께 처리한다. 큐브 왕국 src/scene/input.js 구조.
// 상태는 바깥(main.js·하네스)이 가진다: dispatch(action)가 core/layout.js applyAction으로 상태를 바꾸고 view.update로 그린다.
// 여기서는 액션을 만들고, 상태가 바뀐 뒤 애니메이션(view.animateMove·playReveal·slide)만 재생한다.
import { translate } from '../core/grid.js';
import { canPlace } from '../core/board.js';
import { revealResult } from '../core/layout.js';
import { screenToCell, screenToTri, triCentroid, pieceRect, fingerOverBoard } from './geom.js';
import { placePanel, panelButtons, panelSize } from './panelPlace.js';
import { MOVE_ICON, MOVE_LABEL, MOVE_SHORT } from './render.js';

const DRAG_PX = 8; // 이보다 많이 움직여야 끌기(아니면 탭)
const STALE_MS = 2500; // 떼기를 놓친 터치 포인터를 버리는 시간

const STYLE_ID = 'pp-panel-style';
const PANEL_CSS = `
.pp-panel{position:absolute;left:0;top:0;display:none;z-index:6;box-sizing:border-box;border-radius:16px;
  background:linear-gradient(180deg,rgba(72,42,14,.94),rgba(48,26,6,.94));border:2px solid #E9B949;
  box-shadow:0 10px 24px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,236,170,.35);touch-action:none;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.pp-panel.on{display:block}
.pp-panel button{position:absolute;box-sizing:border-box;padding:2px 0 0;margin:0;border-radius:11px;cursor:pointer;
  touch-action:manipulation;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  font:700 13px/1.1 Jua,Pretendard,system-ui,sans-serif;letter-spacing:-.3px;color:#4A2300;
  background:linear-gradient(180deg,#FFF3B8,#FFCB45 55%,#F2A01B);border:2px solid #FFF6CC;
  box-shadow:0 4px 0 #A9620A,0 6px 10px rgba(0,0,0,.3)}
.pp-panel button[data-group="flip"]{color:#4B1F7A;background:linear-gradient(180deg,#F4E9FF,#D8B8FF 55%,#B98BF0);
  border-color:#FBF5FF;box-shadow:0 4px 0 #6E3FA6,0 6px 10px rgba(0,0,0,.3)}
.pp-panel button[data-group="ccw"]{color:#0D3D5C;background:linear-gradient(180deg,#E3F6FF,#9FDCFA 55%,#5DB8E8);
  border-color:#F2FBFF;box-shadow:0 4px 0 #2F7BA8,0 6px 10px rgba(0,0,0,.3)}
.pp-panel button[data-group="queue"]{color:#3B2A12;background:linear-gradient(180deg,#FFFFFF,#EDE3D0 60%,#D5C4A4);
  border-color:#FFFFFF;box-shadow:0 4px 0 #8C7650,0 6px 10px rgba(0,0,0,.3);font-size:11.5px}
.pp-panel button:active{transform:translateY(3px);box-shadow:0 1px 0 rgba(0,0,0,.35)}
.pp-panel button:focus-visible{outline:3px solid #8FEFFF;outline-offset:2px}
.pp-panel button[disabled]{opacity:.45;cursor:default}
.pp-panel svg{width:30px;height:30px;pointer-events:none;flex:none}
.pp-panel span{pointer-events:none;white-space:nowrap}
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = PANEL_CSS;
  doc.head.appendChild(s);
}

const iconSvg = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" '
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MOVE_ICON[name]}</svg>`;

// view: render.createView 결과, getState(): 지금 상태, dispatch(action): 상태 바꾸고 다시 그리기.
// opts.hidden: 숨김 모드(3·4단계), opts.getUi(): 패널이 덮으면 안 되는 화면 UI 사각형(무대 px),
// opts.onEvent(name, detail): 'select'·'move'·'drop'·'queue' 알림(선택).
export function attachInput(view, getState, dispatch, opts = {}) {
  const { svg, g, puzzle } = view;
  const hidden = !!opts.hidden;
  const getUi = opts.getUi || (() => []);
  const emit = opts.onEvent || (() => {});
  const stage = svg.parentElement;
  const doc = svg.ownerDocument;
  ensureStyle(doc);

  // ---- 패널 ----
  const panel = doc.createElement('div');
  panel.className = 'pp-panel';
  panel.id = 'pp-panel';
  panel.setAttribute('role', 'toolbar');
  panel.setAttribute('aria-label', '조각 뒤집기·돌리기');
  for (const b of panelButtons('wide', hidden)) {
    const name = b.move || b.action;
    const btn = doc.createElement('button');
    btn.type = 'button';
    if (b.move) btn.dataset.move = b.move;
    else btn.dataset.action = b.action;
    btn.dataset.group = b.group;
    btn.setAttribute('aria-label', MOVE_LABEL[name]);
    btn.title = MOVE_LABEL[name];
    btn.innerHTML = `${iconSvg(name)}<span>${MOVE_SHORT[name]}</span>`;
    panel.appendChild(btn);
  }
  stage.appendChild(panel);

  let selected = null;
  let panelAt = null; // {x, y, w, h, layout}

  function layoutButtons(layout) {
    const pos = panelButtons(layout, hidden);
    const { w, h } = panelSize(layout);
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
    panel.dataset.layout = layout;
    for (const b of pos) {
      const sel = b.move ? `[data-move="${b.move}"]` : `[data-action="${b.action}"]`;
      const btn = panel.querySelector(`button${sel}`);
      btn.style.left = `${b.x - 2}px`; // 테두리(2px) 안쪽 기준
      btn.style.top = `${b.y - 2}px`;
      btn.style.width = `${b.w}px`;
      btn.style.height = `${b.h}px`;
    }
  }

  function refreshQueueButtons() {
    if (!hidden || selected === null) return;
    const pc = getState().pieces.find((q) => q.id === selected);
    const empty = !pc || pc.queue.length === 0;
    for (const a of ['undo', 'reset']) panel.querySelector(`[data-action="${a}"]`).disabled = empty;
  }

  // 패널 자리: 어떤 조각 칸·카드 줄·화면 UI도 덮지 않는 고른 조각 가장 가까운 곳(panelPlace.js).
  // keep: 지금 자리가 여전히 아무것도 덮지 않으면 그대로(연달아 누르는 버튼이 도망가지 않게).
  function placeFor(id, keep) {
    const at = placePanel({
      boxes: view.cellBoxes(), sel: id, ui: getUi(), W: g.W, H: g.H, prev: keep ? panelAt : null,
    });
    if (!panelAt || at.layout !== panelAt.layout) layoutButtons(at.layout);
    panelAt = at;
    panel.style.left = `${at.x}px`;
    panel.style.top = `${at.y}px`;
  }

  function openPanel(id) {
    const same = selected === id && panel.classList.contains('on');
    selected = id;
    placeFor(id, same);
    panel.classList.add('on');
    refreshQueueButtons();
    emit('select', { id });
  }
  function closePanel() {
    if (!panel.classList.contains('on') && selected === null) return;
    panel.classList.remove('on');
    selected = null;
    emit('select', { id: null });
  }

  // 버튼: 보이는 모드 = 바로 변환(조각 가운데 기준, 겹치면 비킴) + 애니메이션, 숨김 모드 = 카드 줄에 쌓기.
  function press(btn) {
    if (selected === null) return;
    const id = selected;
    const st = getState();
    const pc = st.pieces.find((q) => q.id === id);
    if (!pc) return;
    view.finish();
    const move = btn.dataset.move;
    const action = btn.dataset.action;
    if (move && !hidden) {
      const from = { tris: pc.tris, pos: pc.pos };
      dispatch({ type: 'move', id, move });
      // 둘 자리가 없어 바뀌지 않았으면(트레이가 꽉 참) 애니메이션도 없다
      if (getState().moves !== st.moves) {
        view.animateMove(id, move, { from });
        emit('move', { id, move });
      }
    } else if (move) {
      dispatch({ type: 'move', id, move });
      emit('queue', { id, move });
    } else if (action) {
      dispatch({ type: action, id });
      emit('queue', { id, action });
    }
    if (panel.classList.contains('on')) placeFor(id, true);
    refreshQueueButtons();
  }

  // ---- 끌기·탭 ----
  let drag = null; // {id, pointerId, type, sx, sy, moved, grabOff:[x,y], grab: Tri(모양 기준), tl0:[x,y], last:[x,y], t}
  const toStage = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return [((cx - r.left) * g.W) / r.width, ((cy - r.top) * g.H) / r.height];
  };
  const pieceOf = (id) => getState().pieces.find((q) => q.id === id);
  const others = (id) => getState().pieces.filter((q) => q.id !== id).map((q) => translate(q.tris, q.pos[0], q.pos[1]));
  const queued = (pc) => hidden && pc.queue.length > 0;

  // 잡은 사분(조각 모양 기준). 손가락 점이 든 사분이 조각에 없으면(가장자리) 가장 가까운 사분.
  function grabTri(pc, pt) {
    const [x, y, q] = screenToTri(pt[0], pt[1], g);
    const rel = [x - pc.pos[0], y - pc.pos[1], q];
    if (pc.tris.some((t) => t[0] === rel[0] && t[1] === rel[1] && t[2] === rel[2])) return rel;
    let best = pc.tris[0];
    let bd = Infinity;
    for (const t of pc.tris) {
      const [cx, cy] = triCentroid([t[0] + pc.pos[0], t[1] + pc.pos[1], t[2]], g);
      const d = (cx - pt[0]) ** 2 + (cy - pt[1]) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return [...best];
  }

  // 끄는 조각 왼쪽 위(무대 px): 잡은 점이 손가락 아래, 단 조각 상자는 무대 밖으로 나가지 않는다.
  function dragTopLeft(pc, pt) {
    const r = pieceRect(pc.tris, [0, 0], g);
    const w = r.r - r.l;
    const h = r.b - r.t;
    const x = Math.min(Math.max(pt[0] - drag.grabOff[0], 0), g.W - w);
    const y = Math.min(Math.max(pt[1] - drag.grabOff[1], 0), g.H - h);
    return [x, y];
  }
  const snapAt = (tl) => [Math.round((tl[0] - g.ox) / g.S) || 0, Math.round((tl[1] - g.oy) / g.S) || 0];

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = performance.now();
    if (drag) {
      // 떼기를 놓친 포인터(마우스는 하나뿐, 터치는 오래 멈춘 것)면 그 끌기를 내려놓는다. 아니면 두 번째 손가락은 무시.
      if (e.pointerType === 'mouse' || drag.type === 'mouse' || now - drag.t > STALE_MS) land();
      else return;
    }
    const target = e.target && e.target.closest ? e.target.closest('.pp-piece') : null;
    const id = target ? target.getAttribute('data-id') : null;
    if (e.cancelable) e.preventDefault();
    if (id === null) {
      closePanel();
      return;
    }
    view.finish();
    const pc = pieceOf(id);
    if (!pc) return;
    const pt = toStage(e.clientX, e.clientY);
    const tl0 = [g.ox + pc.pos[0] * g.S, g.oy + pc.pos[1] * g.S];
    drag = {
      id, pointerId: e.pointerId, type: e.pointerType, sx: e.clientX, sy: e.clientY, moved: false,
      grabOff: [pt[0] - tl0[0], pt[1] - tl0[1]], grab: grabTri(pc, pt), tl0, last: pt, tl: tl0, t: now,
    };
    try { svg.setPointerCapture(e.pointerId); } catch { /* 이미 사라진 포인터 */ }
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (e.pointerType !== 'touch' && e.buttons === 0) { land(); return; } // 떼기를 놓친 마우스
    drag.t = performance.now();
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) <= DRAG_PX) return;
      drag.moved = true;
      closePanel();
    }
    const pc = pieceOf(drag.id);
    if (!pc) { drag = null; return; }
    const pt = toStage(e.clientX, e.clientY);
    drag.last = pt;
    const tl = dragTopLeft(pc, pt);
    drag.tl = tl;
    view.setDrag(drag.id, tl[0] - drag.tl0[0], tl[1] - drag.tl0[1]);
    // 놓을 자리 미리보기: 보이는 모양 그대로 판에 들어갈 때만(숨김 모드 줄이 있으면 결과를 미리 보여 주지 않는다)
    if (!queued(pc)) {
      const at = snapAt(tl);
      view.setSnap(canPlace(puzzle.board, others(drag.id), translate(pc.tris, at[0], at[1])) ? pc.tris : null, at);
    }
  }


  // 끌기 끝: 칸에 맞춰 놓는다. 판에 들어가면 판, 아니면 트레이의 가장 가까운 빈 자리(core/layout.js).
  function land() {
    const d = drag;
    drag = null;
    if (!d) return;
    try { svg.releasePointerCapture(d.pointerId); } catch { /* 없음 */ }
    view.setSnap(null);
    const pc = pieceOf(d.id);
    view.clearDrag(d.id);
    if (!pc) return;
    const tl = d.tl;
    const at = snapAt(tl);
    const pt = [Math.min(Math.max(d.last[0], 0), g.W - 0.01), Math.min(Math.max(d.last[1], 0), g.H - 0.01)];
    const finger = screenToCell(pt[0], pt[1], g);
    // 숨김 모드 드러내기: 손가락 점 자체가 판 위일 때만(조각 사각형이 판에 걸친 것만으로는 아니다).
    const over = fingerOverBoard(pt, g);
    if (queued(pc) && over) {
      const res = revealResult(pc.tris, pc.mark, pc.queue, d.grab);
      const spot = [finger[0] - res.grab[0], finger[1] - res.grab[1]];
      const queue = pc.queue;
      dispatch({ type: 'drop', id: d.id, at: spot, finger, grab: d.grab, over: true });
      view.playReveal(d.id, queue, {
        pivot: [g.ox + (finger[0] + 0.5) * g.S, g.oy + (finger[1] + 0.5) * g.S],
        spot: [g.ox + spot[0] * g.S, g.oy + spot[1] * g.S],
      });
      const after = pieceOf(d.id);
      emit('drop', { id: d.id, revealed: true, onBoard: !!(after && after.at) });
      return;
    }
    dispatch({ type: 'drop', id: d.id, at, finger, grab: d.grab, over });
    view.slide(d.id, tl);
    const after = pieceOf(d.id);
    emit('drop', { id: d.id, revealed: false, onBoard: !!(after && after.at) });
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) { land(); return; }
    const { id, pointerId } = drag;
    drag = null;
    try { svg.releasePointerCapture(pointerId); } catch { /* 없음 */ }
    openPanel(id);
  }
  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) land();
    else drag = null;
  }

  const noMenu = (e) => e.preventDefault();
  const onPanelDown = (e) => { e.stopPropagation(); };
  const onPanelClick = (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.disabled) press(btn);
  };
  const onKey = (e) => { if (e.key === 'Escape') closePanel(); };

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('lostpointercapture', onCancel);
  svg.addEventListener('contextmenu', noMenu);
  stage.addEventListener('contextmenu', noMenu);
  panel.addEventListener('pointerdown', onPanelDown);
  panel.addEventListener('click', onPanelClick);
  doc.addEventListener('keydown', onKey);

  return {
    openPanel,
    closePanel,
    // 패널 사각형(무대 px), 닫혀 있으면 null
    panelRect: () => (panel.classList.contains('on') && panelAt
      ? { x: panelAt.x, y: panelAt.y, width: panelAt.w, height: panelAt.h, layout: panelAt.layout } : null),
    panelState: () => ({ open: panel.classList.contains('on'), id: selected, layout: panelAt ? panelAt.layout : null }),
    selected: () => selected,
    dragging: () => !!(drag && drag.moved),
    // 문제를 바꾸거나 다시 놓을 때: 끌기·선택·패널을 버린다(리스너는 그대로).
    cancel() {
      if (drag) view.clearDrag(drag.id);
      drag = null;
      view.setSnap(null);
      closePanel();
    },
    detach() {
      this.cancel();
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onCancel);
      svg.removeEventListener('lostpointercapture', onCancel);
      svg.removeEventListener('contextmenu', noMenu);
      stage.removeEventListener('contextmenu', noMenu);
      doc.removeEventListener('keydown', onKey);
      panel.remove();
    },
    panel,
  };
}
