"""Task 7 게임 흐름 e2e(정답·점수 공식·승급 1→4단계·쉬운 단서·숨김 모드 판정·최소 이동 별·건너뛰기·도움말·세로 안내·
새로고침 뒤 최고 점수). 큐브 왕국 tests/e2e/flow_test.py 이식. Playwright + 시스템 Edge(channel="msedge").

  python tests/e2e/flow_test.py [base_url] [시험 이름 일부 ...]

base_url 을 주지 않으면 저장소 루트에서 http.server(8769)를 직접 띄우고 끝나면 닫는다. 이 PC는 8GB: e2e는 한 번에 하나씩.
화면 캡처는 tests/e2e/out/flow-*.png (사람이 눈으로 확인).

시험 훅: index.html?e2e 이면 main.js 가 window.__pp 를 연다(Task 6 이름 그대로 + 흐름 훅)
  game(), state, puzzle, g, bounds, ui, moves, wrong, busy, solved, setPuzzle(id), solveCurrent({moves}), check(),
  elapsed(sec), setProgress(patch), dispatch(a), setState(s), pieceScreenXY(id), stageToClient([x, y]), consistent(), uiRects()
"""
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
PORT = 8769
VIEW = {"width": 1280, "height": 800}
ARGS = sys.argv[1:]
BASE_ARG = next((a for a in ARGS if a.startswith("http")), None)
ONLY = [a for a in ARGS if not a.startswith("http")]

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)


def start_server():
    return serve.start(ROOT, PORT)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"flow-{name}.png"))


def visible(page, sel):
    return page.locator(sel).first.is_visible()


def open_game(browser, base, ctx_opts=None, setup=None, wait_puzzle=True, view=VIEW):
    """안내를 본 것으로 두고 시작 버튼을 눌러 첫 문제까지 연다."""
    ctx = browser.new_context(viewport=view, **(ctx_opts or {}))
    page = ctx.new_page()
    if setup:
        setup(page)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.goto(f"{base}/index.html?e2e")
    page.evaluate("() => { localStorage.clear(); localStorage.setItem('pp.tutorialSeen', 'true'); }")
    page.reload()
    page.wait_for_function("() => window.__ppReady === true && window.__pp", timeout=15000)
    page.evaluate("document.fonts.ready")
    page.click("#startBtn")
    if wait_puzzle:
        page.wait_for_function("() => __pp.game().screen === 'game' && __pp.game().puzzleId", timeout=15000)
    page.wait_for_timeout(300)
    return ctx, page, errors


def game(page):
    return page.evaluate("__pp.game()")


def solve_and_next(page, elapsed=70, moves=None):
    """경과 시간을 정하고 정답으로 만든 뒤 승리 화면 → 다음 문제. 얻은 점수(+n)를 돌려준다."""
    page.evaluate(f"__pp.elapsed({elapsed})")
    page.evaluate("(m) => __pp.solveCurrent(m === null ? {} : {moves: m})", moves)
    page.wait_for_function("() => __pp.game().screen === 'win'", timeout=5000)
    page.wait_for_timeout(250)
    gain = page.inner_text("#winGain")
    calc = page.inner_text("#winCalc")
    page.click("#nextBtn")
    page.wait_for_function("() => __pp.game().screen === 'game' && !__pp.game().solved", timeout=5000)
    page.wait_for_timeout(250)
    return int(gain.replace("+", "").replace(",", "")), calc


def set_stage(page, stage, pid):
    page.evaluate(f"__pp.setProgress({{stage: {stage}}})")
    page.evaluate(f"__pp.setPuzzle('{pid}')")
    page.wait_for_timeout(250)


# ---------- 시험 ----------

def solve_shows_win_and_scores(browser, base):
    """1단계 정답 → 승리 화면, 점수 = (100 + max(0, 60 - floor(초))) × 1. 다음을 두 번 눌러도 한 번만 바뀐다."""
    ctx, page, errors = open_game(browser, base)
    s0 = game(page)
    yard0 = page.inner_text("#yardNext")
    page.evaluate("__pp.elapsed(12.7)")  # 빠르기 +48
    page.evaluate("__pp.solveCurrent()")
    page.wait_for_timeout(500)
    win = visible(page, "#screen-win")
    s1 = game(page)
    gain = page.inner_text("#winGain")
    calc = page.inner_text("#winCalc")
    shot(page, "win")
    page.evaluate("() => { const b = document.querySelector('#nextBtn'); b.click(); b.click(); }")
    page.wait_for_function("() => __pp.game().screen === 'game'", timeout=5000)
    page.wait_for_timeout(400)
    s2 = game(page)
    attempts = (int(s1["attemptId"].split("#")[1]), int(s2["attemptId"].split("#")[1]))
    yard2 = page.inner_text("#yardNext")
    check("solve_shows_win_and_scores",
          win and s1["score"] == 148 and gain == "+148" and "빠르기 +48" in calc and "기본 100" in calc
          and s2["puzzleId"] != s0["puzzleId"] and s2["puzzleId"].startswith("s1-")
          and yard0.endswith("5문제") and yard2.endswith("4문제") and s2["solvedTotal"] == 1
          and attempts[1] == attempts[0] + 1 and not errors,
          f"win={win} score={s1['score']} gain={gain} calc={calc!r} ids={s0['puzzleId']}->{s2['puzzleId']} "
          f"attempts={attempts} yard={yard0!r}->{yard2!r} errors={errors[:2]}")
    ctx.close()


