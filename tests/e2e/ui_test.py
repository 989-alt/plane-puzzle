"""Task 7 화면 UI(시작·안내·게임 HUD·단서 카드·정답·세로 안내) e2e. 큐브 왕국 tests/e2e/ui_test.py 이식.
Playwright + 시스템 Edge(channel="msedge").

  python tests/e2e/ui_test.py [base_url] [시험 이름 일부 ...]
  python tests/e2e/ui_test.py --dump-rects     # tests/ui-rects.json(실제 CSS 화면 UI 사각형, 단위 시험이 씀)을 다시 만든다

base_url 을 주지 않으면 저장소 루트에서 http.server(8769)를 직접 띄우고 끝나면 닫는다. 이 PC는 8GB: e2e는 한 번에 하나씩.
화면 캡처는 tests/e2e/out/ui-*.png 로 남긴다(사람이 눈으로 확인).

시험 훅: index.html?e2e 이면 window.__ppUi(showScreen, showWin, renderHud, showBubble, setEasyAvailable, openTutorial)와
window.__pp(게임 흐름·조각 상태, flow_test.py 참고)를 연다.
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
RECTS = os.path.join(ROOT, "tests", "ui-rects.json")
PORT = 8769
SIZES = ({"width": 1280, "height": 800}, {"width": 1024, "height": 768})
ARGS = sys.argv[1:]
BASE_ARG = next((a for a in ARGS if a.startswith("http")), None)
DUMP = "--dump-rects" in ARGS
ONLY = [a for a in ARGS if not a.startswith("http") and not a.startswith("--")]

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)


def start_server():
    return serve.start(ROOT, PORT)


def ready(page):
    page.wait_for_function("() => window.__ppReady === true", timeout=15000)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(150)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"ui-{name}.png"))


def visible(page, sel):
    return page.locator(sel).first.is_visible()


def new_page(browser, view, **opts):
    ctx = browser.new_context(viewport=view, **opts)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    return ctx, page, errors


def into_game(page, base):
    page.goto(f"{base}/index.html?e2e")
    page.evaluate("() => { localStorage.clear(); localStorage.setItem('pp.tutorialSeen', 'true'); }")
    page.reload()
    ready(page)
    page.click("#startBtn")
    page.wait_for_function("() => __pp.game().screen === 'game' && __pp.game().puzzleId", timeout=15000)
    page.wait_for_timeout(250)


def set_stage(page, stage, pid):
    page.evaluate(f"__pp.setProgress({{stage: {stage}}})")
    page.evaluate(f"__pp.setPuzzle('{pid}')")
    page.wait_for_timeout(120)


# ---------- 시험 ----------

def title_to_tutorial_first_visit(browser, base):
    ctx, page, errors = new_page(browser, SIZES[0])
    page.goto(f"{base}/index.html")
    page.evaluate("() => localStorage.clear()")
    page.reload()
    ready(page)
    chip = page.inner_text(".t-chip-l")
    logo = page.inner_text(".logo")
    page.click("#startBtn")
    page.wait_for_timeout(300)
    first = visible(page, "#screen-tutorial")
    heads = page.evaluate("[...document.querySelectorAll('#screen-tutorial .panel .hd')].map((e) => e.textContent.trim())")
    imgs = page.evaluate("[...document.querySelectorAll('#screen-tutorial .panel img')].map((e) => e.getAttribute('src'))")
    page.click("label.dont")
    checked = page.is_checked("#dontShow")
    page.click("#tutDone")
    page.wait_for_timeout(300)
    in_game = visible(page, "#screen-game")
    seen = page.evaluate("localStorage.getItem('pp.tutorialSeen')")
    page.reload()
    ready(page)
    page.click("#startBtn")
    page.wait_for_timeout(300)
    second_tut = visible(page, "#screen-tutorial")
    second_game = visible(page, "#screen-game")
    page.click("[data-tool=help]")
    page.wait_for_timeout(300)
    help_tut = visible(page, "#screen-tutorial")
    help_label = page.evaluate("document.querySelector('[data-tool=help]').getAttribute('aria-label')")
    focused = page.evaluate("() => document.activeElement?.id")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    esc_closed = not visible(page, "#screen-tutorial") and visible(page, "#screen-game")
    check("title_to_tutorial_first_visit",
          chip == "한 판! 돌리고 뒤집기" and "한 판!" in logo and "돌리고 뒤집기" in logo and first
          and heads == ["1. 밀기", "2. 뒤집기", "3. 돌리기"]
          and imgs == ["assets/img/tut-move.webp", "assets/img/tut-flip.webp", "assets/img/tut-turn.webp"]
          and checked and in_game and seen == "true" and not second_tut and second_game and help_tut
          and help_label == "도움말" and not errors,
          f"chip={chip!r} logo={logo!r} first={first} heads={heads} imgs={imgs} game={in_game} seen={seen} "
          f"second_tut={second_tut} second_game={second_game} help={help_tut} errors={errors[:2]}")
    check("tutorial_focus_and_escape", focused == "tutDone" and esc_closed, f"focused={focused} esc_closed={esc_closed}")
    ctx.close()


def tutorial_input_kind(browser, base):
    kinds = {}
    for label, opts in (("touch", {"has_touch": True, "is_mobile": True}), ("mouse", {})):
        ctx, page, errors = new_page(browser, SIZES[0], **opts)
        page.goto(f"{base}/index.html")
        page.evaluate("() => localStorage.clear()")
        page.reload()
        ready(page)
        page.click("#startBtn") if label == "mouse" else page.tap("#startBtn")
        page.wait_for_timeout(400)
        on = page.evaluate("() => document.querySelector('.seg [aria-pressed=true]')?.dataset.kind")
        text = page.inner_text("#screen-tutorial .panels").replace("\n", " ")
        kinds[label] = (on, text)
        shot(page, f"tutorial-{label}")
        other = "mouse" if label == "touch" else "touch"
        page.click(f".seg [data-kind={other}]")
        page.wait_for_timeout(100)
        kinds[label + "-toggled"] = page.inner_text("#screen-tutorial .panels")
        ctx.close()
    touch_ok = kinds["touch"][0] == "touch" and "손가락으로 끌어" in kinds["touch"][1] and "톡 누르면" in kinds["touch"][1]
    mouse_ok = kinds["mouse"][0] == "mouse" and "마우스로 끌어" in kinds["mouse"][1] and "클릭하면" in kinds["mouse"][1]
    terms = all(t in kinds["mouse"][1] for t in ("위쪽", "아래쪽", "왼쪽", "오른쪽", "시계 방향", "시계 반대 방향"))
    toggle_ok = "마우스" in kinds["touch-toggled"] and "손가락" in kinds["mouse-toggled"]
    check("tutorial_input_kind", touch_ok and mouse_ok and toggle_ok and terms,
          f"touch={kinds['touch']} mouse={kinds['mouse']} toggle={toggle_ok} terms={terms}")


OVERFLOW_JS = """() => {
  const card = document.querySelector('#clueCard').getBoundingClientRect();
  const kids = [...document.querySelectorAll('#clueCard .clue-body *, #clueCard .lvl, #clueCard h3')]
    .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  let out = 0;
  for (const r of kids) if (r.left < card.left - 0.5 || r.right > card.right + 0.5 || r.top < card.top - 0.5 || r.bottom > card.bottom + 0.5) out++;
  const tools = document.querySelector('.tools').getBoundingClientRect();
  return { n: kids.length, out, cardBottom: card.bottom, toolsTop: tools.top };
}"""


def ids_of(page, stage):
    return page.evaluate(f"async () => (await (await fetch('data/puzzles-s{stage}.json')).json()).map((p) => p.id)")


def every_puzzle_layout(browser, base):
    """모든 문제(160)·두 화면 크기: 단서 카드 내용이 카드 안·도구 막대 위, 시작 배치가 실제 화면 UI에 가려지지 않고
    (covered = []), 트레이·판 상태가 바르며, 실제 UI 사각형이 tests/ui-rects.json(단위 시험이 쓰는 값) 안에 든다."""
    fixture = json.load(open(RECTS, encoding="utf-8")) if os.path.exists(RECTS) else None
    dump = {}
    bad = []
    smallest = {}
    for view in SIZES:
        ctx, page, errors = new_page(browser, view)
        into_game(page, base)
        key = f"{view['width']}x{view['height']}"
        dump[key] = {}
        for stage in (1, 2, 3, 4):
            env = None
            for pid in ids_of(page, stage):
                set_stage(page, stage, pid)
                ui = page.evaluate("__pp.ui")
                r = page.evaluate(OVERFLOW_JS)
                if r["n"] == 0 or r["out"] or r["cardBottom"] > r["toolsTop"]:
                    bad.append((key, pid, "clue", r))
                cov = page.evaluate("__pp.covered()")
                cons = page.evaluate("__pp.consistent()")
                if cov or cons:
                    bad.append((key, pid, "layout", cov[:2], cons[:2]))
                S = page.evaluate("__pp.g.S")
                smallest[key] = min(smallest.get(key, 999), S)
                env = ui if env is None else [
                    {"name": a["name"], "l": min(a["l"], b["l"]), "t": min(a["t"], b["t"]), "r": max(a["r"], b["r"]), "b": max(a["b"], b["b"])}
                    for a, b in zip(env, ui)]
                if fixture and not DUMP:
                    fx = {f["name"]: f for f in fixture[key][str(stage)]}
                    for u in ui:
                        f = fx.get(u["name"])
                        if not f or u["l"] < f["l"] - 0.5 or u["t"] < f["t"] - 0.5 or u["r"] > f["r"] + 0.5 or u["b"] > f["b"] + 0.5:
                            bad.append((key, pid, "outside fixture", u["name"], u, f))
            dump[key][str(stage)] = [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in e.items()} for e in env]
        if errors:
            bad.append((key, "errors", errors[:2]))
        ctx.close()
    if DUMP:
        with open(RECTS, "w", encoding="utf-8") as f:
            json.dump({"note": "실제 CSS 화면 UI 사각형(무대 px, 단계별 모든 문제의 합). python tests/e2e/ui_test.py --dump-rects 로 만든다.",
                       **dump}, f, ensure_ascii=False, indent=1)
        print(f"wrote {RECTS}")
    check("every_puzzle_layout", not bad and (fixture is not None or DUMP) and smallest.get("1024x768", 0) >= 40,
          f"bad={len(bad)} {bad[:3]} smallest_S={smallest} fixture={'yes' if fixture else 'no'}")


def stage_screens(browser, base):
    """단계별 게임 화면 캡처(두 크기): HUD·단서 카드·도구 막대가 무대 안, 서로 겹치지 않음."""
    bad = []
    for view in SIZES:
        ctx, page, errors = new_page(browser, view)
        into_game(page, base)
        w = view["width"]
        for stage, pid in ((1, "s1-001"), (2, "s2-001"), (3, "s3-001"), (4, "s4-001")):
            set_stage(page, stage, pid)
            page.evaluate("__ppUi.renderHud({stage: %d, streak: 4, mult: 2, score: 1240, yard: 1, toNext: 3})" % stage)
            page.wait_for_timeout(150)
            shot(page, f"game-s{stage}-{w}")
            ov = page.evaluate("""() => { const st = document.getElementById('stage').getBoundingClientRect();
                const els = ['.hud', '#yardBadge', '.mission', '.score', '#clueCard', '.tools'].map((s) => [s, document.querySelector(s).getBoundingClientRect()]);
                const out = [];
                for (const [s, r] of els) if (r.left < st.left - 0.5 || r.top < st.top - 0.5 || r.right > st.right + 0.5 || r.bottom > st.bottom + 0.5) out.push('off ' + s);
                for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i][1], b = els[j][1];
                  if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(els[i][0] + ' x ' + els[j][0]); }
                return out; }""")
            if ov:
                bad.append((w, stage, ov))
            if stage >= 3:
                # 실제 게임 화면에서 조각을 눌러 패널: 조각·화면 UI를 덮지 않는다
                pid = page.evaluate("__pp.state.pieces[0].id")
                p = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
                page.mouse.click(p["x"], p["y"])
                page.wait_for_timeout(250)
                shot(page, f"game-s{stage}-panel-{w}")
                pr = page.evaluate("__pp.panelRect()")
                cov = page.evaluate("__pp.covered()")
                hits = page.evaluate("""(pr) => { const st = document.getElementById('stage').getBoundingClientRect();
                    return [...document.querySelectorAll('#stage [data-ui]')].filter((e) => !e.hidden && e.dataset.ui !== 'bubble').map((e) => [e.dataset.ui, e.getBoundingClientRect()])
                      .filter(([, r]) => r.left < pr.x + pr.width && pr.x < r.right && r.top < pr.y + pr.height && pr.y < r.bottom).map(([n]) => n); }""", pr)
                if not pr or cov or hits:
                    bad.append((w, stage, "panel", pr, cov[:2], hits))
                page.keyboard.press("Escape")
        page.evaluate("__pp.elapsed(70)")
        page.wait_for_timeout(1100)
        page.evaluate("__ppUi.showBubble('카드에 남은 이동이 있어요. 조각을 다시 놓아 보세요', 4000)")
        page.wait_for_timeout(400)
        shot(page, f"game-bubble-easy-{w}")
        bub = page.evaluate("""() => { const b = document.querySelector('#bubble .bubble-in').getBoundingClientRect();
            const st = document.getElementById('stage').getBoundingClientRect(); return b.left >= st.left && b.right <= st.right && b.top >= st.top; }""")
        if not bub:
            bad.append((w, "bubble off stage"))
        if errors:
            bad.append((w, errors[:2]))
        ctx.close()
    check("stage_screens", not bad, f"bad={bad}")


def portrait_warning(browser, base):
    ctx, page, errors = new_page(browser, {"width": 600, "height": 900})
    page.goto(f"{base}/index.html")
    ready(page)
    portrait = visible(page, "#rotateHint")
    text = page.inner_text("#rotateHint") if portrait else ""
    shot(page, "portrait")
    page.set_viewport_size({"width": 1200, "height": 750})
    page.wait_for_timeout(200)
    landscape = visible(page, "#rotateHint")
    check("portrait_warning", portrait and "가로로 돌려 주세요" in text and not landscape,
          f"portrait={portrait} text={text!r} landscape={landscape}")
    ctx.close()


SMALL_JS = """() => [...document.querySelectorAll('button, label.dont')].filter((b) => {
  const r = b.getBoundingClientRect(); const s = getComputedStyle(b);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && b.closest('.screen.on, #pp-panel.on');
}).map((b) => { const r = b.getBoundingClientRect();
  return { id: b.id || b.dataset.tool || b.dataset.kind || b.dataset.move || b.textContent.trim(), w: r.width, h: r.height }; })
  .filter((x) => x.w < 48 || x.h < 48)"""


def buttons_min_48px(browser, base):
    small = []
    for view in SIZES:
        ctx, page, errors = new_page(browser, view)
        page.goto(f"{base}/index.html?e2e")
        ready(page)
        for s in page.evaluate(SMALL_JS):
            small.append((view["width"], "title", s))
        page.evaluate("__ppUi.openTutorial({mode: 'start'})")
        page.wait_for_timeout(300)
        for s in page.evaluate(SMALL_JS):
            small.append((view["width"], "tutorial", s))
        page.evaluate("() => localStorage.setItem('pp.tutorialSeen', 'true')")
        page.reload()
        ready(page)
        page.click("#startBtn")
        page.wait_for_function("() => __pp.game().puzzleId", timeout=15000)
        set_stage(page, 3, "s3-001")
        page.evaluate("__pp.elapsed(70)")
        page.wait_for_timeout(1100)
        pid = page.evaluate("__pp.state.pieces[0].id")
        p = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
        page.mouse.click(p["x"], p["y"])
        page.wait_for_timeout(200)
        for s in page.evaluate(SMALL_JS):
            small.append((view["width"], "game", s))
        page.evaluate("""() => __ppUi.showWin({gained: 318, base: 100, speed: 34, streak: 4, mult: 2, usedEasy: false,
            bonus: 100, yardBefore: 1, yardAfter: 2, nextHint: '다음: 4단계 · 최소 이동'})""")
        page.wait_for_timeout(300)
        for s in page.evaluate(SMALL_JS):
            small.append((view["width"], "win", s))
        ctx.close()
    check("buttons_min_48px", not small, f"small={small[:6]}")


def no_zoom_or_callout(browser, base):
    """Review Focus 5: 연속 탭(더블탭)·길게 누르기·끌기 뒤에도 확대·스크롤·문맥 메뉴·글자 선택이 없다."""
    ctx, page, errors = new_page(browser, SIZES[1], has_touch=True, is_mobile=True)
    into_game(page, base)
    cdp = ctx.new_cdp_session(page)
    page.evaluate("""() => { window.__menus = 0; document.addEventListener('contextmenu', (e) => { if (!e.defaultPrevented) window.__menus++; }); }""")

    def touch(kind, pts):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})

    meta = page.evaluate("document.querySelector('meta[name=viewport]').content")
    # -webkit-touch-callout 은 iOS 사파리 속성이라 Chromium 계산 스타일에 없다 → base.css 의 html,body 규칙 글을 본다.
    css = page.evaluate("""async () => { const s = getComputedStyle(document.body); const st = getComputedStyle(document.getElementById('stage'));
        const txt = await (await fetch('styles/base.css')).text();
        const rule = (/html,body\\{[^}]*\\}/.exec(txt) || [''])[0];
        return [s.touchAction, s.userSelect || s.webkitUserSelect, /-webkit-touch-callout:none/.test(rule) ? 'none' : 'missing', st.touchAction]; }""")
    pid = page.evaluate("__pp.state.pieces[0].id")
    p = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
    spots = [(p["x"], p["y"]), (512, 300), (40, 700), (900, 60)]
    for (x, y) in spots:
        for _ in range(2):  # 더블탭
            touch("touchStart", [(x, y)])
            touch("touchEnd", [])
            page.wait_for_timeout(60)
        page.wait_for_timeout(350)
        touch("touchStart", [(x, y)])  # 길게 누르기
        page.wait_for_timeout(900)
        touch("touchEnd", [])
        page.wait_for_timeout(200)
    # 빈 곳 끌기(스크롤 시도)·두 손가락 벌리기(확대 시도)
    touch("touchStart", [(512, 600)])
    for k in range(1, 10):
        touch("touchMove", [(512, 600 - 40 * k)])
        page.wait_for_timeout(16)
    touch("touchEnd", [])
    touch("touchStart", [(480, 380), (540, 380)])
    for k in range(1, 10):
        touch("touchMove", [(480 - 20 * k, 380), (540 + 20 * k, 380)])
        page.wait_for_timeout(16)
    touch("touchEnd", [])
    page.wait_for_timeout(400)
    st = page.evaluate("""() => ({ scale: window.visualViewport ? window.visualViewport.scale : 1, sx: window.scrollX, sy: window.scrollY,
        vx: window.visualViewport ? window.visualViewport.offsetLeft : 0, vy: window.visualViewport ? window.visualViewport.offsetTop : 0,
        sel: String(window.getSelection()), menus: window.__menus,
        de: [document.documentElement.scrollLeft, document.documentElement.scrollTop] })""")
    shot(page, "after-taps")
    # 쉬운 단서 버튼을 누르면(초점이 가며) 화면 상자가 코드로 스크롤되어 무대 전체가 밀리면 안 된다.
    set_stage(page, 2, "s2-001")
    page.evaluate("__pp.elapsed(70)")
    page.wait_for_selector("#easyBtn:not([hidden])", timeout=4000)
    page.click("#easyBtn")
    page.wait_for_timeout(300)
    # 화면 상자는 스크롤 상자가 아니어야 한다(overflow:clip): 흐린 배경(scale 1.08)이 51×32px 넘쳐도 코드 스크롤·초점 이동으로 밀리지 않음
    sc = page.evaluate("""() => { document.querySelector('#easyBtn').scrollIntoView(); document.querySelector('[data-tool=skip]').focus();
        return ['#app', '#screen-game', '#stage'].map((q) => { const e = document.querySelector(q); e.scrollTo(200, 200);
          return [e.scrollLeft, e.scrollTop]; }); }""")
    shot(page, "easy-clicked")
    st["box_scroll"] = sc
    check("no_zoom_or_callout",
          "user-scalable=no" in meta and css[0] == "none" and css[1] == "none" and css[2] == "none" and css[3] == "none"
          and st["scale"] == 1 and st["sx"] == 0 and st["sy"] == 0 and st["vx"] == 0 and st["vy"] == 0
          and st["sel"] == "" and st["menus"] == 0 and st["de"] == [0, 0] and sc == [[0, 0]] * 3 and not errors,
          f"meta={meta!r} css={css} state={st} errors={errors[:2]}")
    ctx.close()


def screens_shots(browser, base):
    """시작·안내·정답 화면 캡처(두 크기), 정답 화면 별·연속·쉬운 단서 칩, 줄인 움직임에서 색종이 없음."""
    info = []
    for view in SIZES:
        w = view["width"]
        ctx, page, errors = new_page(browser, view)
        page.goto(f"{base}/index.html?e2e")
        page.evaluate("() => localStorage.clear()")
        page.reload()
        ready(page)
        shot(page, f"title-{w}")
        page.evaluate("__ppUi.openTutorial({inputKind: 'touch', mode: 'start'})")
        page.wait_for_timeout(400)
        shot(page, f"tutorial-{w}")
        page.evaluate("""() => __ppUi.showWin({gained: 318, base: 100, speed: 34, streak: 4, mult: 2, usedEasy: false,
            bonus: 100, yardBefore: 1, yardAfter: 2, nextHint: '다음: 4단계 · 최소 이동'})""")
        page.wait_for_timeout(700)
        shot(page, f"win-{w}")
        star = visible(page, "#winStar")
        calc = page.inner_text("#winCalc")
        conf_on = page.evaluate("() => document.querySelectorAll('#conf .conf').length")
        info.append((w, star, calc, conf_on, errors[:2]))
        ctx.close()
    ctx, page, errors = new_page(browser, SIZES[0], reduced_motion="reduce")
    page.goto(f"{base}/index.html?e2e")
    ready(page)
    page.evaluate("""() => __ppUi.showWin({gained: 50, base: 100, speed: 0, streak: 1, mult: 1, usedEasy: true,
        bonus: 0, yardBefore: 2, yardAfter: 2, nextHint: '마당이 자라기까지 3문제'})""")
    page.wait_for_timeout(300)
    shot(page, "win-reduced")
    conf_off = page.evaluate("() => document.querySelectorAll('#conf .conf').length")
    rays = visible(page, ".rays")
    star_off = visible(page, "#winStar")
    calc2 = page.inner_text("#winCalc")
    ctx.close()
    ok = all(s and "최소 이동" in c and "4연속" in c and n > 0 and not e for (_, s, c, n, e) in info)
    check("screens_shots", ok and conf_off == 0 and not rays and not star_off and "쉬운 단서" in calc2,
          f"info={info} conf_off={conf_off} rays={rays} star_off={star_off} calc2={calc2!r}")


def no_external_urls(browser, base):
    """외부 주소를 하나도 받지 않는다(글꼴 vendored): 시작·게임·정답까지 요청 주소가 모두 같은 서버."""
    ctx, page, errors = new_page(browser, SIZES[0])
    urls = []
    page.on("request", lambda r: urls.append(r.url))
    into_game(page, base)
    page.evaluate("__pp.solveCurrent()")
    page.wait_for_timeout(500)
    ext = [u for u in urls if not u.startswith(base) and not u.startswith("data:")]
    fonts = [u for u in urls if u.endswith(".woff2")]
    check("no_external_urls", not ext and len(fonts) >= 2 and not errors, f"ext={ext[:3]} fonts={len(fonts)} errors={errors[:2]}")
    ctx.close()


def slow_fonts_no_old_browser(browser, base):
    """글꼴 준비가 4초보다 늦어도(저사양) 옛 브라우저 안내가 뜨지 않는다: 모듈이 돌기 시작하면 __ppBooted."""
    ctx, page, errors = new_page(browser, SIZES[0])
    page.add_init_script("""(() => { const slow = new Promise((r) => setTimeout(r, 5500));
        try { Object.defineProperty(document.fonts, 'ready', { get: () => slow }); } catch (e) {} })()""")
    page.goto(f"{base}/index.html?e2e")
    page.wait_for_timeout(5000)
    mid_hidden = not visible(page, "#oldBrowser")
    booted = page.evaluate("window.__ppBooted === true")
    page.wait_for_function("() => window.__ppReady === true", timeout=15000)
    page.wait_for_timeout(200)
    end_hidden = not visible(page, "#oldBrowser")
    check("slow_fonts_no_old_browser", mid_hidden and booted and end_hidden and not errors,
          f"mid_hidden={mid_hidden} booted={booted} end_hidden={end_hidden} errors={errors[:2]}")
    ctx.close()


def stage_tap_closes_panel(browser, base):
    """판 svg 밖(HUD·무대)을 누르면 이동 패널이 닫힌다. 패널 위(묶음 이름)를 눌러도 닫히지 않는다.
    패널 묶음 이름: 뒤집기 · 시계 방향 · 시계 반대 방향."""
    ctx, page, errors = new_page(browser, SIZES[0])
    into_game(page, base)
    pid = page.evaluate("__pp.state.pieces[0].id")
    xy = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
    page.mouse.click(xy["x"], xy["y"])
    page.wait_for_timeout(200)
    opened = page.evaluate("__pp.panelState().open")
    caps = page.evaluate("[...document.querySelectorAll('#pp-panel .pp-cap')].map((e) => e.textContent)")
    cap = page.evaluate("(() => { const r = document.querySelector('#pp-panel .pp-cap[data-group=ccw]').getBoundingClientRect();"
                        " return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()")
    page.mouse.click(cap["x"], cap["y"])
    page.wait_for_timeout(150)
    still = page.evaluate("__pp.panelState().open")
    chip = page.evaluate("(() => { const r = document.querySelector('#stageChip').getBoundingClientRect();"
                         " return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()")
    page.mouse.click(chip["x"], chip["y"])
    page.wait_for_timeout(150)
    closed = not page.evaluate("__pp.panelState().open")
    check("stage_tap_closes_panel", opened and still and closed and caps == ["뒤집기", "시계 방향", "시계 반대 방향"] and not errors,
          f"opened={opened} still={still} closed={closed} caps={caps} errors={errors[:2]}")
    ctx.close()


TESTS = (title_to_tutorial_first_visit, tutorial_input_kind, every_puzzle_layout, stage_screens, portrait_warning,
         buttons_min_48px, no_zoom_or_callout, screens_shots, no_external_urls, slow_fonts_no_old_browser,
         stage_tap_closes_panel)


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
                    if DUMP and fn is not every_puzzle_layout:
                        continue
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
