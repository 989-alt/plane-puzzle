# 평면 도형 이동 퍼즐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3~4학년군 「평면도형의 이동」 수업 뒤 혼자 하는 평면 조각 퍼즐 웹앱을 별도 저장소 `989-alt/plane-puzzle`로 만들어 GitHub Pages에 배포한다.

**Architecture:** 빌드 도구 없는 정적 ES 모듈. `src/core`(순수 함수: 사분 삼각형 격자·조각 변환·판정·해답 탐색·진행)와 `src/view`(SVG 2D 렌더·입력·패널 배치), `src/ui`(화면·HUD·단서 카드)로 나눈다. 문제는 시드 고정 생성기로 미리 만든 단계별 JSON 은행을 읽는다. 큐브 왕국(`C:\Users\4F 전담실\space-puzzle`)의 진행·저장·화면·패널 회피·e2e 하네스를 옮겨 고쳐 쓴다.

**Tech Stack:** HTML/CSS/JS(ES2022 모듈), SVG, Node 24 `node:test`, Python Playwright(시스템 Edge `channel="msedge"`), kie.ai gpt-image-2(그림), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-22-plane-puzzle-design.md` (실행자는 계획과 함께 반드시 읽는다)

## Global Constraints
- 백엔드·서버·DB·외부 API 호출 없음. 외부 CDN 없음(글꼴 vendored).
- 빌드 도구 없음(vite는 한글 경로에서 크래시). 저장소 경로: `C:\Users\4F 전담실\plane-puzzle`, 브랜치 `master`.
- 개인정보 수집 없음(이름 입력칸 없음). localStorage 접근은 모두 try/catch, 키 접두사 `pp.`.
- 우봉고 이름·원작 조각·카드·그림 사용 금지. 뱀서라이크 요소 금지.
- 교과서 용어 그대로: 밀기, 위쪽·아래쪽·왼쪽·오른쪽으로 뒤집기, 시계 방향·시계 반대 방향으로 90°·180°·270° 돌리기. 화면 문구는 학생에게 해요체.
- 돌리기는 90° 단위만. 45° 기울어진 조각 없음.
- 터치·마우스 1급 지원(Pointer Events), 버튼 최소 48px, 가로 16:10 무대, 세로면 "가로로 돌려 주세요".
- 점수 = (100 + max(0, 60 − floor(초))) × 배율(1~2연속 ×1, 3 ×1.5, 4~5 ×2, 6+ ×3), 쉬운 단서 쓰면 ×0.5. 깨끗한 정답 2번 → 다음 단계(1~4). 4단계 최소 이동 달성 보너스 +50(배율·쉬운 단서 절반 적용, 내가 정한 값).
- 쉬운 단서: 2단계 이상, 60초 뒤 사용 가능, 한 단계 쉬운 단서로 바뀌고 3·4단계에서는 결과 미리보기를 켠다.
- 테스트 명령: `npm test` = `node --test --test-isolation=none "tests/**/*.test.mjs"`. e2e는 이 PC(8GB RAM)에서 **한 번에 하나씩**.
- 커밋은 pathspec으로, 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 시작 전 `C:\Users\4F 전담실\Downloads\교육용게임_개발철칙.md`를 읽는다.

## Review Focus
1. 판 밖·화면 밖으로 조각을 끌어 놓음 → 조각은 트레이 안 가장 가까운 빈 자리로 돌아온다(사라지거나 화면 밖에 남지 않음). → Task 6 `drop outside stage returns piece` 시험.
2. 이동 패널이 열린 채 다른 조각을 누르거나 끎 → 패널 버튼이 어떤 조각·HUD도 덮지 않으므로 탭이 버튼에 맞지 않는다. → Task 6 `panel never covers pieces or ui` 시험(문제 40개 × 모든 조각).
3. 3·4단계 숨김 모드에서 이동을 잔뜩 쌓은 뒤 판에 놓았는데 겹침 → 결과 모양으로 트레이에 돌아오고 줄은 비며 판정·점수는 깨지지 않는다. → Task 6 `hidden drop failure resets queue` 시험.
4. 같은 정답에 여러 해답(다른 배치)이 있음 → 어느 해답이든 정답 처리. 1단계 붉은 표시는 어떤 해답에서도 쓰이지 않는 자리에만. → Task 3 `judge accepts every stored solution` / `wrongTris empty for alt solution`.
5. 연속 탭(더블탭 확대·길게 누르기 메뉴·스크롤) → 화면이 확대·스크롤·문맥 메뉴로 빠지지 않는다. → Task 7 `no zoom or callout` e2e.

---

## File Structure
```
index.html                 화면 뼈대, 무대(svg#board), HUD, 단서 카드, 도구 막대, 패널, 화면들
styles/base.css            글꼴·토큰·기본 (큐브 왕국에서 복사 후 수정)
styles/screens.css         화면·HUD·카드·패널
src/core/grid.js           사분 삼각형 기하: 변환·정규화·키
src/core/pieces.js         조각 정의 라이브러리, 방향(D4 원소)·최소 이동 수
src/core/board.js          놓기 가능 판정, 정답 판정, 1단계 붉은 삼각형
src/core/solver.js         해답 탐색(정확 덮기), 이동 조건, 최소 이동
src/core/progress.js       큐브 왕국 복사 + 4단계 보너스
src/core/storage.js        큐브 왕국 복사(키 접두사 pp.)
src/core/layout.js         트레이 시작 배치·클램프·비키기
src/view/geom.js           격자→화면 px 변환, 무대 크기 맞추기
src/view/render.js         SVG 렌더(판, 윤곽, 조각, 무늬, 그림자, 붉은 표시, 애니메이션)
src/view/panelPlace.js     이동 패널 자리 고르기(큐브 왕국 ringPlace.js 이식)
src/view/input.js          끌기·탭·패널·숨김 모드 이동 줄
src/ui/screens.js hud.js clueCard.js   큐브 왕국 복사 후 수정
src/main.js                조립, 게임 흐름, ?e2e 훅(window.__pp)
tools/gen-puzzles.mjs      시드 고정 생성기 → data/puzzles-s1..s4.json
tools/audit-puzzles.mjs    전수 감사
assets/fonts/              큐브 왕국 글꼴·OFL 복사
assets/img/                새 탑뷰 배경, 제목 배경, 안내 그림 3장, 마스코트(큐브 왕국 cubi-*.webp 복사)
tests/*.test.mjs           단위 시험
tests/e2e/*.py             flow / input / ui / audit_e2e
README.md .nojekyll package.json
```

---

### Task 1: 뼈대·복사 모듈

**Files:** Create `package.json`, `.nojekyll`, `README.md`, `src/core/progress.js`, `src/core/storage.js`, `assets/fonts/*`, `tests/progress.test.mjs`, `tests/storage.test.mjs`

**Interfaces:**
- Produces: `progress.js` — `createProgress(saved)`, `multiplier(streak)`, `scoreFor(seconds, streakAfter, usedEasy)`, `recordSolve(state, {puzzleId, seconds, usedEasy=false, minMovesHit=false}) -> {state, gained, bonus, promoted, islandUp}`, `recordSkip`, `canUseEasy(stage, elapsedSec)`, `easyLevel(stage)`, `islandStage`, `toNextIsland`. `storage.js` — `load(name, fallback)`, `save(name, value)` (키 `pp.${name}`).

- [ ] Step 1: 큐브 왕국 `src/core/progress.js`, `storage.js`, 해당 시험, `assets/fonts/*`(woff2 4개 + OFL 2개)을 복사. `package.json`은 이름 `plane-puzzle`, `imports` 없음, `test` 스크립트는 Global Constraints 그대로.
- [ ] Step 2: 실패 시험 추가 `recordSolve gives +50 bonus when minMovesHit`: 1연속·10초·`minMovesHit:true` → `gained === 150 + 50`, `bonus === 50`; `usedEasy:true`면 `bonus === 25`; 3연속이면 보너스도 ×1.5.
- [ ] Step 3: `npm test` → 새 시험 FAIL.
- [ ] Step 4: `recordSolve`에 보너스 구현(`bonus = round(50 × multiplier × (usedEasy?0.5:1))`, `gained`에 포함). 저장 키 접두사 `pp.`.
- [ ] Step 5: `npm test` PASS. 커밋 `chore: 뼈대·진행·저장 모듈`.

### Task 2: 사분 삼각형 격자와 조각 변환

**Files:** Create `src/core/grid.js`, `src/core/pieces.js`, `tests/grid.test.mjs`, `tests/pieces.test.mjs`

**Interfaces:**
- Produces (`grid.js`): 삼각형 `Tri = [x, y, q]` — 칸 `(x,y)`(화면 좌표, y 아래로 증가)의 사분 삼각형, `q` 0=위(N) 1=오른쪽(E) 2=아래(S) 3=왼쪽(W).
  - `rotCW(tris) -> Tri[]` : 칸 `(x,y)→(-y-1, x)`, `q→(q+1)%4`.
  - `flipLR(tris)`(왼쪽·오른쪽으로 뒤집기): 칸 `(x,y)→(-x-1, y)`, `q`: 1↔3.
  - `flipUD(tris)`(위쪽·아래쪽으로 뒤집기): 칸 `(x,y)→(x, -y-1)`, `q`: 0↔2.
  - `normalize(tris) -> Tri[]` 최소 x,y를 0으로 옮기고 정렬. `key(tris) -> string`. `translate(tris, dx, dy)`.
  - `cell(x,y) -> Tri[]` (사분 4개), `half(x,y,dir)` dir ∈ `'NE'|'SE'|'SW'|'NW'`(그 모서리 쪽 직각삼각형 = 사분 2개, 예 `'NE'` = q0+q1).
- Produces (`pieces.js`):
  - `MOVES = ['flipUp','flipDown','flipLeft','flipRight','cw90','cw180','cw270','ccw90','ccw180','ccw270']`, `applyMove(tris, move) -> Tri[]`(normalize 포함; ccw90=cw270 등).
  - `D4`: 8원소 `['id','r90','r180','r270','fx','fx_r90','fx_r180','fx_r270']`(`fx`=flipLR 먼저, 그다음 rotCW n번). `applyElem(tris, e)`.
  - `MIN_MOVES = {id:0, r90:1, r180:1, r270:1, fx:1, fx_r180:1, fx_r90:2, fx_r270:2}` (fx_r180 = flipUD).
  - `orientations(tris) -> [{tris, elems:string[]}]` 모양이 같은 원소끼리 묶음.
  - `LIBRARY: {id, kind:'cell'|'tri', tris, symmetric:boolean}[]` — 칸 조각: L3, L4, S4, T4, I3, O4, P5, F5, N5, Y5, L5, U5, V5(J·Z 등 거울상은 뒤집기로 얻으므로 넣지 않음). 삼각형 조각: `tS`(작은 직각삼각형 = half 1개), `tB`(큰 직각삼각형, 빗변 아닌 두 변 길이 2 = 사분 8개), `para`(평행사변형 = half 2개 비스듬히), `trap`(사다리꼴 = 칸 1 + half 1), `flag`(칸 2 + half 1), `boot`(칸 3 L + half 1). `symmetric` = orientations 수 < 8.
  - `pieceMoves(fromTris, toTris) -> number|null` 최소 이동 수(같은 모양 아니면 null).
- [ ] Step 1: 실패 시험(`grid.test.mjs`): `rotCW` 네 번 = 원래(normalize 비교); `flipLR` 두 번 = 원래; `flipUD = rotCW²∘flipLR`; `cell(0,0)`을 rotCW 해도 같은 칸; `half(0,0,'NE')` rotCW → `half(?,?,'SE')` 모양; 정규화 뒤 최소 x,y = 0.
- [ ] Step 2: 실패 시험(`pieces.test.mjs`): `orientations(L4).length === 8`, `orientations(O4).length === 1`, `orientations(T4).length === 4`; `applyMove(x,'flipLeft')`와 `'flipRight'` 결과 같음, `'flipUp'`과 `'flipDown'` 같음; `pieceMoves(L4, flipLR(L4)) === 1`; `pieceMoves(L4, transpose)===2`; `tS` orientations 4, `para` orientations 4; 모든 LIBRARY 조각의 사분 수가 짝수이고 연결됨(변 공유).
- [ ] Step 3: `npm test` FAIL → 구현 → PASS.
- [ ] Step 4: 커밋 `feat: 사분 삼각형 격자와 조각 변환`.

### Task 3: 판정과 해답 탐색

**Files:** Create `src/core/board.js`, `src/core/solver.js`, `tests/board.test.mjs`, `tests/solver.test.mjs`

**Interfaces:**
- Consumes: Task 2 전부.
- Produces:
  - 퍼즐 형식(JSON): `{id:'s1-001', stage, board: Tri[], pieces:[{id, lib, start: Tri[], color}], solutions:[[{id, elem, dx, dy}]], minMoves, cards:{[pieceId]:'flip'|'turn'|'flipturn'}}` — `start`는 학생이 처음 보는 모양, `elem`은 start 기준 D4 원소, 놓인 삼각형 = `translate(applyElem(start, elem), dx, dy)`.
  - `board.js`: `placedTris(piece) -> Tri[]`(piece = `{tris, at:[dx,dy]}`), `canPlace(boardTris, others, tris) -> boolean`(모두 판 안 + 겹침 없음), `isSolved(puzzle, placed) -> boolean`(판 삼각형 집합과 놓인 합집합이 정확히 같고 겹침 없음), `wrongTris(puzzle, placed) -> Set<key>`(판 밖이거나, 그 조각이 어떤 저장 해답의 자리와도 다른 삼각형).
  - `solver.js`: `solve(board, pieces, {limit=200}) -> solutions`(정확 덮기 DFS: 가장 덮기 어려운 삼각형부터), `needs(puzzle) -> {[pieceId]: {flip:boolean, turn:boolean}}`(모든 해답에서 참일 때만 true; flip = 그 모양을 내는 모든 원소가 반사, turn = id·fx·fx_r180으로 만들 수 없음), `minMovesOf(puzzle) -> number`(해답마다 Σ pieceMoves, 그중 최소).
- [ ] Step 1: 실패 시험: 손으로 만든 2조각 퍼즐(L4 + I3... 판 7칸)에서 `solve` 해답 수 기대값; `isSolved`가 모든 해답에 true, 한 칸 어긋나면 false; `canPlace` 판 밖·겹침 false; `wrongTris`가 대체 해답 자리에서는 비어 있음(**Review Focus 4**); `needs`: 시작을 `fx`로 둔 L4 하나짜리 판이면 `{flip:true, turn:false}`; `minMovesOf` 기대값.
- [ ] Step 2: FAIL → 구현 → PASS. 커밋 `feat: 판정·해답 탐색·이동 조건`.

### Task 4: 문제 생성기·은행·전수 감사

**Files:** Create `tools/gen-puzzles.mjs`, `data/puzzles-s1.json`…`s4.json`, `tools/audit-puzzles.mjs`, `tests/bank.test.mjs`

**Interfaces:**
- Consumes: Task 2·3. 큐브 왕국 `tools/gen-puzzles.mjs`의 mulberry32 시드 방식을 참고.
- Produces: 단계마다 40문제 JSON(Task 3 형식). `node tools/gen-puzzles.mjs` 두 번 실행 결과 바이트 동일.
- 생성 규칙(거꾸로 만들기): 단계 조각 수만큼 LIBRARY에서 뽑아(1·2단계 `kind:'cell'`만, 3·4단계 `tri` 조각 1~2개 포함) 서로 변을 맞대 붙여 판을 만든다 → 판 크기 가로·세로 각각 ≤ 6칸 → 각 조각 `start` = 놓인 모양에 무작위 D4 원소 → `solve`.
- 채택 조건: 해답 1~6개; 모든 해답에서 `needs` flip인 조각 ≥1개 **그리고** turn인 조각 ≥1개(같은 조각이어도 됨); symmetric 조각 ≤1개; 3단계는 `cards` ≥1개(needs가 true인 조각에 카드), 4단계 `minMoves` 3~8. 조각 수: s1 3, s2 3~4, s3 3~4, s4 4~5. 색은 조각마다 다른 6색 팔레트.
- 감사(`audit-puzzles.mjs`, 콘솔 보고 + 실패 시 종료 코드 1): A 형식·연결·판 크기, B 저장 해답이 모두 `isSolved`, C `solve` 재실행 해답 수 = 저장 수, D 조건 카드가 모든 해답에서 참, E `minMoves` 재계산 일치, F 실제 조작 흉내 — 조각마다 start에서 `MOVES` 버튼만으로(BFS) 해답 모양에 도달하는 최소 버튼 수 = pieceMoves.
- [ ] Step 1: 실패 시험 `bank.test.mjs`: 4파일 각 40문제, id 유일, 위 채택 조건 전부, 감사 A~F 함수가 0 실패.
- [ ] Step 2: FAIL → 생성기·감사 구현 → 생성 → PASS. 시간·분포(해답 수, minMoves, 조각 종류) 보고를 커밋 메시지에.
- [ ] Step 3: 커밋 `feat: 문제 생성기·은행 160문제·전수 감사`.

### Task 5: 그림 자산

**Files:** Create `assets/img/board-bg.webp`, `title-bg.webp`, `tut-move.webp`, `tut-flip.webp`, `tut-turn.webp`; copy `cubi-idle/cheer/think.webp`, `favicon.svg` from space-puzzle

- [ ] Step 1: `~/docs/.env`의 `KIE_API_KEY`를 `KIE_AI_API_KEY`로 내보내고 `python ~/.claude/skills/education-pptx/scripts/image_gen.py`로 생성. 기준 그림 `space-puzzle/assets/img/game-bg-v4.webp`(같은 화풍 레퍼런스). 배경 요구: **정면 위에서 내려다본(탑뷰, 원근 없음)** 판타지 공방 작업대, 가운데 넓은 빈 나무판(퍼즐 판 자리, 화면 가로 약 45%), 둘레는 조각을 올려둘 빈 탁자 면, 가장자리에만 소품. 16:10 이상 해상도.
- [ ] Step 2: WebP(품질 80) 변환, 장당 ≤ 400KB. 사용 전 Read로 눈으로 확인 — 원근이 남아 있으면 다시 생성.
- [ ] Step 3: 커밋 `assets: 탑뷰 배경·안내 그림`.

### Task 6: 렌더·입력·패널·시작 배치

**Files:** Create `src/core/layout.js`, `src/view/geom.js`, `src/view/render.js`, `src/view/panelPlace.js`, `src/view/input.js`, `tests/layout.test.mjs`, `tests/panel.test.mjs`, `tests/e2e/view.html`(하네스)

**Interfaces:**
- Consumes: Task 2·3.
- Produces:
  - `layout.js`: `placeStarts(puzzle, {cols, rows}) -> {[pieceId]: [dx,dy]}` 판 둘레 트레이 자리(판·서로 겹침 없음, 트레이 경계 안, 단서 카드·도구 막대 칸 회피 사각형 인자 `avoid`), `clampToTray(tris, at, bounds) -> [dx,dy]`, `nearestFree(tris, at, others, bounds, board?) -> [dx,dy]|null`(변환 뒤 겹치면 가장 가까운 빈 자리, 판 밖 조각은 판에 들어가지 않음).
  - `geom.js`: `fitStage(W, H, cols, rows) -> {S, ox, oy}`(칸 px·원점), `triPolygon(tri, g) -> [[px,py]×3]`, `screenToCell(px, py, g) -> [x,y]`.
  - `render.js`: `createView(svg, puzzle, opts) -> {update(state), animateMove(pieceId, move) -> Promise, setWrong(keys:Set), setGhost(show:boolean), pieceBoxes() -> {[id]: DOMRect}}`. 조각 = 사분 삼각형 polygon 묶음 + 바깥선 + 두께 그림자 + 무늬(조각 `start` 기준 첫 사분에 점/작은 화살표, 조각과 같이 변환). 뒤집기 애니메이션 = 축 방향 scale −1 트윈 220ms, 돌리기 = rotate 트윈 90°당 180ms, `prefers-reduced-motion`이면 즉시.
  - `panelPlace.js`: 큐브 왕국 `src/scene/ringPlace.js`를 이식. `placePanel({boxes, sel, ui, W, H, prev}) -> {x, y, layout}` — 버튼 10개(뒤집기 4 + 돌리기 시계 3 + 시계 반대 3, 두 줄 배치), 어떤 조각 상자·UI 사각형과도 겹치지 않는 자리, 없으면 가장 덜 겹치는 자리, 화면 안.
  - `input.js`: `attachInput(view, getState, dispatch, {hidden:boolean})` — Pointer Events. 끌기(밀기) = 칸 단위 스냅, 놓을 때 `canPlace`면 판에, 아니면 `nearestFree`로 트레이; 탭 = 패널 열기; 패널 버튼 = `dispatch({type:'move', id, move})`. **숨김 모드**: 버튼은 `queue`에 카드로 쌓고 모양은 그대로, 되돌리기(이동 1회로 셈)·처음으로; 판에 놓으면 큐 순서대로 `animateMove` 후 결과로 `canPlace` 검사, 실패면 결과 모양으로 트레이 복귀·큐 비움. 놓기 기준점 = 잡은 사분이 결과에서 옮겨 간 사분이 손가락 칸에 오게.
- [ ] Step 1: 실패 시험(`layout.test.mjs`): 160문제 모두 `placeStarts`가 겹침 0·판 칸 0·트레이 안; `nearestFree` 판 밖 조각은 판 칸에 안 들어감; `drop outside stage returns piece`(**Review Focus 1**): 화면 밖 좌표로 놓으면 트레이 안 자리.
- [ ] Step 2: 실패 시험(`panel.test.mjs`): `panel never covers pieces or ui`(**Review Focus 2**) — 40문제 × 모든 조각의 시작 상자로 패널을 열면 버튼이 다른 조각·UI 사각형과 겹친 수 0(1280×800, 1024×768 두 크기).
- [ ] Step 3: FAIL → 구현 → PASS.
- [ ] Step 4: e2e 하네스 `tests/e2e/view.html` + `tests/e2e/input_test.py`(큐브 왕국 input_test 구조 이식, http.server 8768): 마우스·터치 각각 끌기 스냅, 탭→패널, 버튼 10종 결과 모양, 숨김 모드 큐·되돌리기·놓을 때 드러남, `hidden drop failure resets queue`(**Review Focus 3**), 1단계 붉은 표시. 실행 → 모두 PASS.
- [ ] Step 5: 커밋 `feat: SVG 렌더·끌기·이동 패널·숨김 모드`.

### Task 7: 화면·HUD·흐름 조립

**Files:** Create `index.html`, `styles/base.css`, `styles/screens.css`, `src/ui/screens.js`, `src/ui/hud.js`, `src/ui/clueCard.js`, `src/main.js`, `tests/e2e/flow_test.py`, `tests/e2e/ui_test.py`

**Interfaces:**
- Consumes: Task 1~6.
- 큐브 왕국 같은 이름 파일을 복사해 고친다. 바뀌는 것:
  - `LEVEL_NAMES = ['', '1단계 · 완성 모양', '2단계 · 판 모양', '3단계 · 이동 조건', '4단계 · 최소 이동']`, `ISLAND_NAMES = ['빈 마당', '타일 오두막', '타일 마을', '타일 성']`, 화면 칩 문구 "도형 이동 퍼즐".
  - 단서 카드: 1단계 "판 위의 빛나는 모양대로 채워요", 2단계 판 윤곽 그림, 3단계 조각별 조건 카드("이 조각은 뒤집어야 맞아요" / "돌려야 맞아요" / "뒤집고 돌려야 맞아요"), 4단계 "이동 N번 안에 맞혀 보세요" + 지금 이동 수.
  - 첫 접속 안내 3장(밀기·뒤집기·돌리기, 입력 종류별 문구), 승리 화면에 최소 이동 별.
  - `?e2e`면 `window.__pp = {state, puzzle, setPuzzle(id), pieceScreenXY(id), solveCurrent(), moves, panelRect()}`; `window.__ppReady` 항상.
  - `touch-action:none`, `-webkit-touch-callout:none`, `user-select:none`, viewport `user-scalable=no`, 세로 안내, 깨끗한 정답 2번 승급.
- [ ] Step 1: `flow_test.py`(큐브 왕국 flow_test 이식): 시작→안내→1단계 풀기(`solveCurrent`)→승리→다음→2연속 승급→4단계까지, 점수 공식 값, 쉬운 단서 60초 조건, 새로고침 뒤 최고 점수 유지. `ui_test.py`: 단계별 화면 캡처, 버튼 ≥48px, 세로 안내, `no zoom or callout`(**Review Focus 5**: 더블탭·길게 누르기 뒤 `visualViewport.scale === 1`, 스크롤 0).
- [ ] Step 2: 실행 → FAIL → 구현 → 한 번에 하나씩 PASS.
- [ ] Step 3: 커밋 `feat: 화면·HUD·단서 카드·게임 흐름`.

### Task 8: 브라우저 전수 풀이·시각 검토·배포

**Files:** Create `tests/e2e/audit_e2e.py`, `tests/e2e/visual_review.py`; Modify `README.md`

- [ ] Step 1: `audit_e2e.py`: 단계마다 3문제(12문제)를 **실제 포인터 조작**(끌기·탭·패널 버튼, 3·4단계는 숨김 모드)으로 정답 화면까지, 마우스·터치 각각. 패널 버튼에 잘못 맞은 탭 0. → 24/24 PASS.
- [ ] Step 2: `visual_review.py`로 1024×768·1280×800 단계별 캡처 → Read로 확인: 판이 화면 가운데, 조각이 배경에 붙은 스티커처럼 보이지 않음(그림자·두께), 어수선하지 않음, 화면 밖 조각 없음.
- [ ] Step 3: `npm test`, 감사 도구, e2e 4종 순서대로 PASS 확인. README(실행·시험·문제 재생성·배포) 작성. 커밋.
- [ ] Step 4: 배포(사용자가 "별도 repo로 배포" 지시함): `gh repo create 989-alt/plane-puzzle --public --source . --push`, `gh api -X POST repos/989-alt/plane-puzzle/pages -f source[branch]=master -f source[path]=/`, 빌드 완료(`pages/builds/latest` status `built`) 확인 뒤 헤드리스 Edge로 라이브 주소에서 `__ppReady` 확인.