def promote_through_stage4(browser, base):
    """깨끗한 정답 2번마다 다음 단계(1→2→3→4). 연속 배율 1,1,1.5,2,2,3 이 점수에 들어간다. 3·4단계는 숨김 모드."""
    ctx, page, errors = open_game(browser, base)
    gains, info = [], []
    for k in range(6):
        g0 = game(page)
        info.append((g0["stage"], g0["level"], g0["hidden"], g0["puzzleId"], page.inner_text("#stageText"),
                     page.get_attribute("#clueBody", "data-level")))
        if g0["stage"] == 3:
            shot(page, "stage3")
        moves = None if g0["stage"] < 4 else page.evaluate("__pp.puzzle.minMoves") + 1  # 4단계: 별 없이
        gain, _ = solve_and_next(page, elapsed=70, moves=moves)
        gains.append(gain)
    g6 = game(page)
    info.append((g6["stage"], g6["level"], g6["hidden"], g6["puzzleId"], page.inner_text("#stageText"),
                 page.get_attribute("#clueBody", "data-level")))
    goal = page.inner_text("#clueBody")
    shot(page, "stage4")
    expect_stage = [1, 1, 2, 2, 3, 3, 4]
    names = ["1단계 · 완성 모양", "1단계 · 완성 모양", "2단계 · 판 모양", "2단계 · 판 모양", "3단계 · 이동 조건",
             "3단계 · 이동 조건", "4단계 · 최소 이동"]
    ok_stage = all(i[0] == s and i[1] == s and i[2] == (s >= 3) and i[3].startswith(f"s{s}-") and i[4] == n
                   and i[5] == str(s) for i, s, n in zip(info, expect_stage, names))
    minm = page.evaluate("__pp.puzzle.minMoves")
    check("promote_through_stage4",
          ok_stage and gains == [100, 100, 150, 200, 200, 300] and g6["score"] == 1050
          and f"이동 {minm}번 안에 맞혀 보세요" in " ".join(goal.split()) and "지금 0번" in goal and not errors,
          f"info={info} gains={gains} score={g6['score']} goal={goal!r} errors={errors[:2]}")
    ctx.close()


def stage4_min_moves_star(browser, base):
    """4단계: 이동 수 ≤ 최소 이동이면 별 보너스(+50×배율), 넘겨도 정답(벌 없음, 별 없음). 지금 이동 수가 단서 카드에 보인다."""
    ctx, page, errors = open_game(browser, base)
    set_stage(page, 4, "s4-001")
    minm = page.evaluate("__pp.puzzle.minMoves")
    pid = page.evaluate("__pp.puzzle.pieces[0].id")
    page.evaluate("(id) => __pp.dispatch({type: 'move', id, move: 'cw90'})", pid)
    page.wait_for_timeout(100)
    live = page.inner_text("#clueBody")
    page.evaluate("__pp.elapsed(70)")
    page.evaluate(f"__pp.solveCurrent({{moves: {minm}}})")
    page.wait_for_function("() => __pp.game().screen === 'win'", timeout=5000)
    page.wait_for_timeout(300)
    gain = page.inner_text("#winGain")
    calc = page.inner_text("#winCalc")
    star = visible(page, "#winStar")
    shot(page, "win-star")
    page.click("#nextBtn")
    page.wait_for_function("() => __pp.game().screen === 'game' && !__pp.game().solved", timeout=5000)
    page.evaluate("__pp.elapsed(70)")
    page.evaluate(f"__pp.solveCurrent({{moves: {minm + 3}}})")
    page.wait_for_function("() => __pp.game().screen === 'win'", timeout=5000)
    page.wait_for_timeout(300)
    gain2 = page.inner_text("#winGain")
    star2 = visible(page, "#winStar")
    calc2 = page.inner_text("#winCalc")
    # 연속 1: 100 + 50 = 150, 연속 2: 100(별 없음)
    check("stage4_min_moves_star",
          "지금 1번" in live and gain == "+150" and "최소 이동" in calc and star
          and gain2 == "+100" and not star2 and "최소 이동" not in calc2 and not errors,
          f"live={live!r} gain={gain} calc={calc!r} star={star} gain2={gain2} star2={star2} errors={errors[:2]}")
    ctx.close()


