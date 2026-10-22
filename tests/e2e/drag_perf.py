"""끌기 매끄러움 측정: 60프레임 동안 조각을 끌며 requestAnimationFrame 간격(ms)의 평균·최댓값을 잰다.

  python tests/e2e/drag_perf.py [id] [반복 수]
CPU 4배 느리게(CDP Emulation.setCPUThrottlingRate)로 저사양 크롬북을 흉내 낸다. 이 PC는 8GB: 혼자 돌린다.
"""
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import serve  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PORT = 8779
PID = sys.argv[1] if len(sys.argv) > 1 else "s4-012"
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 3


def run_once(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/tests/e2e/view.html?id={PID}&hud=0")
    page.wait_for_function("window.__ppReady === true", timeout=20000)
    page.evaluate("document.fonts.ready")
    cdp = ctx.new_cdp_session(page)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    pid = page.evaluate("__pp.state.pieces[0].id")
    a = page.evaluate("(id) => __pp.pieceScreenXY(id)", pid)
    x0, y0 = a["x"], a["y"]
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x0 + 4, y0 + 4)
    page.evaluate("""() => { window.__ft = []; let last = null;
        const tick = (t) => { if (last !== null) window.__ft.push(t - last); last = t;
          if (window.__ft.length < 60) requestAnimationFrame(tick); };
        requestAnimationFrame(tick); }""")
    k = 0
    while page.evaluate("window.__ft.length") < 60 and k < 400:
        k += 1
        dx = 180 * ((k % 40) / 40)
        page.mouse.move(x0 + 4 + dx, y0 + 4 + dx * 0.4)
    ft = page.evaluate("window.__ft")
    page.mouse.up()
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    ctx.close()
    return ft, errors


def main():
    srv = serve.start(ROOT, PORT)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            avgs, maxes = [], []
            for _ in range(RUNS):
                ft, errors = run_once(browser)
                assert not errors, errors
                avgs.append(sum(ft) / len(ft))
                maxes.append(max(ft))
            browser.close()
        print(f"{PID}: avg frame {sum(avgs)/len(avgs):.2f} ms (runs {', '.join(f'{a:.2f}' for a in avgs)}), "
              f"max {max(maxes):.1f} ms")
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
