"""
독립 QA 검증 v2 — 방어적 버전
"""
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
S = "/home/user/organt_workspace/p-024-채팅-사이트-with-ai/"

RESULTS = {}

def shot(page, name, note=""):
    page.screenshot(path=S + name)
    print(f"  📸 {name}" + (f"  [{note}]" if note else ""))

def safe_click(locator, force=False):
    try:
        locator.click(force=force, timeout=3000)
        return True
    except Exception as e:
        print(f"    ⚠ click failed: {e.__class__.__name__}: {str(e)[:80]}")
        return False

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    # ──────────────────────────────────────────────
    # 0. 초기 로드
    # ──────────────────────────────────────────────
    print("\n[0] 초기 로드")
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(800)
    shot(page, "qa_00_initial.png")

    # 다크모드 확인
    theme = page.evaluate("() => document.documentElement.getAttribute('data-theme') || 'none'")
    bg = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--clr-bg').trim()")
    print(f"  data-theme={theme!r}, --clr-bg={bg!r}")
    RESULTS["dark_mode"] = theme

    # ──────────────────────────────────────────────
    # 1. 마크다운 렌더링
    # ──────────────────────────────────────────────
    print("\n[1] 마크다운 렌더링")
    inp = page.locator("#composerInput")
    inp.click()

    # 인라인 마크다운 메시지
    page.keyboard.type("**굵게** _이탤릭_ `인라인코드` ~~취소선~~")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1200)

    # 코드블록 메시지
    inp.click()
    page.keyboard.type("```javascript")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("const x = 'hello world';")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("console.log(x);")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("```")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    shot(page, "qa_01_markdown.png", "마크다운 렌더링")

    # HTML 검사
    msgs = page.query_selector_all(".message")
    print(f"  메시지 수: {len(msgs)}")
    if msgs:
        html1 = msgs[-2].inner_html() if len(msgs) >= 2 else ""
        html2 = msgs[-1].inner_html()
        print(f"  인라인 HTML: {html1[:200]}")
        print(f"  코드블록 HTML: {html2[:200]}")
        has_strong = "<strong>" in html1 or "<b>" in html1
        has_em = "<em>" in html1 or "<i>" in html1
        has_code = "<code>" in html1
        has_pre = "<pre>" in html2
        RESULTS["md_strong"] = has_strong
        RESULTS["md_em"] = has_em
        RESULTS["md_code"] = has_code
        RESULTS["md_pre"] = has_pre
        print(f"  → strong={has_strong}, em={has_em}, code={has_code}, pre={has_pre}")

    # ──────────────────────────────────────────────
    # 2. Tone badge
    # ──────────────────────────────────────────────
    print("\n[2] Tone badge")
    # 메시지 안에서 배지 찾기
    badges = page.query_selector_all(".message__tone, .tone-badge, [class*='tone'], [class*='grade-badge']")
    print(f"  배지 수: {len(badges)}")
    if badges:
        for b in badges[:6]:
            cls = b.get_attribute("class") or ""
            txt = (b.inner_text() or "").strip()
            print(f"    {cls!r}: {txt!r}")
        RESULTS["tone_badge_found"] = True
    else:
        # 더 넓게 탐색
        all_els = page.query_selector_all(".message *")
        badge_candidates = []
        for el in all_els:
            cls = el.get_attribute("class") or ""
            if any(k in cls for k in ["tone", "grade", "badge", "sentiment"]):
                badge_candidates.append((cls, (el.inner_text() or "").strip()[:20]))
        print(f"  메시지 내 badge 후보: {badge_candidates[:8]}")
        RESULTS["tone_badge_found"] = len(badge_candidates) > 0
    shot(page, "qa_02_tone.png", "tone badge 상태")

    # ──────────────────────────────────────────────
    # 3. 타이핑 인디케이터
    # ──────────────────────────────────────────────
    print("\n[3] 타이핑 인디케이터")
    page2 = browser.new_page(viewport={"width": 1000, "height": 700})
    page2.goto(BASE)
    page2.wait_for_load_state("networkidle")
    page2.wait_for_timeout(500)
    inp2 = page2.locator("#composerInput")
    inp2.click()
    page2.keyboard.type("타이핑 중...")
    page2.wait_for_timeout(700)

    # page에서 인디케이터 확인
    typing_els = page.query_selector_all("[class*='typing'], #typingIndicator, .typing-indicator")
    print(f"  타이핑 인디케이터 요소: {len(typing_els)}")
    for te in typing_els:
        cls = te.get_attribute("class") or ""
        tid = te.get_attribute("id") or ""
        txt = (te.inner_text() or "").strip()
        vis = te.is_visible()
        print(f"    id={tid!r} cls={cls!r} txt={txt!r} visible={vis}")
    RESULTS["typing_indicator_found"] = len(typing_els) > 0
    shot(page, "qa_03_typing.png", "타이핑 인디케이터 (탭1 시점)")

    page2.close()
    page.wait_for_timeout(600)
    shot(page, "qa_03b_typing_gone.png", "타이핑 종료 후")

    # ──────────────────────────────────────────────
    # 4. 다른 채널 → 사이드바 배지
    # ──────────────────────────────────────────────
    print("\n[4] 사이드바 미읽음 배지")
    page3 = browser.new_page(viewport={"width": 1000, "height": 700})
    page3.goto(BASE)
    page3.wait_for_load_state("networkidle")
    safe_click(page3.locator("[data-channel-id='ai-chat']"))
    page3.wait_for_timeout(400)
    inp3 = page3.locator("#composerInput")
    inp3.click()
    page3.keyboard.type("다른 채널 테스트 메시지")
    page3.keyboard.press("Enter")
    page3.wait_for_timeout(800)
    page3.close()

    # page1 (general) 에서 배지 확인
    page.wait_for_timeout(500)
    badge_els = page.query_selector_all(".channel-item__badge, [class*='unread-badge'], [class*='badge-count']")
    print(f"  미읽음 배지 요소: {len(badge_els)}")
    for be in badge_els:
        cls = be.get_attribute("class") or ""
        txt = (be.inner_text() or "").strip()
        vis = be.is_visible()
        print(f"    cls={cls!r} txt={txt!r} vis={vis}")
    RESULTS["unread_badge_found"] = len(badge_els) > 0
    shot(page, "qa_04_unread_badge.png", "사이드바 미읽음 배지")

    # 실제 ai-chat 채널 아이템 innerHTML 확인
    ai_item = page.locator("[data-channel-id='ai-chat']")
    print(f"  ai-chat item HTML: {ai_item.inner_html()[:300]}")

    # ──────────────────────────────────────────────
    # 5. 요약 패널
    # ──────────────────────────────────────────────
    print("\n[5] 요약 사이드패널")
    sb = page.locator("#summaryBtn")
    print(f"  summaryBtn visible: {sb.is_visible()}")
    sb.click()
    page.wait_for_timeout(2000)
    shot(page, "qa_05_summary.png", "요약 패널 열림")

    panel = page.locator("#summaryPanel")
    print(f"  summaryPanel visible: {panel.is_visible()}")
    if panel.is_visible():
        txt = panel.inner_text()[:400]
        print(f"  패널 텍스트: {txt!r}")
        RESULTS["summary_panel_works"] = True
    else:
        RESULTS["summary_panel_works"] = False

    # ──────────────────────────────────────────────
    # 6. 모바일 375px
    # ──────────────────────────────────────────────
    print("\n[6] iPhone SE 375px")
    mob = browser.new_page(viewport={"width": 375, "height": 667})
    mob.goto(BASE)
    mob.wait_for_load_state("networkidle")
    mob.wait_for_timeout(600)
    shot(mob, "qa_06_mobile_initial.png", "모바일 초기")

    # 사이드바 상태
    mob_sidebar = mob.locator(".sidebar")
    mob_sidebar_cls = mob.evaluate("() => document.querySelector('.sidebar')?.className || ''")
    print(f"  sidebar class: {mob_sidebar_cls!r}")

    # 햄버거
    ham = mob.locator("#hamburgerBtn")
    print(f"  hamburger visible: {ham.is_visible()}")

    # 메시지 입력 영역 위치
    comp = mob.locator(".composer")
    comp_box = comp.bounding_box()
    print(f"  composer bounding_box: {comp_box}")
    if comp_box:
        bottom = comp_box['y'] + comp_box['height']
        RESULTS["mobile_composer_bottom"] = bottom
        print(f"  composer 하단: {bottom}px (화면 667px)")

    # 햄버거 눌러 사이드바 열기
    if ham.is_visible():
        ham.click()
        mob.wait_for_timeout(400)
        shot(mob, "qa_06b_mobile_sidebar.png", "모바일 사이드바 열림")
        # 스크림 클릭으로 닫기
        scrim = mob.locator("#sidebarScrim, .sidebar-scrim")
        if scrim.is_visible():
            safe_click(scrim)
            mob.wait_for_timeout(300)

    # 메시지 전송
    mob_inp = mob.locator("#composerInput")
    mob_inp.click()
    mob.keyboard.type("375px 모바일 입력 테스트")
    shot(mob, "qa_06c_mobile_typing.png", "모바일 입력 중")
    mob.keyboard.press("Enter")
    mob.wait_for_timeout(800)
    shot(mob, "qa_06d_mobile_sent.png", "모바일 전송 후")
    mob.close()

    # ──────────────────────────────────────────────
    # 7. @AI 멘션 (AI disabled지만 UI 처리 확인)
    # ──────────────────────────────────────────────
    print("\n[7] @AI 멘션")
    # 패널 닫기 (force click)
    close_btn = page.locator("#summaryCloseBtn")
    safe_click(close_btn, force=True)
    page.wait_for_timeout(300)

    inp = page.locator("#composerInput")
    inp.click()
    page.keyboard.type("@AI 안녕하세요!")
    page.keyboard.press("Enter")
    page.wait_for_timeout(3500)
    shot(page, "qa_07_at_ai.png", "@AI 멘션 응답")

    # AI 버블 탐색
    ai_msgs = page.query_selector_all(".message--ai, [data-author='AI'], .message[data-type='ai']")
    print(f"  AI 버블 (strict): {len(ai_msgs)}")
    # 모든 메시지에서 AI/bot 관련 클래스 확인
    all_msgs = page.query_selector_all(".message")
    for m in all_msgs[-3:]:
        cls = m.get_attribute("class") or ""
        txt = (m.inner_text() or "")[:80]
        print(f"  msg cls={cls!r} txt={txt!r}")
    RESULTS["at_ai_bubble"] = len(ai_msgs) > 0

    # ──────────────────────────────────────────────
    # 8. 최종 전체 화면 + CSS token 확인
    # ──────────────────────────────────────────────
    print("\n[8] 최종 + 토큰 시스템")
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    shot(page, "qa_08_final.png", "최종 전체")

    # oklch 사용 확인
    oklch_vars = page.evaluate("""
        () => {
            const result = [];
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (rule.selectorText === ':root') {
                            const t = rule.cssText;
                            const matches = t.match(/--[\\w-]+:\\s*oklch[^;]+/g);
                            if (matches) result.push(...matches.slice(0, 10));
                        }
                    }
                } catch(e) {}
            }
            return result;
        }
    """)
    print(f"  oklch 변수 ({len(oklch_vars)}개):")
    for v in oklch_vars[:10]:
        print(f"    {v[:80]}")
    RESULTS["oklch_count"] = len(oklch_vars)

    browser.close()

    # ──────────────────────────────────────────────
    # 최종 요약
    # ──────────────────────────────────────────────
    print("\n" + "="*55)
    print("QA 결과 요약")
    print("="*55)
    for k, v in RESULTS.items():
        print(f"  {k}: {v}")
    print("="*55)