def easy_hint_after_60s(browser, base):
    """쉬운 단서: 2단계 이상, 60초 뒤. 2단계 → 1단계 단서(완성 그림), 점수 절반, 승급 칸 0."""
    ctx, page, errors = open_game(browser, base)
    hidden_s1 = not visible(page, "#easyBtn")
    page.evaluate("__pp.elapsed(80)")
    page.wait_for_timeout(1200)
    hidden_s1_late = not visible(page, "#easyBtn")
    set_stage(page, 2, "s2-001")
    hidden_at_start = not visible(page, "#easyBtn")
    page.evaluate("__pp.elapsed(30)")
    hidden_at_30 = not visible(page, "#easyBtn")
    page.evaluate("__pp.elapsed(61)")
    page.wait_for_timeout(100)
    shown = visible(page, "#easyBtn")
    shot(page, "easy-button")
    page.click("#easyBtn")
    page.wait_for_timeout(200)
    st = game(page)
    level_attr = page.get_attribute("#clueBody", "data-level")
    lvl_text = page.inner_text("#clueLevel")
    ghost = page.evaluate("getComputedStyle(document.querySelector('.pp-ghost')).display !== 'none'")
    btn_gone = not visible(page, "#easyBtn")
    shot(page, "easy-clue")
    page.evaluate("__pp.solveCurrent()")
    page.wait_for_timeout(400)
    s2 = game(page)
    calc = page.inner_text("#winCalc")
    # 연속 1 · 61초 · 쉬운 단서: (100 + 0) × 1 × 0.5 = 50
    check("easy_hint_after_60s",
          hidden_s1 and hidden_s1_late and hidden_at_start and hidden_at_30 and shown and st["level"] == 1
          and st["usedEasy"] and level_attr == "1" and lvl_text.startswith("쉬운 단서") and ghost and btn_gone
          and s2["score"] == 50 and "쉬운 단서" in calc and s2["stage"] == 2 and not errors,
          f"s1={hidden_s1}/{hidden_s1_late} start_hidden={hidden_at_start} 30s_hidden={hidden_at_30} shown={shown} "
          f"level={st['level']} attr={level_attr} text={lvl_text!r} ghost={ghost} score={s2['score']} "
          f"stage={s2['stage']} errors={errors[:2]}")
    ctx.close()


def easy_turns_preview_on(browser, base):
    """3·4단계 쉬운 단서: 한 단계 쉬운 단서 + 숨김 모드 끔(미리보기 켬). 쌓인 카드는 바로 드러나고 이동 수는 그대로."""
    ctx, page, errors = open_game(browser, base)
    out = {}
    for stage, pid in ((3, "s3-001"), (4, "s4-001")):
        set_stage(page, stage, pid)
        h0 = game(page)["hidden"]
        pc = page.evaluate("__pp.state.pieces[0]")
        page.evaluate("(id) => { __pp.dispatch({type: 'move', id, move: 'cw90'}); __pp.dispatch({type: 'move', id, move: 'flipLeft'}); }", pc["id"])
        mid = page.evaluate("__pp.state.pieces[0]")
        page.evaluate("__pp.elapsed(61)")
        page.wait_for_timeout(100)
        page.click("#easyBtn")
        page.wait_for_timeout(300)
        g1 = game(page)
        after = page.evaluate("__pp.state")
        p0 = after["pieces"][0]
        want = page.evaluate("(t) => __pp.key(__pp.applyMove(__pp.applyMove(t, 'cw90'), 'flipLeft'))", pc["tris"])
        got = page.evaluate("(t) => __pp.key(__pp.normalize(t))", p0["tris"])
        n_buttons = page.evaluate("document.querySelectorAll('#pp-panel button').length")
        lvl = page.get_attribute("#clueBody", "data-level")
        cards = page.evaluate("document.querySelectorAll('#clueBody .cond').length")
        shot(page, f"easy-stage{stage}")
        out[stage] = (h0, len(mid["queue"]), g1["hidden"], g1["level"], lvl, want == got, p0["queue"], after["moves"],
                      n_buttons, cards, page.evaluate("__pp.consistent()"))
    ok3 = out[3][:6] == (True, 2, False, 2, "2", True) and out[3][6] == [] and out[3][7] == 2 and out[3][8] == 10 \
        and out[3][10] == []
    ok4 = out[4][:6] == (True, 2, False, 3, "3", True) and out[4][6] == [] and out[4][7] == 2 and out[4][8] == 10 \
        and out[4][9] >= 1 and out[4][10] == []
    check("easy_turns_preview_on", ok3 and ok4 and not errors, f"{out} errors={errors[:2]}")
    ctx.close()


