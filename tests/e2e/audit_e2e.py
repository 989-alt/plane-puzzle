"""Task 8 브라우저 전수 풀이 감사. 큐브 왕국 tests/e2e/audit_e2e.py 구조.

단계마다 3문제(모두 12문제)를 **실제 포인터 조작만으로** 정답 화면까지 푼다. 마우스(1280×800)와 터치(CDP, 1024×768)
두 방식 → 24번. solveCurrent 는 쓰지 않는다(문제 고르기 setProgress·setPuzzle 만 훅).

조각마다:
  1) 저장된 해답(solutions[0])의 elem 으로 목표 모양을 구하고, MOVES(교과서 이동 10가지)로 BFS 해 가장 짧은 버튼 순서를 얻는다.
  2) 순서가 있으면 조각을 탭해 이동 패널을 열고 버튼을 차례로 누른다(3·4단계 숨김 모드: 카드 줄에 쌓인다).
     조각을 탭하기 전마다 elementFromPoint 로 그 점이 그 조각인지(패널 버튼이 아닌지) 보고, 버튼을 누르기 전마다 그 점이 그 버튼인지 본다.
  3) 조각을 잡은 사분(grab)을 목표 칸으로 끈다. 보이는 모드: 잡은 점을 (해답 자리 − 지금 자리)×칸 만큼 옮긴다.
     숨김 모드: L.revealResult 로 잡은 사분이 결과에서 간 사분을 구해 그 칸에 손가락을 놓는다(놓는 순간 드러남).
마지막 조각을 놓으면 정답 화면(screen === 'win')이 떠야 한다. 패널 버튼에 잘못 맞은 탭은 0이어야 한다.

  python tests/e2e/audit_e2e.py [base_url] [mouse|touch]

base_url 을 주지 않으면 저장소 루트를 tests/e2e/serve.py(8770)로 띄운다. 이 PC는 8GB: e2e는 한 번에 하나씩.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
PORT = 8770
ARGS = sys.argv[1:]
BASE_ARG = next((a for a in ARGS if a.startswith("http")), None)
ONLY = [a for a in ARGS if not a.startswith("http")]
MODES = (("mouse", {"width": 1280, "height": 800}), ("touch", {"width": 1024, "height": 768}))

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)


def pick_ids():
    """단계마다 은행의 처음·가운데·끝 문제."""
    out = []
    for s in (1, 2, 3, 4):
        with open(os.path.join(ROOT, "data", f"puzzles-s{s}.json"), encoding="utf-8") as f:
            ids = [p["id"] for p in json.load(f)]
        out += [(s, ids[0]), (s, ids[len(ids) // 2]), (s, ids[-1])]
    return out


class Pointer:
    def __init__(self, page, mode, cdp=None):
        self.page, self.mode, self.cdp = page, mode, cdp
        self.pos = (0, 0)

    def _touch(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})

    def tap(self, x, y):
        if self.mode == "mouse":
            self.page.mouse.click(x, y)
        else:
            self.page.touchscreen.tap(x, y)

    def drag(self, a, b, steps=16):
        if self.mode == "mouse":
            self.page.mouse.move(*a)
            self.page.mouse.down()
            self.page.wait_for_timeout(30)
            self.page.mouse.move(b[0], b[1], steps=steps)
            self.page.wait_for_timeout(30)
            self.page.mouse.up()
        else:
            self._touch("touchStart", [a])
            self.page.wait_for_timeout(30)
            for k in range(1, steps + 1):
                self._touch("touchMove", [(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps)])
                self.page.wait_for_timeout(8)
            self.page.wait_for_timeout(30)
            self._touch("touchEnd", [])


def idle(page):
    page.wait_for_function("!__pp.busy", timeout=8000)
    page.wait_for_timeout(40)


# BFS: 지금 모양 → 해답 모양까지 가장 짧은 교과서 이동 순서
PLAN_JS = """(pid) => {
  const P = __pp.puzzle; const pc = __pp.state.pieces.find((q) => q.id === pid);
  const r = P.solutions[0].find((q) => q.id === pid);
  const start = __pp.normalize(P.pieces.find((q) => q.id === pid).start);
  const want = __pp.key(__pp.normalize(__pp.applyElem(start, r.elem)));
  const k0 = __pp.key(__pp.normalize(pc.tris));
  const seen = new Map([[k0, []]]); const qu = [__pp.normalize(pc.tris)];
  while (qu.length) {
    const t = qu.shift(); const path = seen.get(__pp.key(t));
    if (__pp.key(t) === want) return {seq: path, dx: r.dx, dy: r.dy};
    for (const m of __pp.MOVES) { const n = __pp.normalize(__pp.applyMove(t, m)); const k = __pp.key(n);
      if (!seen.has(k)) { seen.set(k, [...path, m]); qu.push(n); } }
  }
  return null; }"""

# (x, y) 점에 맞는 것: 'piece:<id>' | 'btn:<move|action>' | 그 밖의 이름
HIT_JS = """([x, y]) => { const e = document.elementFromPoint(x, y); if (!e) return 'none';
  const b = e.closest('#pp-panel button'); if (b) return 'btn:' + (b.dataset.move || b.dataset.action);
  if (e.closest('#pp-panel')) return 'panel';
  const pc = e.closest('.pp-piece'); if (pc) return 'piece:' + pc.getAttribute('data-id');
  return e.id || e.tagName; }"""


def solve_by_pointer(page, ptr, stats):
    """지금 문제를 포인터로만 푼다. 실패하면 AssertionError."""
    hidden = page.evaluate("__pp.hidden")
    order = page.evaluate("__pp.puzzle.solutions[0].map((r) => r.id)")
    for pid in order:
        plan = page.evaluate(PLAN_JS, pid)
        assert plan is not None, f"{pid}: BFS 실패"
        if plan["seq"]:
            ps = page.evaluate("__pp.panelState()")
            if not (ps["open"] and ps["id"] == pid):
                p = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
                hit = page.evaluate(HIT_JS, [p["x"], p["y"]])
                stats["piece_taps"] += 1
                if hit != f"piece:{pid}":
                    stats["mis_taps"].append((pid, hit))
                ptr.tap(p["x"], p["y"])
                page.wait_for_timeout(80)
                ps = page.evaluate("__pp.panelState()")
                assert ps["open"] and ps["id"] == pid, f"{pid}: 패널이 열리지 않음 {ps}"
            for m in plan["seq"]:
                bb = page.query_selector(f'#pp-panel button[data-move="{m}"]').bounding_box()
                assert bb, f"{pid}: 버튼 {m} 없음"
                cx, cy = bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2
                hit = page.evaluate(HIT_JS, [cx, cy])
                stats["btn_taps"] += 1
                if hit != f"btn:{m}":
                    stats["btn_miss"].append((pid, m, hit))
                ptr.tap(cx, cy)
                page.wait_for_timeout(60)
                idle(page)
        pc = page.evaluate("(id) => __pp.state.pieces.find((q) => q.id === id)", pid)
        if hidden:
            assert pc["queue"] == plan["seq"], f"{pid}: 카드 줄 {pc['queue']} != {plan['seq']}"
        a = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
        hit = page.evaluate(HIT_JS, [a["x"], a["y"]])
        if hit != f"piece:{pid}":
            stats["mis_grabs"].append((pid, hit))
        grab = page.evaluate("([x, y]) => __pp.triAt(x, y)", [a["x"], a["y"]])
        assert grab and grab["id"] == pid, f"{pid}: 잡기 실패 {grab}"
        if hidden and pc["queue"]:
            res = page.evaluate("([t, m, q, g]) => __pp.L.revealResult(t, m, q, g)", [pc["tris"], pc["mark"], pc["queue"], grab["tri"]])
            cx, cy = plan["dx"] + res["grab"][0], plan["dy"] + res["grab"][1]
            tgt = page.evaluate("([cx, cy]) => { const g = __pp.g; return __pp.stageToClient([g.ox + (cx + 0.45) * g.S, g.oy + (cy + 0.55) * g.S]); }", [cx, cy])
        else:
            tgt = page.evaluate("""([a, pos, dx, dy]) => { const g = __pp.g; const r = document.getElementById('board').getBoundingClientRect();
                const k = r.width / g.W; return {x: a.x + (dx - pos[0]) * g.S * k, y: a.y + (dy - pos[1]) * g.S * k}; }""",
                                [a, pc["pos"], plan["dx"], plan["dy"]])
        ptr.drag((a["x"], a["y"]), (tgt["x"], tgt["y"]))
        page.wait_for_timeout(60)
        idle(page)
        after = page.evaluate("(id) => __pp.state.pieces.find((q) => q.id === id)", pid)
        assert after["at"] == [plan["dx"], plan["dy"]], f"{pid}: 판 자리 {after['at']} != {[plan['dx'], plan['dy']]}"
        assert after["queue"] == [], f"{pid}: 남은 카드 {after['queue']}"
    page.wait_for_function("() => __pp.game().screen === 'win'", timeout=6000)


def run_mode(browser, base, mode, view):
    opts = {"viewport": view}
    if mode == "touch":
        opts.update(has_touch=True)
    ctx = browser.new_context(**opts)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.goto(f"{base}/index.html?e2e")
    page.evaluate("() => { localStorage.clear(); localStorage.setItem('pp.tutorialSeen', 'true'); }")
    page.reload()
    page.wait_for_function("() => window.__ppReady === true && window.__pp", timeout=15000)
    page.evaluate("document.fonts.ready")
    cdp = ctx.new_cdp_session(page) if mode == "touch" else None
    ptr = Pointer(page, mode, cdp)
    page.evaluate("""() => { window.__types = new Set(); document.addEventListener('pointerdown', (e) => {
        if (e.isTrusted) window.__types.add(e.pointerType); }, true); }""")
    bb = page.query_selector("#startBtn").bounding_box()
    ptr.tap(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
    page.wait_for_function("() => __pp.game().screen === 'game' && __pp.game().puzzleId", timeout=15000)
    page.wait_for_timeout(300)
    for stage, pid in pick_ids():
        name = f"[{mode}] {pid}"
        stats = {"piece_taps": 0, "btn_taps": 0, "mis_taps": [], "btn_miss": [], "mis_grabs": []}
        try:
            page.evaluate(f"__pp.setProgress({{stage: {stage}}})")
            page.evaluate(f"__pp.setPuzzle('{pid}')")
            page.wait_for_timeout(250)
            g0 = page.evaluate("__pp.game()")
            assert g0["puzzleId"] == pid and g0["hidden"] == (stage >= 3), f"setup {g0['puzzleId']} hidden={g0['hidden']}"
            solve_by_pointer(page, ptr, stats)
            g1 = page.evaluate("__pp.game()")
            page.screenshot(path=os.path.join(OUT, f"audit-{mode}-{pid}.png"))
            ok = (g1["screen"] == "win" and not stats["mis_taps"] and not stats["btn_miss"] and not stats["mis_grabs"]
                  and not errors)
            check(name, ok, f"moves={page.evaluate('__pp.moves')}/{page.evaluate('__pp.puzzle.minMoves')} "
                            f"pieceTaps={stats['piece_taps']} btnTaps={stats['btn_taps']} misTaps={stats['mis_taps']} "
                            f"btnMiss={stats['btn_miss']} misGrabs={stats['mis_grabs']} errors={errors[:2]}")
        except Exception as e:  # 한 문제가 죽어도 나머지는 돈다
            page.screenshot(path=os.path.join(OUT, f"audit-{mode}-{pid}-FAIL.png"))
            check(name, False, f"error: {str(e).splitlines()[0][:300]} stats={stats}")
        # 다음 문제로: 정답 화면이면 '다음 문제' 버튼을 포인터로 누른다
        if page.evaluate("__pp.game().screen") == "win":
            page.wait_for_timeout(300)
            nb = page.query_selector("#nextBtn").bounding_box()
            ptr.tap(nb["x"] + nb["width"] / 2, nb["y"] + nb["height"] / 2)
            page.wait_for_function("() => __pp.game().screen === 'game'", timeout=5000)
            page.wait_for_timeout(250)
        errors.clear()
    types = page.evaluate("[...window.__types]")
    check(f"[{mode}] pointerType", types == [mode], f"types={types}")
    ctx.close()


def main():
    server = None
    base = BASE_ARG
    if base is None:
        server = serve.start(ROOT, PORT)
        base = f"http://127.0.0.1:{PORT}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            try:
                for mode, view in MODES:
                    if ONLY and mode not in ONLY:
                        continue
                    run_mode(browser, base, mode, view)
            finally:
                browser.close()
    finally:
        if server:
            server.terminate()
    solved = [r for r in results if r[0].startswith("[") and " s" in r[0]]
    failed = [r for r in results if not r[1]]
    print(f"\n퍼즐 {sum(1 for r in solved if r[1])}/{len(solved)} 풀이 · 전체 {len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
