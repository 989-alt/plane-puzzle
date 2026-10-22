"""Task 6 입력(끌기·탭·이동 패널·숨김 모드) e2e. Playwright + 시스템 Edge. 큐브 왕국 tests/e2e/input_test.py 구조.

저장소 루트에서 `python -m http.server 8768` 을 띄운 뒤 실행한다(이 PC는 8GB: e2e는 한 번에 하나씩).
  python tests/e2e/input_test.py [base_url] [시험 이름 일부]

같은 시험을 마우스(page.mouse)와 터치 두 방식으로 돌린다.
터치 방식: browser.new_context(has_touch=True) 에서
  - 탭은 page.touchscreen.tap
  - 끌기·취소는 CDP Input.dispatchTouchEvent(touchStart/touchMove/touchEnd/touchCancel)
  Edge 에서 이 방식은 pointerType 'touch' 포인터 이벤트를 만든다(시험마다 pointerType 을 기록해 확인한다).
마우스 방식의 pointercancel 은 실제 장치로 만들 수 없어 svg 에 PointerEvent('pointercancel') 를 보낸다.
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith("http") else "http://127.0.0.1:8768"
ONLY = [a for a in sys.argv[1:] if not a.startswith("http")]
VIEW = {"width": 1280, "height": 800}
SMALL = {"width": 1024, "height": 768}
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

ELEM_MOVES = {
    "id": [], "r90": ["cw90"], "r180": ["cw180"], "r270": ["cw270"],
    "fx": ["flipLeft"], "fx_r90": ["flipLeft", "cw90"], "fx_r180": ["flipUp"], "fx_r270": ["flipLeft", "cw270"],
}
LABELS = {
    "flipUp": "위쪽으로 뒤집기", "flipDown": "아래쪽으로 뒤집기", "flipLeft": "왼쪽으로 뒤집기", "flipRight": "오른쪽으로 뒤집기",
    "cw90": "시계 방향으로 90° 돌리기", "cw180": "시계 방향으로 180° 돌리기", "cw270": "시계 방향으로 270° 돌리기",
    "ccw90": "시계 반대 방향으로 90° 돌리기", "ccw180": "시계 반대 방향으로 180° 돌리기", "ccw270": "시계 반대 방향으로 270° 돌리기",
}


class Pointer:
    """마우스·터치 공통 조작."""

    def __init__(self, page, mode, cdp=None):
        self.page, self.mode, self.cdp = page, mode, cdp
        self.pos = (0, 0)

    def _touch(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)],
        })

    def down(self, x, y):
        self.pos = (x, y)
        if self.mode == "mouse":
            self.page.mouse.move(x, y)
            self.page.mouse.down()
        else:
            self._touch("touchStart", [(x, y)])

    def move(self, x, y, steps=10):
        fx, fy = self.pos
        if self.mode == "mouse":
            self.page.mouse.move(x, y, steps=steps)
        else:
            for k in range(1, steps + 1):
                self._touch("touchMove", [(fx + (x - fx) * k / steps, fy + (y - fy) * k / steps)])
                self.page.wait_for_timeout(8)
        self.pos = (x, y)

    def up(self):
        if self.mode == "mouse":
            self.page.mouse.up()
        else:
            self._touch("touchEnd", [])

    def cancel(self):
        if self.mode == "mouse":
            self.page.evaluate("""() => document.getElementById('board').dispatchEvent(new PointerEvent('pointercancel',
                { pointerId: window.__lastPointerId, pointerType: 'mouse', bubbles: true }))""")
        else:
            self._touch("touchCancel", [])

    def tap(self, x, y):
        if self.mode == "mouse":
            self.page.mouse.click(x, y)
        else:
            self.page.touchscreen.tap(x, y)

    def drag(self, a, b, steps=14):
        self.down(*a)
        self.page.wait_for_timeout(30)
        self.move(b[0], b[1], steps=steps)
        self.page.wait_for_timeout(30)
        self.up()


def open_page(ctx, mode, query):
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.goto(f"{BASE}/tests/e2e/view.html?{query}")
    page.wait_for_function("window.__ppReady === true", timeout=20000)
    page.evaluate("""() => { window.__types = []; window.__lastPointerId = 1;
        document.getElementById('board').addEventListener('pointerdown', (e) => {
          if (!e.isTrusted) return;
          window.__types.push(e.pointerType); window.__lastPointerId = e.pointerId; }, true);
        document.getElementById('pp-panel').addEventListener('pointerdown', (e) => {
          if (e.isTrusted) window.__types.push(e.pointerType); }, true); }""")
    cdp = ctx.new_cdp_session(page) if mode == "touch" else None
    return page, Pointer(page, mode, cdp), errors


# ---- 훅 도우미 ----

def state(page):
    return page.evaluate("__pp.state")


def piece(page, pid):
    return next(p for p in state(page)["pieces"] if p["id"] == pid)


def xy(page, pid):
    r = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
    return (r["x"], r["y"])


def G(page):
    return page.evaluate("__pp.g")


def idle(page):
    page.wait_for_function("!__pp.busy", timeout=8000)
    page.wait_for_timeout(40)


def cell_client(page, cx, cy, fx=0.5, fy=0.5):
    g = G(page)
    r = page.evaluate("(p) => __pp.stageToClient(p)", [g["ox"] + (cx + fx) * g["S"], g["oy"] + (cy + fy) * g["S"]])
    return (r["x"], r["y"])


def shape_key(page, tris, pos=(0, 0)):
    return page.evaluate("([t, p]) => __pp.key(__pp.translate(__pp.normalize(t), p[0], p[1]))", [tris, list(pos)])


def assert_consistent(page, msg=""):
    probs = page.evaluate("__pp.consistent()")
    assert probs == [], f"{msg} inconsistent {probs}"


def panel_state(page):
    return page.evaluate("__pp.panelState()")


def press(page, ptr, name):
    sel = f'#pp-panel button[data-move="{name}"]' if name not in ("undo", "reset") else f'#pp-panel button[data-action="{name}"]'
    bb = page.query_selector(sel).bounding_box()
    assert bb, f"button {name} not visible"
    ptr.tap(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
    page.wait_for_timeout(60)
    idle(page)


def open_panel(page, ptr, pid):
    ps = panel_state(page)
    if ps["open"] and ps["id"] == pid:
        return
    ptr.tap(*xy(page, pid))
    page.wait_for_timeout(80)
    ps = panel_state(page)
    assert ps["open"] and ps["id"] == pid, f"panel {ps}"


def set_piece(page, pid, elem=None, pos=None, on_board=False):
    """조각을 해답 모양(elem)·자리로 바로 둔다(시험 준비)."""
    page.evaluate("""([id, elem, pos, onBoard]) => {
        const s = __pp.state; const p = s.pieces.find((q) => q.id === id);
        const start = __pp.normalize(__pp.puzzle.pieces.find((q) => q.id === id).start);
        if (elem) { const m = __pp.L.elemMarked(start, [...start[0], 0], elem); p.tris = m.tris; p.mark = m.mark; }
        if (pos) { p.pos = pos; p.at = onBoard ? pos : null; }
        __pp.setState(s); }""", [pid, elem, pos, on_board])
    page.wait_for_timeout(30)


# ---- 시험 ----

def drag_snaps_to_cells(page, ptr):
    """끌기 = 칸 맞춤: 손가락이 칸 사이(0.3칸 어긋남)에서 떼도 가장 가까운 칸에, 그린 자리 = 격자 자리."""
    g = G(page)
    S = g["S"]
    p0 = piece(page, "a")
    off = page.evaluate("""(id) => { const s = __pp.state; const p = s.pieces.find((q) => q.id === id);
        const others = s.pieces.filter((q) => q.id !== id).map((q) => __pp.translate(q.tris, q.pos[0], q.pos[1]));
        const offs = [];
        for (let dy = -6; dy <= 6; dy++) for (let dx = -12; dx <= 12; dx++) if (Math.abs(dx) + Math.abs(dy) >= 2) offs.push([dx, dy]);
        offs.sort((u, v) => Math.hypot(...u) - Math.hypot(...v) || u[1] - v[1] || u[0] - v[0]);
        for (const [dx, dy] of offs) {
          if (__pp.L.trayOk(p.tris, [p.pos[0] + dx, p.pos[1] + dy], others, __pp.bounds)) return [dx, dy]; }
        return null; }""", "a")
    assert off, "no free tray offset"
    a = xy(page, "a")
    ptr.drag(a, (a[0] + off[0] * S + 0.3 * S, a[1] + off[1] * S - 0.3 * S))
    idle(page)
    p1 = piece(page, "a")
    assert p1["pos"] == [p0["pos"][0] + off[0], p0["pos"][1] + off[1]], f"{p0['pos']} + {off} -> {p1['pos']}"
    assert p1["at"] is None
    tl = page.evaluate("__pp.drawnTopLeft('a')")
    assert abs(tl[0] - (g["ox"] + p1["pos"][0] * S)) < 0.6 and abs(tl[1] - (g["oy"] + p1["pos"][1] * S)) < 0.6, f"drawn {tl}"
    assert not panel_state(page)["open"], "panel opened by a drag"
    assert page.evaluate("__pp.moves") == 0, "drag counted as a move"
    assert_consistent(page)


def drag_follows_finger(page, ptr):
    """끄는 동안 잡은 점이 손가락 바로 아래(지연 없음): 포인터 이벤트마다, 그 이벤트를 처리한 직후의
    그린 왼쪽 위 이동량 = 손가락 이동량(무대 px). 잰 횟수가 충분해야 한다."""
    a = xy(page, "b")
    page.evaluate("""([ax, ay]) => {
        const tl0 = __pp.drawnTopLeft('b'); const a = __pp.clientToStage(ax, ay);
        window.__lag = { max: 0, n: 0 };
        document.getElementById('board').addEventListener('pointermove', (e) => {
          if (!document.querySelector('.pp-piece.lifted')) return;
          const tl = __pp.drawnTopLeft('b'); const f = __pp.clientToStage(e.clientX, e.clientY);
          const d = Math.max(Math.abs((tl[0] - tl0[0]) - (f[0] - a[0])), Math.abs((tl[1] - tl0[1]) - (f[1] - a[1])));
          window.__lag.max = Math.max(window.__lag.max, d); window.__lag.n += 1; });
      }""", list(a))
    tgt = cell_client(page, 2, 1)
    ptr.down(*a)
    page.wait_for_timeout(30)
    ptr.move(tgt[0], tgt[1], steps=24)
    page.wait_for_timeout(60)
    lag = page.evaluate("window.__lag")
    ptr.up()
    idle(page)
    assert lag["n"] >= 10, f"only {lag['n']} drag events measured"
    assert lag["max"] < 1.0, f"piece lags the finger by {lag['max']:.1f}px"
    assert_consistent(page)


def board_drop_and_stage1_red(page, ptr):
    """해답 모양을 판의 해답 자리에 끌어 놓으면 판에(붉은 표시 없음), 틀린 자리면 붉은 표시, 트레이로 빼면 사라짐."""
    g = G(page)
    S = g["S"]
    sol = page.evaluate("__pp.puzzle.solutions[0]")
    r = sol[0]
    set_piece(page, r["id"], elem=r["elem"])

    def drag_to_pos(pos):
        a = xy(page, r["id"])
        tl = page.evaluate("(id) => __pp.drawnTopLeft(id)", r["id"])
        tgt = page.evaluate("(p) => __pp.stageToClient(p)", [g["ox"] + pos[0] * S, g["oy"] + pos[1] * S])
        cur = page.evaluate("(p) => __pp.stageToClient(p)", tl)
        ptr.drag(a, (a[0] + tgt["x"] - cur["x"] + 0.2 * S, a[1] + tgt["y"] - cur["y"] - 0.2 * S), steps=16)
        idle(page)

    drag_to_pos([r["dx"], r["dy"]])
    p = piece(page, r["id"])
    assert p["at"] == [r["dx"], r["dy"]], f"not on board at solution {p}"
    assert page.evaluate("__pp.wrong") == [] and page.evaluate("__pp.wrongPolys()") == 0
    # 판 위 틀린 자리(들어가지만 어느 해답의 자리도 아님)
    spot = page.evaluate("""(id) => { const s = __pp.state; const p = s.pieces.find((q) => q.id === id);
        const others = s.pieces.filter((q) => q.id !== id).map((q) => __pp.translate(q.tris, q.pos[0], q.pos[1]));
        for (let y = -3; y < 8; y++) for (let x = -3; x < 8; x++) {
          if (!__pp.canPlace(__pp.puzzle.board, others, __pp.translate(p.tris, x, y))) continue;
          const t = s.pieces.map((q) => (q.id === id ? { ...q, pos: [x, y], at: [x, y] } : q));
          if (__pp.wrongOf(t).length > 0) return [x, y]; }
        return null; }""", r["id"])
    assert spot, "no wrong board spot"
    drag_to_pos(spot)
    p = piece(page, r["id"])
    assert p["at"] == spot, f"wrong spot not taken {p} {spot}"
    wrong = page.evaluate("__pp.wrong")
    assert len(wrong) > 0 and page.evaluate("__pp.wrongPolys()") == len(wrong), "no red marks"
    page.screenshot(path=os.path.join(OUT, f"red-{ptr.mode}.png"))
    # 트레이(판 왼쪽 바깥)로 빼면 붉은 표시가 사라진다
    a = xy(page, r["id"])
    ptr.drag(a, (a[0] - 7 * S, a[1]), steps=16)
    idle(page)
    assert piece(page, r["id"])["at"] is None
    assert page.evaluate("__pp.wrong") == [] and page.evaluate("__pp.wrongPolys()") == 0
    assert_consistent(page)


def drop_outside_stage_returns_piece(page, ptr):
    """Review Focus 1: 판 밖·화면 밖·화면 UI 위로 끌어 놓은 조각은 트레이 안 빈 자리로 돌아온다."""
    g = G(page)
    vw, vh = page.viewport_size["width"], page.viewport_size["height"]
    targets = [(2, 2), (vw - 2, vh - 2), (vw / 2, 1), (vw - 3, vh * 0.4)]
    if ptr.mode == "mouse":
        targets.append((-60, -40))  # 창 밖(포인터 잡기로 이벤트는 계속 온다)
    for t in targets:
        a = xy(page, "b")
        ptr.drag(a, t, steps=18)
        idle(page)
        p = piece(page, "b")
        assert p["at"] is None, f"{t}: landed on board {p}"
        assert_consistent(page, f"{t}")
        boxes = page.evaluate("""() => { const r = {}; for (const p of __pp.state.pieces) {
            const tl = __pp.drawnTopLeft(p.id); r[p.id] = tl; } return r; }""")
        tl = boxes["b"]
        assert -0.5 <= tl[0] <= g["W"] and -0.5 <= tl[1] <= g["H"], f"{t}: drawn off stage {tl}"
        # 화면 UI 칸과 겹치지 않는다
        hit = page.evaluate("""() => { const p = __pp.state.pieces.find((q) => q.id === 'b'); const g = __pp.g;
            const out = []; for (const [x, y] of p.tris.map((t) => [t[0] + p.pos[0], t[1] + p.pos[1]])) {
              const l = g.ox + x * g.S, tp = g.oy + y * g.S;
              for (const u of __pp.ui) if (l < u.r && u.l < l + g.S && tp < u.b && u.t < tp + g.S) out.push(u.name); }
            return out; }""")
        assert hit == [], f"{t}: piece under UI {hit}"


def tap_opens_panel(page, ptr):
    """탭 → 이동 패널: 버튼 10개(숨김 모드 12개) 48px 이상, 화면 안, 교과서 낱말 aria-label, 조각·UI를 덮지 않음."""
    ptr.tap(*xy(page, "b"))
    page.wait_for_timeout(120)
    ps = panel_state(page)
    assert ps["open"] and ps["id"] == "b", f"panel {ps}"
    btns = page.query_selector_all("#pp-panel button")
    hidden = page.evaluate("__pp.hidden")
    assert len(btns) == (12 if hidden else 10), len(btns)
    labels = {}
    for b in btns:
        bb = b.bounding_box()
        assert bb["width"] >= 48 and bb["height"] >= 48, f"small button {bb}"
        assert bb["x"] >= 0 and bb["y"] >= 0 and bb["x"] + bb["width"] <= VIEW["width"] \
            and bb["y"] + bb["height"] <= VIEW["height"], f"clipped {bb}"
        mv = b.get_attribute("data-move")
        if mv:
            labels[mv] = b.get_attribute("aria-label")
    assert labels == LABELS, labels
    assert page.evaluate("__pp.covered()") == [], "panel covers a piece"
    pr = page.evaluate("__pp.panelRect()")
    off = page.evaluate("__pp.stageToClient([0, 0])")
    for u in page.evaluate("__pp.ui"):
        l, t, r, b = u["l"] + off["x"], u["t"] + off["y"], u["r"] + off["x"], u["b"] + off["y"]
        assert not (pr["x"] < r and l < pr["x"] + pr["width"] and pr["y"] < b and t < pr["y"] + pr["height"]), f"panel over {u['name']}"


def panel_never_covers_pieces(page, ptr):
    """Review Focus 2: 패널이 열린 채 다른 조각을 누르면 그 조각이 골라질 뿐 아무것도 바뀌지 않는다(탭이 버튼에 맞지 않음)."""
    ids = [p["id"] for p in state(page)["pieces"]]
    for k, i in enumerate(ids):
        open_panel(page, ptr, i)
        assert page.evaluate("__pp.covered()") == [], f"panel on {i} covers pieces"
        before = state(page)
        j = ids[(k + 1) % len(ids)]
        ptr.tap(*xy(page, j))
        page.wait_for_timeout(100)
        after = state(page)
        assert [(p["tris"], p["pos"], p["queue"]) for p in after["pieces"]] == \
            [(p["tris"], p["pos"], p["queue"]) for p in before["pieces"]], "tap on another piece changed something"
        assert after["moves"] == before["moves"]
        ps = panel_state(page)
        assert ps["open"] and ps["id"] == j, f"panel {ps}"
    page.screenshot(path=os.path.join(OUT, f"panel-{ptr.mode}.png"))


def ten_buttons_results(page, ptr):
    """버튼 10종: 결과 모양 = applyMove, 이동 1회씩, 겹침·판 침범 없음, 패널은 같은 조각에 열린 채 조각을 덮지 않음."""
    for n, m in enumerate(LABELS):
        open_panel(page, ptr, "a")
        before = piece(page, "a")
        press(page, ptr, m)
        after = piece(page, "a")
        want = page.evaluate("([t, m]) => __pp.key(__pp.applyMove(t, m))", [before["tris"], m])
        assert shape_key(page, after["tris"]) == want, f"{m}: wrong shape"
        assert page.evaluate("__pp.moves") == n + 1, f"{m}: moves {page.evaluate('__pp.moves')}"
        assert after["at"] is None, f"{m}: tray piece entered the board"
        assert_consistent(page, m)
        ps = panel_state(page)
        assert ps["open"] and ps["id"] == "a", f"{m}: panel {ps}"
        assert page.evaluate("__pp.covered()") == [], f"{m}: panel covers a piece"


def hidden_queue_undo_reset(page, ptr):
    """숨김 모드: 버튼은 카드 줄에 쌓이고 모양은 그대로, 되돌리기 = 이동 1회, 처음으로 = 줄 비움(이동 수 그대로)."""
    open_panel(page, ptr, "a")
    shape0 = shape_key(page, piece(page, "a")["tris"])
    for m in ["flipLeft", "cw90", "cw180"]:
        press(page, ptr, m)
    p = piece(page, "a")
    assert p["queue"] == ["flipLeft", "cw90", "cw180"], p["queue"]
    assert shape_key(page, p["tris"]) == shape0, "shape changed in hidden mode"
    assert page.evaluate("__pp.moves") == 3
    assert page.evaluate("__pp.queueCards('a')") == 3
    # 패널은 카드 줄도 조각도 덮지 않는다
    pr = page.evaluate("__pp.panelRect()")
    qr = page.evaluate("__pp.queueRect('a')")
    off = page.evaluate("__pp.stageToClient([0, 0])")
    ql, qt, qr_, qb = qr["l"] + off["x"], qr["t"] + off["y"], qr["r"] + off["x"], qr["b"] + off["y"]
    assert not (pr["x"] < qr_ and ql < pr["x"] + pr["width"] and pr["y"] < qb and qt < pr["y"] + pr["height"]), "panel covers the card row"
    assert page.evaluate("__pp.covered()") == []
    page.screenshot(path=os.path.join(OUT, f"hidden-queue-{ptr.mode}.png"))
    press(page, ptr, "undo")
    assert piece(page, "a")["queue"] == ["flipLeft", "cw90"]
    assert page.evaluate("__pp.moves") == 4
    assert page.evaluate("__pp.queueCards('a')") == 2
    press(page, ptr, "reset")
    assert piece(page, "a")["queue"] == []
    assert page.evaluate("__pp.moves") == 4
    assert page.evaluate("__pp.queueCards('a')") == 0
    assert page.query_selector('#pp-panel button[data-action="undo"]').is_disabled()


def _queue_and_reveal_target(page, ptr, pid, seq, finger_cell_fn):
    open_panel(page, ptr, pid)
    for m in seq:
        press(page, ptr, m)
    p = piece(page, pid)
    assert p["queue"] == seq
    a = xy(page, pid)
    grab = page.evaluate("([x, y]) => __pp.triAt(x, y)", list(a))
    assert grab and grab["id"] == pid, grab
    res = page.evaluate("([t, m, q, g]) => __pp.L.revealResult(t, m, q, g)", [p["tris"], p["mark"], p["queue"], grab["tri"]])
    cx, cy = finger_cell_fn(res)
    return a, cell_client(page, cx, cy, 0.45, 0.55), res


def hidden_drop_reveals(page, ptr):
    """숨김 모드: 판에 놓으면 쌓인 이동이 차례로 재생되고, 잡은 사분이 간 칸이 손가락 칸에 오게 놓인다."""
    sol = page.evaluate("__pp.puzzle.solutions[0]")
    r = next(x for x in sol if len(ELEM_MOVES[x["elem"]]) > 0)
    seq = ELEM_MOVES[r["elem"]]
    a, tgt, res = _queue_and_reveal_target(page, ptr, r["id"], seq,
                                           lambda res: (r["dx"] + res["grab"][0], r["dy"] + res["grab"][1]))
    ptr.drag(a, tgt, steps=16)
    animating = page.evaluate("__pp.busy")
    idle(page)
    p = piece(page, r["id"])
    assert p["at"] == [r["dx"], r["dy"]], f"revealed piece not at solution {p['at']} want {[r['dx'], r['dy']]}"
    want = page.evaluate("([s, e, d]) => __pp.key(__pp.translate(__pp.normalize(__pp.applyElem(s, e)), d[0], d[1]))",
                         [next(q for q in page.evaluate("__pp.puzzle.pieces") if q["id"] == r["id"])["start"], r["elem"], [r["dx"], r["dy"]]])
    assert shape_key(page, p["tris"], p["at"]) == want, "revealed shape differs"
    assert p["queue"] == [] and page.evaluate(f"__pp.queueCards('{r['id']}')") == 0
    assert page.evaluate("__pp.moves") == len(seq), "drop counted as a move"
    assert animating, "reveal did not animate"
    assert_consistent(page)


def hidden_drop_failure_resets_queue(page, ptr):
    """Review Focus 3: 이동을 잔뜩 쌓고 판의 다른 조각 위에 놓으면 드러난 결과 모양으로 트레이에, 줄은 빈다.
    판정·이어지는 조작이 깨지지 않는다."""
    sol = page.evaluate("__pp.puzzle.solutions[0]")
    a_rec, b_rec = sol[0], sol[1]
    set_piece(page, b_rec["id"], elem=b_rec["elem"], pos=[b_rec["dx"], b_rec["dy"]], on_board=True)
    b_before = piece(page, b_rec["id"])
    seq = ["flipLeft", "cw90", "cw180", "flipUp", "ccw90", "cw270", "flipRight"]
    b_cell = page.evaluate("(p) => __pp.translate(p.tris, p.pos[0], p.pos[1])[0]", b_before)
    a, tgt, res = _queue_and_reveal_target(page, ptr, a_rec["id"], seq, lambda res: (b_cell[0], b_cell[1]))
    moves = page.evaluate("__pp.moves")
    assert moves == len(seq)
    ptr.drag(a, tgt, steps=16)
    page.wait_for_timeout(60)
    page.screenshot(path=os.path.join(OUT, f"hidden-fail-mid-{ptr.mode}.png"))
    idle(page)
    p = piece(page, a_rec["id"])
    assert p["queue"] == [], f"queue not emptied {p['queue']}"
    assert p["at"] is None, "failed piece stayed on the board"
    assert shape_key(page, p["tris"]) == shape_key(page, res["tris"]), "revealed shape is not the new start shape"
    assert p["mark"] == res["mark"]
    assert page.evaluate("__pp.moves") == moves, "drop changed the move count"
    assert piece(page, b_rec["id"]) == b_before, "other piece disturbed"
    assert page.evaluate("__pp.solved") is False
    assert page.evaluate(f"__pp.queueCards('{a_rec['id']}')") == 0
    assert_consistent(page)
    # 이어서 조작이 된다
    open_panel(page, ptr, a_rec["id"])
    press(page, ptr, "cw90")
    assert piece(page, a_rec["id"])["queue"] == ["cw90"]
    assert page.evaluate("__pp.moves") == moves + 1


def empty_tap_closes_panel(page, ptr):
    open_panel(page, ptr, "a")
    g = G(page)
    # 판 위 빈 곳(조각 없음)
    pt = page.evaluate("(p) => __pp.stageToClient(p)", [g["inner"]["l"] + 6, g["inner"]["t"] + 6])
    assert page.evaluate("([x, y]) => __pp.triAt(x, y)", [pt["x"], pt["y"]]) is None
    ptr.tap(pt["x"], pt["y"])
    page.wait_for_timeout(80)
    assert not panel_state(page)["open"], "panel still open after empty tap"


def cancel_mid_drag_lands(page, ptr):
    a = xy(page, "a")
    ptr.down(*a)
    page.wait_for_timeout(30)
    ptr.move(a[0] + 90, a[1] + 30, steps=8)
    page.wait_for_timeout(30)
    assert page.evaluate("document.querySelector('.pp-piece.lifted') !== null"), "not lifted during drag"
    ptr.cancel()
    page.wait_for_timeout(60)
    if ptr.mode == "mouse":
        ptr.up()
    idle(page)
    assert page.evaluate("document.querySelector('.pp-piece.lifted') === null"), "still lifted after cancel"
    g = G(page)
    p = piece(page, "a")
    tl = page.evaluate("__pp.drawnTopLeft('a')")
    assert abs(tl[0] - (g["ox"] + p["pos"][0] * g["S"])) < 0.6 and abs(tl[1] - (g["oy"] + p["pos"][1] * g["S"])) < 0.6
    assert_consistent(page)


def reduced_motion_is_instant(page, ptr):
    """prefers-reduced-motion: 버튼을 누르면 애니메이션 없이 바로 끝난 모습(busy 아님, 변환 없음)."""
    assert page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")
    open_panel(page, ptr, "a")
    bb = page.query_selector('#pp-panel button[data-move="cw90"]').bounding_box()
    ptr.tap(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
    page.wait_for_timeout(20)
    assert page.evaluate("__pp.busy") is False
    assert page.evaluate("document.querySelector('.pp-piece[data-id=\"a\"] .pp-anim').getAttribute('transform')") is None
    assert page.evaluate("__pp.moves") == 1


def right_button_ignored(page, ptr):
    before = piece(page, "a")
    a = xy(page, "a")
    page.mouse.move(*a)
    page.mouse.down(button="right")
    page.mouse.move(a[0] + 150, a[1], steps=10)
    page.mouse.up(button="right")
    page.wait_for_timeout(100)
    assert piece(page, "a") == before
    assert not panel_state(page)["open"]
    page.evaluate("window.__types.push('mouse')")  # 오른쪽 버튼은 기록하지 않으므로 형식 검사용


TESTS = [
    ("s1-001", drag_snaps_to_cells), ("s1-001", drag_follows_finger), ("s1-001", board_drop_and_stage1_red),
    ("s2-010", drop_outside_stage_returns_piece), ("s1-003", tap_opens_panel), ("s3-005&hidden=1", tap_opens_panel),
    ("s4-007", panel_never_covers_pieces), ("s3-009&hidden=1", panel_never_covers_pieces), ("s2-005", ten_buttons_results),
    ("s3-005&hidden=1", hidden_queue_undo_reset), ("s3-001&hidden=1", hidden_drop_reveals),
    ("s4-012&hidden=1", hidden_drop_reveals), ("s4-012&hidden=1", hidden_drop_failure_resets_queue),
    ("s3-020&hidden=1", hidden_drop_failure_resets_queue), ("s1-002", empty_tap_closes_panel),
    ("s2-001", cancel_mid_drag_lands),
    # 1024x768(무대 1024x640, 위아래 여백)
    ("s1-001", drag_snaps_to_cells, SMALL), ("s4-040", drop_outside_stage_returns_piece, SMALL),
    ("s4-040", panel_never_covers_pieces, SMALL), ("s3-005&hidden=1", tap_opens_panel, SMALL),
    ("s4-033&hidden=1", hidden_drop_reveals, SMALL), ("s4-020&hidden=1", hidden_drop_failure_resets_queue, SMALL),
    ("s2-005", ten_buttons_results, SMALL), ("s1-004", board_drop_and_stage1_red, SMALL),
    ("s2-003", reduced_motion_is_instant, VIEW, "reduce"),
]
MOUSE_ONLY = [("s1-001", right_button_ignored)]


def main():
    failed, passed = [], 0
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        try:
            for mode in ("mouse", "touch"):
                for entry in TESTS + (MOUSE_ONLY if mode == "mouse" else []):
                    pid, t = entry[0], entry[1]
                    view = entry[2] if len(entry) > 2 else VIEW
                    motion = entry[3] if len(entry) > 3 else "no-preference"
                    name = f"[{mode}] {t.__name__} ({pid}) {view['width']}x{view['height']}"
                    if ONLY and not any(o in name for o in ONLY):
                        continue
                    ctx = browser.new_context(viewport=view, has_touch=(mode == "touch"), reduced_motion=motion)
                    try:
                        page, ptr, errors = open_page(ctx, mode, f"id={pid}")
                        t(page, ptr)
                        types = set(page.evaluate("window.__types"))
                        assert types and types <= {mode}, f"pointerType {types}"
                        assert not errors, f"page errors {errors}"
                        passed += 1
                        print("PASS", name, flush=True)
                    except Exception as e:  # noqa: BLE001
                        failed.append(name)
                        print("FAIL", name, "-", str(e).splitlines()[0][:400], flush=True)
                        try:
                            page.screenshot(path=os.path.join(OUT, f"fail-{mode}-{t.__name__}-{view['width']}.png"))
                        except Exception:  # noqa: BLE001
                            pass
                    finally:
                        ctx.close()
        finally:
            browser.close()
    print(f"{passed} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