def hidden_pending_queue_not_solved(browser, base):
    """숨김 모드: 판이 다 찼어도 카드에 남은 이동이 있으면 정답이 아니다(말풍선). 줄이 비면 정답."""
    ctx, page, errors = open_game(browser, base)
    set_stage(page, 3, "s3-001")
    page.evaluate("""() => { const s = __pp.state; const P = __pp.puzzle;
        for (const r of P.solutions[0]) { const pc = s.pieces.find((q) => q.id === r.id);
          const start = __pp.normalize(P.pieces.find((q) => q.id === r.id).start);
          const m = __pp.L.elemMarked(start, [...start[0], 0], r.elem);
          pc.tris = m.tris; pc.mark = m.mark; pc.pos = [r.dx, r.dy]; pc.at = [r.dx, r.dy]; pc.queue = []; }
        s.pieces[0].queue = ['cw90', 'ccw90'];
        __pp.setState(s); __pp.check(); }""")
    page.wait_for_timeout(300)
    g1 = game(page)
    bubble = page.evaluate("document.querySelector('#bubble').classList.contains('on')")
    text = page.inner_text("#bubbleText")
    shot(page, "pending-queue")
    page.evaluate("() => { const s = __pp.state; s.pieces[0].queue = []; __pp.setState(s); __pp.check(); }")
    page.wait_for_timeout(400)
    g2 = game(page)
    check("hidden_pending_queue_not_solved",
          not g1["solved"] and g1["screen"] == "game" and bubble
          and text == "카드에 남은 이동이 있어요. 조각을 다시 놓아 보세요" and g1["shakes"] == 0
          and g2["solved"] and g2["screen"] == "win" and not errors,
          f"g1={g1['solved']}/{g1['screen']} bubble={bubble} text={text!r} g2={g2['solved']}/{g2['screen']} errors={errors[:2]}")
    ctx.close()


def all_on_board_wrong_shakes(browser, base):
    """모든 조각이 판 위인데 정답이 아니면(겹침 가장자리 경우) 판을 살짝 흔들고 "모양이 조금 달라요". 점수·연속 그대로."""
    ctx, page, errors = open_game(browser, base)
    page.evaluate("__pp.setProgress({streak: 2})")
    before = game(page)
    page.evaluate("""() => { const s = __pp.state; const P = __pp.puzzle;
        for (const r of P.solutions[0]) { const pc = s.pieces.find((q) => q.id === r.id);
          const start = __pp.normalize(P.pieces.find((q) => q.id === r.id).start);
          const m = __pp.L.elemMarked(start, [...start[0], 0], r.elem);
          pc.tris = m.tris; pc.mark = m.mark; pc.pos = [r.dx, r.dy]; pc.at = [r.dx, r.dy]; }
        const a = s.pieces[0], b = s.pieces[1]; b.pos = [...a.pos]; b.at = [...a.pos];
        __pp.setState(s); __pp.check(); }""")
    page.wait_for_timeout(120)
    shaking = page.evaluate("document.getElementById('board').classList.contains('shake')")
    page.wait_for_timeout(200)
    bubble_on = page.evaluate("() => document.querySelector('#bubble').classList.contains('on')")
    text = page.inner_text("#bubbleText")
    after = game(page)
    shot(page, "mismatch")
    page.click("[data-tool=skip]")
    page.wait_for_function("(a) => __pp.game().attemptId !== a", arg=before["attemptId"], timeout=5000)
    bubble_after_skip = page.evaluate("() => document.querySelector('#bubble').classList.contains('on')")
    check("all_on_board_wrong_shakes",
          bubble_on and shaking and text == "모양이 조금 달라요" and after["score"] == before["score"]
          and after["screen"] == "game" and after["streak"] == before["streak"] and after["shakes"] == before["shakes"] + 1
          and not bubble_after_skip and not errors,
          f"bubble={bubble_on} shake={shaking} text={text!r} score={before['score']}->{after['score']} "
          f"shakes={after['shakes']} bubble_after_skip={bubble_after_skip} errors={errors[:2]}")
    ctx.close()


