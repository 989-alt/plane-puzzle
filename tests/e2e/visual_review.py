"""Task 8 시각 검토 캡처. 큐브 왕국 tests/e2e/visual_review.py 구조.

1024×768·1280×800 에서 시작·조작 안내·1~4단계 게임·이동 패널 열림·숨김 모드 카드 줄·정답 화면을 찍어
tests/e2e/out/review-<이름>-<너비>.png 로 둔다. 사람이(또는 검토자가) 눈으로 본다:
판 격자가 그림 속 판 가운데, 조각이 탁자 위에 놓인 듯(그림자·두께), 어수선하지 않음, 화면 밖 조각·잘린 글자 없음.
자동 확인도 함께 한다: 조각이 무대 안, HUD 와 겹침 없음(covered), 글자 넘침(scrollWidth > clientWidth) 없음.

  python tests/e2e/visual_review.py [base_url]
"""
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
PORT = 8772
SIZES = ({"width": 1024, "height": 768}, {"width": 1280, "height": 800})
BASE_ARG = next((a for a in sys.argv[1:] if a.startswith("http")), None)
STAGES = ((1, "s1-007"), (2, "s2-013"), (3, "s3-021"), (4, "s4-030"))

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)


def shot(page, name, w):
    path = os.path.join(OUT, f"review-{name}-{w}.png")
    page.screenshot(path=path)
    return path


# 화면에 보이는 글자 상자 중 내용이 넘쳐 잘린 것(가로·세로)
CLIP_JS = """() => { const out = [];
  for (const e of document.querySelectorAll('.screen.on *, #stage *')) {
    if (!(e instanceof HTMLElement) || !e.offsetParent || !e.textContent.trim() || e.children.length) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible') out.push(e.textContent.trim().slice(0, 20));
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) out.push('off:' + e.textContent.trim().slice(0, 20));
  } return out; }"""

PIECES_IN_STAGE_JS = """() => { const s = document.getElementById('stage').getBoundingClientRect(); const bad = [];
  for (const n of document.querySelectorAll('.pp-piece')) { const r = n.getBoundingClientRect();
    if (r.left < s.left - 1 || r.top < s.top - 1 || r.right > s.right + 1 || r.bottom > s.bottom + 1) bad.push(n.getAttribute('data-id')); }
  return bad; }"""

# 판 격자 가운데와 그림 속 판(금테 outer) 가운데 차이(px)
CENTER_JS = """() => { const g = __pp.g; const P = __pp.puzzle; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of P.board) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  const gx = g.ox + (x0 + x1) / 2 * g.S, gy = g.oy + (y0 + y1) / 2 * g.S;
  const o = g.inner || g.outer; return [gx - (o.l + o.r) / 2, gy - (o.t + o.b) / 2]; }"""


def review(browser, base, view):
    w = view["width"]
    ctx = browser.new_context(viewport=view)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.goto(f"{base}/index.html?e2e")
    page.evaluate("() => localStorage.clear()")
    page.reload()
    page.wait_for_function("() => window.__ppReady === true", timeout=15000)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(400)
    shot(page, "title", w)
    clip = {"title": page.evaluate(CLIP_JS)}
    page.click("#startBtn")  # 첫 접속: 조작 안내
    page.wait_for_timeout(500)
    shot(page, "tutorial", w)
    clip["tutorial"] = page.evaluate(CLIP_JS)
    page.click("#tutDone")
    page.wait_for_function("() => __pp.game().screen === 'game' && __pp.game().puzzleId", timeout=15000)
    page.wait_for_timeout(400)
    info = {}
    for stage, pid in STAGES:
        page.evaluate(f"__pp.setProgress({{stage: {stage}, streak: 3, score: 1240}})")
        page.evaluate(f"__pp.setPuzzle('{pid}')")
        page.wait_for_timeout(600)
        shot(page, f"s{stage}", w)
        info[f"s{stage}"] = (page.evaluate(PIECES_IN_STAGE_JS), page.evaluate("__pp.covered()"), page.evaluate(CENTER_JS))
        clip[f"s{stage}"] = page.evaluate(CLIP_JS)
    # 3단계: 패널 열림 → 이동 카드 3장 쌓기(숨김 모드)
    page.evaluate("__pp.setProgress({stage: 3})")
    page.evaluate("__pp.setPuzzle('s3-021')")
    page.wait_for_timeout(400)
    pid = page.evaluate("__pp.state.pieces[1].id")
    p = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
    page.mouse.click(p["x"], p["y"])
    page.wait_for_timeout(300)
    shot(page, "panel", w)
    info["panel"] = ([], page.evaluate("__pp.covered()"), None)
    for m in ("flipLeft", "cw90", "cw180"):
        bb = page.query_selector(f'#pp-panel button[data-move="{m}"]').bounding_box()
        page.mouse.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        page.wait_for_timeout(250)
    shot(page, "hidden-queue", w)
    info["hidden-queue"] = ([], page.evaluate("__pp.covered()"), None)
    clip["hidden-queue"] = page.evaluate(CLIP_JS)
    # 정답 화면(4단계 최소 이동 별)
    page.evaluate("__pp.setProgress({stage: 4})")
    page.evaluate("__pp.setPuzzle('s4-030')")
    page.wait_for_timeout(300)
    page.evaluate("__pp.elapsed(23)")
    page.evaluate("__pp.solveCurrent()")
    page.wait_for_function("() => __pp.game().screen === 'win'", timeout=5000)
    page.wait_for_timeout(900)
    shot(page, "win", w)
    clip["win"] = page.evaluate(CLIP_JS)
    ctx.close()
    for k, (off, cov, ctr) in info.items():
        ok = not off and not cov and (ctr is None or (abs(ctr[0]) <= 1 and abs(ctr[1]) <= 1))
        check(f"{w} {k} pieces", ok, f"offStage={off} covered={cov[:3]} centre={ctr}")
    for k, c in clip.items():
        check(f"{w} {k} text", not c, f"clipped={c[:5]}")
    check(f"{w} no errors", not errors, f"{errors[:2]}")


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
                for view in SIZES:
                    review(browser, base, view)
            finally:
                browser.close()
    finally:
        if server:
            server.terminate()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed  (캡처: tests/e2e/out/review-*.png)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