def stage_clues_and_red_marks(browser, base):
    """1단계: 완성 그림 + 잘못 놓은 자리 붉게. 2단계: 윤곽만(붉은 표시 없음). 3단계: 조건 카드(작은 조각 + 문구)."""
    ctx, page, errors = open_game(browser, base)
    set_stage(page, 1, "s1-001")
    ghost1 = page.evaluate("document.querySelectorAll('.pp-ghost [data-ghost]').length")
    ghost1_on = page.evaluate("getComputedStyle(document.querySelector('.pp-ghost')).display !== 'none'")
    lead = page.inner_text("#clueBody")
    # 조각 하나를 해답이 아닌 판 자리에 놓는다(판 안·겹침 없는 자리 중 해답 아닌 곳)
    wrong_drop = """() => { const s = __pp.state; const P = __pp.puzzle; const pc = s.pieces[0];
        const sol = P.solutions[0].find((r) => r.id === pc.id);
        for (let dy = -2; dy < 8; dy++) for (let dx = -2; dx < 8; dx++) {
          if (dx === sol.dx && dy === sol.dy) continue;
          if (__pp.canPlace(P.board, [], __pp.translate(pc.tris, dx, dy))) { __pp.dispatch({type: 'drop', id: pc.id, at: [dx, dy]}); return [dx, dy]; } }
        return null; }"""
    spot1 = page.evaluate(wrong_drop)
    page.wait_for_timeout(200)
    red1 = page.evaluate("[__pp.wrong.length, __pp.wrongPolys()]")
    shot(page, "stage1-red")
    set_stage(page, 2, "s2-001")
    ghost2_on = page.evaluate("getComputedStyle(document.querySelector('.pp-ghost')).display !== 'none'")
    outline = page.evaluate("document.querySelectorAll('#clueBody svg.mini-board path').length")
    spot2 = page.evaluate(wrong_drop)
    page.wait_for_timeout(200)
    red2 = page.evaluate("[__pp.wrong.length, __pp.wrongPolys()]")
    set_stage(page, 3, "s3-001")
    conds = page.evaluate("""() => [...document.querySelectorAll('#clueBody .cond')].map((c) =>
        [c.dataset.piece, c.querySelector('svg path') !== null, c.querySelector('.cond-t').textContent])""")
    want = page.evaluate("__pp.puzzle.cards")
    text_of = {"flip": "이 조각은 뒤집어야 맞아요", "turn": "이 조각은 돌려야 맞아요", "flipturn": "이 조각은 뒤집고 돌려야 맞아요"}
    conds_ok = sorted(conds) == sorted([[k, True, text_of[v]] for k, v in want.items()])
    shot(page, "stage3-cards")
    check("stage_clues_and_red_marks",
          ghost1 == 3 and ghost1_on and "빛나는 모양" in lead and spot1 and red1[0] > 0 and red1[1] == red1[0]
          and not ghost2_on and outline >= 1 and spot2 and red2 == [0, 0] and conds_ok and not errors,
          f"ghost1={ghost1}/{ghost1_on} lead={lead!r} red1={red1} ghost2={ghost2_on} outline={outline} red2={red2} "
          f"conds={conds} want={want} errors={errors[:2]}")
    ctx.close()


def hidden_drop_next_to_board_keeps_queue(browser, base):
    """숨김 모드: 손가락 점이 판 밖이면(조각 사각형이 판에 걸쳐도) 드러내지 않는다 — 줄·모양 그대로 트레이로."""
    ctx, page, errors = open_game(browser, base)
    set_stage(page, 3, "s3-001")
    pid = page.evaluate("__pp.state.pieces[1].id")  # 칸 5개 F5: 넓다
    page.evaluate("(id) => __pp.dispatch({type: 'move', id, move: 'cw90'})", pid)
    before = page.evaluate("(id) => __pp.state.pieces.find((q) => q.id === id)", pid)
    g = page.evaluate("__pp.g")
    # 조각의 가장 왼쪽 사분을 잡고, 손가락을 판 금테 왼쪽 바로 바깥에 놓는다 → 조각은 오른쪽으로 판에 걸친다
    left = min(before["tris"], key=lambda t: (t[0], 0 if t[2] == 3 else 1))
    a = page.evaluate("([id, t]) => __pp.pieceScreenXY(id, t)", [pid, left])
    tgt = page.evaluate("(p) => __pp.stageToClient(p)", [g["outer"]["l"] - 0.25 * g["S"], (g["outer"]["t"] + g["outer"]["b"]) / 2])
    page.mouse.move(a["x"], a["y"])
    page.mouse.down()
    page.mouse.move(tgt["x"], tgt["y"], steps=14)
    rect_over = page.evaluate("""(id) => { const n = document.querySelector(`.pp-piece[data-id="${id}"]`).getBoundingClientRect();
        const o = __pp.g.outer; const s = __pp.stageToClient([o.l, o.t]); return n.right > s.x + 4; }""", pid)
    page.mouse.up()
    page.wait_for_function("!__pp.busy", timeout=8000)
    page.wait_for_timeout(100)
    after = page.evaluate("(id) => __pp.state.pieces.find((q) => q.id === id)", pid)
    shot(page, "hidden-next-to-board")
    check("hidden_drop_next_to_board_keeps_queue",
          rect_over and after["queue"] == ["cw90"] and after["at"] is None and after["tris"] == before["tris"]
          and page.evaluate("__pp.consistent()") == [] and not errors,
          f"rect_over={rect_over} queue={after['queue']} at={after['at']} same_shape={after['tris'] == before['tris']} errors={errors[:2]}")
    ctx.close()


def skip_lowers_streak(browser, base):
    ctx, page, errors = open_game(browser, base)
    page.evaluate("__pp.setProgress({streak: 3})")
    s0 = game(page)
    page.click("[data-tool=skip]")
    page.wait_for_timeout(400)
    s1 = game(page)
    combo = page.inner_text("#comboText")
    check("skip_lowers_streak",
          s0["streak"] == 3 and s1["streak"] == 2 and combo.startswith("2연속") and s1["puzzleId"] != s0["puzzleId"]
          and s1["score"] == s0["score"] and not errors,
          f"streak={s0['streak']}->{s1['streak']} combo={combo!r} ids={s0['puzzleId']}->{s1['puzzleId']} errors={errors[:2]}")
    ctx.close()


def no_immediate_repeat(browser, base):
    """단계마다 무작위 순서, 바로 전에 낸 문제를 다시 내지 않는다(최근 10개 제외)."""
    ctx, page, errors = open_game(browser, base)
    ids = [game(page)["puzzleId"]]
    for _ in range(12):
        page.click("[data-tool=skip]")
        page.wait_for_function("(a) => __pp.game().puzzleId !== a", arg=ids[-1], timeout=5000)
        ids.append(game(page)["puzzleId"])
    window_ok = all(ids[i] not in ids[max(0, i - 10):i] for i in range(len(ids)))
    check("no_immediate_repeat", window_ok and all(i.startswith("s1-") for i in ids) and not errors, f"ids={ids}")
    ctx.close()


def restart_puts_pieces_back(browser, base):
    ctx, page, errors = open_game(browser, base)
    start = page.evaluate("JSON.stringify(__pp.state.pieces.map((p) => [p.tris, p.pos]))")
    pid = page.evaluate("__pp.state.pieces[0].id")
    page.evaluate("(id) => __pp.dispatch({type: 'move', id, move: 'cw90'})", pid)
    moved = page.evaluate("JSON.stringify(__pp.state.pieces.map((p) => [p.tris, p.pos]))")
    page.click("[data-tool=restart]")
    page.wait_for_timeout(300)
    back = page.evaluate("JSON.stringify(__pp.state.pieces.map((p) => [p.tris, p.pos]))")
    check("restart_puts_pieces_back", moved != start and back == start and page.evaluate("__pp.moves") == 0 and not errors,
          f"moved={moved != start} back={back == start} errors={errors[:2]}")
    ctx.close()


def help_keeps_puzzle(browser, base):
    ctx, page, errors = open_game(browser, base)
    before = page.evaluate("JSON.stringify({id: __pp.game().attemptId, p: __pp.state.pieces.map((p) => [p.tris, p.pos])})")
    page.click("[data-tool=help]")
    page.wait_for_timeout(300)
    tut = visible(page, "#screen-tutorial")
    e0 = game(page)
    page.wait_for_timeout(1500)
    e1 = game(page)
    page.click("#tutDone")
    page.wait_for_timeout(1000)
    e2 = game(page)
    after = page.evaluate("JSON.stringify({id: __pp.game().attemptId, p: __pp.state.pieces.map((p) => [p.tris, p.pos])})")
    paused_ok = e0["paused"] and e1["paused"] and abs(e1["elapsed"] - e0["elapsed"]) < 0.01
    resumed_ok = not e2["paused"] and 0.7 < e2["elapsed"] - e1["elapsed"] < 2.0
    check("help_keeps_puzzle", tut and before == after and visible(page, "#screen-game") and not errors,
          f"tut={tut} same={before == after} errors={errors[:2]}")
    check("help_pauses_timer", paused_ok and resumed_ok,
          f"elapsed {e0['elapsed']:.2f} -> {e1['elapsed']:.2f} (paused) -> {e2['elapsed']:.2f}")
    ctx.close()


def portrait_pauses_timer(browser, base):
    ctx, page, errors = open_game(browser, base)
    page.set_viewport_size({"width": 600, "height": 900})
    page.wait_for_timeout(300)
    e0 = game(page)
    hint = visible(page, "#rotateHint")
    page.wait_for_timeout(1200)
    e1 = game(page)
    page.set_viewport_size(VIEW)
    page.wait_for_timeout(1000)
    e2 = game(page)
    ok = (hint and e0["paused"] and "portrait" in e0["pauseReasons"] and abs(e1["elapsed"] - e0["elapsed"]) < 0.01
          and not e2["paused"] and 0.7 < e2["elapsed"] - e1["elapsed"] < 2.0)
    check("portrait_pauses_timer", ok and not errors,
          f"hint={hint} elapsed {e0['elapsed']:.2f} -> {e1['elapsed']:.2f} -> {e2['elapsed']:.2f} reasons={e0['pauseReasons']} errors={errors[:2]}")
    ctx.close()


def resize_refits(browser, base):
    """창 크기가 바뀌면 다시 맞춘다(refit): 칸 크기가 바뀌고, 조각은 무대·트레이 안, 판 조각은 판 위 그대로, UI 아래 조각 없음."""
    ctx, page, errors = open_game(browser, base)
    set_stage(page, 4, "s4-002")
    pid = page.evaluate("__pp.state.pieces[0].id")
    page.evaluate("""(id) => { const r = __pp.puzzle.solutions[0].find((q) => q.id === id);
        const s = __pp.state; const pc = s.pieces.find((q) => q.id === id);
        const start = __pp.normalize(__pp.puzzle.pieces.find((q) => q.id === id).start);
        const m = __pp.L.elemMarked(start, [...start[0], 0], r.elem);
        pc.tris = m.tris; pc.mark = m.mark; pc.pos = [r.dx, r.dy]; pc.at = [r.dx, r.dy]; __pp.setState(s); }""", pid)
    s0 = page.evaluate("__pp.g.S")
    on0 = page.evaluate("(id) => __pp.state.pieces.find((q) => q.id === id).at", pid)
    page.set_viewport_size({"width": 1024, "height": 768})
    page.wait_for_timeout(600)
    s1 = page.evaluate("__pp.g.S")
    on1 = page.evaluate("(id) => __pp.state.pieces.find((q) => q.id === id).at", pid)
    cons = page.evaluate("__pp.consistent()")
    covered = page.evaluate("__pp.covered()")
    shot(page, "resized-1024")
    page.set_viewport_size(VIEW)
    page.wait_for_timeout(600)
    cons2 = page.evaluate("__pp.consistent()")
    covered2 = page.evaluate("__pp.covered()")
    check("resize_refits", s1 < s0 and on0 == on1 and cons == [] and covered == [] and cons2 == [] and covered2 == []
          and not errors, f"S {s0}->{s1} at {on0}->{on1} cons={cons} covered={covered[:3]} cons2={cons2} covered2={covered2[:3]} errors={errors[:2]}")
    ctx.close()


def load_failure_retry(browser, base):
    """문제 은행을 한 번 못 받으면 안내 카드가 뜨고, 다시 불러오기로 이어서 할 수 있다."""
    fails = {"n": 0}

    def setup(page):
        def handler(route):
            if fails["n"] == 0:
                fails["n"] += 1
                route.fulfill(status=503, body="busy")
            else:
                route.continue_()
        page.route("**/data/puzzles-s1.json", handler)

    ctx, page, errors = open_game(browser, base, setup=setup, wait_puzzle=False)
    page.wait_for_function("() => __pp.game().loadFailed", timeout=8000)
    card = visible(page, "#loadFail")
    text = page.inner_text("#loadFail")
    shot(page, "load-fail")
    s0 = game(page)
    page.click("#loadFail [data-tool=retry]")
    page.wait_for_function("() => __pp.game().puzzleId", timeout=8000)
    page.wait_for_timeout(200)
    s1 = game(page)
    card_after = visible(page, "#loadFail")
    errors = [e for e in errors if "503" not in e]
    check("load_failure_retry",
          card and "문제를 불러오지 못했어요" in text and s0["puzzleId"] is None and bool(s1["puzzleId"])
          and not s1["loadFailed"] and not card_after and fails["n"] == 1 and not errors,
          f"card={card} id={s0['puzzleId']}->{s1['puzzleId']} card_after={card_after} fails={fails['n']} errors={errors[:2]}")
    ctx.close()


def win_focuses_next(browser, base):
    ctx, page, errors = open_game(browser, base)
    page.evaluate("__pp.solveCurrent()")
    page.wait_for_function("() => __pp.game().screen === 'win'", timeout=5000)
    page.wait_for_timeout(300)
    focused = page.evaluate("() => document.activeElement && document.activeElement.id")
    check("win_focuses_next", focused == "nextBtn" and not errors, f"focused={focused} errors={errors[:2]}")
    ctx.close()


def best_survives_reload(browser, base):
    """새로고침 뒤에도 최고 점수·푼 문제 수가 남는다(pp. 접두사 localStorage)."""
    ctx, page, errors = open_game(browser, base)
    page.evaluate("__pp.elapsed(70)")
    page.evaluate("__pp.solveCurrent()")
    page.wait_for_function("() => __pp.game().screen === 'win'", timeout=5000)
    keys = page.evaluate("Object.keys(localStorage).sort()")
    page.reload()
    page.wait_for_function("() => window.__ppReady === true", timeout=15000)
    page.evaluate("document.fonts.ready")
    best = page.inner_text("#bestText")
    g = game(page)
    check("best_survives_reload", "100점" in best and g["best"] == 100 and g["solvedTotal"] == 1
          and all(k.startswith("pp.") for k in keys) and "pp.best" in keys and not errors,
          f"best={best!r} g={g['best']}/{g['solvedTotal']} keys={keys} errors={errors[:2]}")
    ctx.close()


def easy_space_reserved(browser, base):
    """시작 배치가 피하는 단서 카드 영역에 쉬운 단서 버튼과 쉬운 단서 내용 높이가 미리 들어간다(조각을 덮지 않는다)."""
    ctx, page, errors = open_game(browser, base)
    bad = []
    for stage, pid in ((2, "s2-003"), (3, "s3-002"), (4, "s4-003")):
        set_stage(page, stage, pid)
        reserved = page.evaluate("__pp.ui.find((r) => r.name === 'clue')")
        page.evaluate("__pp.elapsed(70)")
        page.wait_for_function("() => !document.querySelector('#easyBtn').hidden", timeout=3000)
        shown = page.evaluate("__pp.uiRects().find((r) => r.name === 'clue')")
        page.click("#easyBtn")
        page.wait_for_timeout(250)
        easy = page.evaluate("__pp.uiRects().find((r) => r.name === 'clue')")
        covered = page.evaluate("__pp.covered()")
        for nm, r in (("shown", shown), ("easy", easy)):
            if r["b"] > reserved["b"] + 1 or r["t"] < reserved["t"] - 1:
                bad.append((stage, nm, reserved, r))
        if covered:
            bad.append((stage, "covered", covered[:2]))
    check("easy_space_reserved", not bad and not errors, f"bad={bad} errors={errors[:2]}")
    ctx.close()


def drag_then_skip_is_safe(browser, base):
    """터치로 조각을 끄는 중에 건너뛰기 → 남은 이동·떼기가 새 문제를 망가뜨리지 않는다."""
    ctx, page, errors = open_game(browser, base, ctx_opts={"has_touch": True})
    cdp = ctx.new_cdp_session(page)
    s0 = game(page)
    pid = page.evaluate("__pp.state.pieces[0].id")
    p = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
    x, y = p["x"], p["y"]

    def touch(kind, pts):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": px, "y": py, "id": 0} for (px, py) in pts]})

    touch("touchStart", [(x, y)])
    for k in range(1, 6):
        touch("touchMove", [(x + 12 * k, y)])
        page.wait_for_timeout(16)
    page.evaluate("() => document.querySelector('[data-tool=skip]').click()")
    page.wait_for_function("(a) => __pp.game().attemptId !== a", arg=s0["attemptId"], timeout=5000)
    snap = page.evaluate("JSON.stringify(__pp.state)")
    for k in range(6, 14):
        touch("touchMove", [(x + 12 * k, y + 4 * k)])
        page.wait_for_timeout(16)
    touch("touchEnd", [])
    page.wait_for_timeout(400)
    after = page.evaluate("JSON.stringify(__pp.state)")
    cons = page.evaluate("__pp.consistent()")
    panel = page.evaluate("__pp.panelState().open")
    check("drag_then_skip_is_safe", snap == after and cons == [] and not panel and not errors,
          f"intact={snap == after} cons={cons} panel={panel} errors={errors[:2]}")
    ctx.close()


TESTS = (solve_shows_win_and_scores, promote_through_stage4, stage4_min_moves_star, easy_hint_after_60s,
         easy_turns_preview_on, hidden_pending_queue_not_solved, all_on_board_wrong_shakes, stage_clues_and_red_marks,
         hidden_drop_next_to_board_keeps_queue, skip_lowers_streak, no_immediate_repeat, restart_puts_pieces_back,
         help_keeps_puzzle, portrait_pauses_timer, resize_refits, load_failure_retry, win_focuses_next,
         best_survives_reload, easy_space_reserved, drag_then_skip_is_safe)


def main():
    server = None
    base = BASE_ARG
    if base is None:
        server = start_server()
        base = f"http://127.0.0.1:{PORT}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            try:
                for fn in TESTS:
                    if ONLY and not any(o in fn.__name__ for o in ONLY):
                        continue
                    try:
                        fn(browser, base)
                    except Exception as e:  # 한 시험이 죽어도 나머지는 돈다
                        check(fn.__name__, False, f"error: {str(e).splitlines()[0][:300]}")
                        for c in list(browser.contexts):
                            c.close()
            finally:
                browser.close()
    finally:
        if server:
            server.terminate()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
