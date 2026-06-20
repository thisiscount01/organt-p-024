"""
독립 QA 검증 스크립트 — 디자이너 관점
실제 Playwright로 브라우저를 구동해 7가지 수용기준을 체크
"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:3000"
SHOTS = "/home/user/organt_workspace/p-024-채팅-사이트-with-ai/"

def s(page, name, note=""):
    path = SHOTS + name
    page.screenshot(path=path)
    print(f"  📸 {name}" + (f" — {note}" if note else ""))
    return path

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    # ═══════════════════════════════════════════════════
    # 0. 앱 로드 + 초기 상태
    # ═══════════════════════════════════════════════════
    print("\n[0] 앱 초기 로드")
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(800)
    s(page, "qa_00_initial.png", "초기 화면")

    # ═══════════════════════════════════════════════════
    # 1. 마크다운 렌더링 (bold/italic/code/codeblock)
    # ═══════════════════════════════════════════════════
    print("\n[1] 마크다운 렌더링 검증")
    inp = page.locator("#composerInput")
    inp.click()
    inp.fill("")
    page.keyboard.type("**굵게** _이탤릭_ `인라인코드`")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("```js")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("console.log('hello world');")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("```")
    s(page, "qa_01_before_send.png", "전송 전 입력 상태")

    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    s(page, "qa_02_markdown_rendered.png", "마크다운 렌더링 후")

    # 실제 렌더링된 HTML 검사
    msgs = page.query_selector_all(".message, [class*='message__']")
    print(f"  메시지 수: {len(msgs)}")
    if msgs:
        last_html = msgs[-1].inner_html()
        has_strong = "<strong>" in last_html or "<b>" in last_html
        has_em = "<em>" in last_html or "<i>" in last_html
        has_code = "<code>" in last_html
        has_pre = "<pre>" in last_html
        print(f"  <strong>: {has_strong}, <em>: {has_em}, <code>: {has_code}, <pre>: {has_pre}")
        print(f"  HTML(300): {last_html[:300]}")

    # ═══════════════════════════════════════════════════
    # 2. Tone badge 확인
    # ═══════════════════════════════════════════════════
    print("\n[2] Tone badge 시각적 검증")
    # 메시지 영역에서 badge 찾기
    badges = page.query_selector_all("[class*='tone'], [class*='grade'], [class*='badge']")
    print(f"  배지 요소 수: {len(badges)}")
    for b in badges[:8]:
        cls = b.get_attribute("class") or ""
        txt = (b.inner_text() or "").strip()[:30]
        print(f"    class={cls!r} txt={txt!r}")

    # 메시지 컨테이너에서 data 속성 확인
    msgs_all = page.query_selector_all("[data-tone], [data-grade]")
    print(f"  data-tone/grade 요소: {len(msgs_all)}")

    s(page, "qa_03_tone_badges.png", "tone badge 영역")

    # ═══════════════════════════════════════════════════
    # 3. 타이핑 인디케이터 (두 번째 탭에서 입력)
    # ═══════════════════════════════════════════════════
    print("\n[3] 타이핑 인디케이터 검증")
    page2 = browser.new_page(viewport={"width": 1280, "height": 800})
    page2.goto(BASE)
    page2.wait_for_load_state("networkidle")
    page2.wait_for_timeout(500)

    inp2 = page2.locator("#composerInput")
    inp2.click()
    page2.keyboard.type("typing indicator test...")
    page2.wait_for_timeout(600)

    # tab1에서 인디케이터 확인
    typing_els = page.query_selector_all("[class*='typing']")
    print(f"  타이핑 인디케이터 요소: {len(typing_els)}")
    for te in typing_els:
        cls = te.get_attribute("class") or ""
        txt = (te.inner_text() or "").strip()
        vis = te.is_visible()
        print(f"    class={cls!r} txt={txt!r} visible={vis}")
    s(page, "qa_04_typing_indicator.png", "타이핑 인디케이터 (tab1 시점)")

    page2.close()
    page.wait_for_timeout(600)
    s(page, "qa_04b_typing_gone.png", "타이핑 사라진 후")

    # ═══════════════════════════════════════════════════
    # 4. 다른 채널 메시지 수신 시 사이드바 배지
    # ═══════════════════════════════════════════════════
    print("\n[4] 사이드바 미읽음 배지 검증")
    # page3: ai-chat에 메시지 전송
    page3 = browser.new_page(viewport={"width": 1280, "height": 800})
    page3.goto(BASE)
    page3.wait_for_load_state("networkidle")

    # page3: ai-chat 채널 선택
    page3.locator("[data-channel-id='ai-chat']").click()
    page3.wait_for_timeout(400)
    inp3 = page3.locator("#composerInput")
    inp3.click()
    page3.keyboard.type("다른 채널에서 보내는 메시지!")
    page3.keyboard.press("Enter")
    page3.wait_for_timeout(600)

    # page1(general에 머물며) 사이드바 배지 확인
    unread_els = page.query_selector_all(".channel-item__badge, [class*='unread'], [class*='badge']")
    print(f"  배지 요소 수: {len(unread_els)}")
    for ue in unread_els:
        cls = ue.get_attribute("class") or ""
        txt = (ue.inner_text() or "").strip()
        vis = ue.is_visible()
        print(f"    class={cls!r} txt={txt!r} visible={vis}")
    s(page, "qa_05_unread_badge.png", "사이드바 미읽음 배지")
    page3.close()

    # ═══════════════════════════════════════════════════
    # 5. 요약 사이드패널
    # ═══════════════════════════════════════════════════
    print("\n[5] 요약 사이드패널 검증")
    summary_btn = page.locator("#summaryBtn")
    print(f"  요약 버튼 visible: {summary_btn.is_visible()}")
    summary_btn.click()
    page.wait_for_timeout(2000)
    s(page, "qa_06_summary_panel.png", "요약 패널 열린 후")

    panel = page.locator("#summaryPanel, .summary-panel")
    print(f"  패널 visible: {panel.is_visible()}")
    if panel.is_visible():
        panel_text = panel.inner_text()[:300]
        print(f"  패널 내용: {panel_text!r}")

    # 패널 닫기
    close_btn = page.locator("#summaryCloseBtn")
    if close_btn.is_visible():
        close_btn.click()
        page.wait_for_timeout(300)

    # ═══════════════════════════════════════════════════
    # 6. iPhone SE 375px 모바일
    # ═══════════════════════════════════════════════════
    print("\n[6] iPhone SE (375px) 모바일 검증")
    mob = browser.new_page(viewport={"width": 375, "height": 667})
    mob.goto(BASE)
    mob.wait_for_load_state("networkidle")
    mob.wait_for_timeout(600)
    s(mob, "qa_07_mobile_initial.png", "모바일 초기")

    # 햄버거 버튼
    ham = mob.locator("#hamburgerBtn")
    print(f"  햄버거 버튼 visible: {ham.is_visible()}")

    # 사이드바 상태 (모바일에서 기본 숨김인지)
    sidebar = mob.locator("#sidebar, .sidebar")
    sidebar_vis = sidebar.is_visible()
    print(f"  사이드바 초기 visible (모바일): {sidebar_vis}")

    # 햄버거 클릭 → 사이드바 열기
    if ham.is_visible():
        ham.click()
        mob.wait_for_timeout(400)
        s(mob, "qa_07b_mobile_sidebar_open.png", "모바일 사이드바 열린 후")
        print(f"  사이드바 visible 후 클릭: {sidebar.is_visible()}")
        # 닫기
        mob.locator("#sidebarCloseBtn").click()
        mob.wait_for_timeout(300)

    # 메시지 입력·전송
    mob_inp = mob.locator("#composerInput")
    mob_inp.click()
    mob.keyboard.type("모바일 메시지 테스트 375px")
    s(mob, "qa_08_mobile_input.png", "모바일 입력 상태")
    mob.keyboard.press("Enter")
    mob.wait_for_timeout(800)
    s(mob, "qa_09_mobile_sent.png", "모바일 메시지 전송 후")

    # 입력창이 화면 아래에 가려지진 않는지
    comp = mob.locator(".composer, #composer")
    comp_box = comp.bounding_box()
    print(f"  Composer 위치 (375px): {comp_box}")

    mob.close()

    # ═══════════════════════════════════════════════════
    # 7. @AI 멘션 (API key 없으므로 오류 처리 UI 확인)
    # ═══════════════════════════════════════════════════
    print("\n[7] @AI 멘션 / AI 응답 UI 검증")
    inp = page.locator("#composerInput")
    inp.click()
    page.keyboard.type("@AI 안녕하세요, 간단히 답해주세요")
    page.keyboard.press("Enter")
    page.wait_for_timeout(3000)
    s(page, "qa_10_at_ai.png", "@AI 멘션 응답 후")

    ai_bubbles = page.query_selector_all(".message--ai, [class*='ai-message'], [data-author='AI'], [data-type='ai']")
    print(f"  AI 버블 요소: {len(ai_bubbles)}")
    for ab in ai_bubbles[:3]:
        cls = ab.get_attribute("class") or ""
        txt = (ab.inner_text() or "").strip()[:100]
        print(f"    class={cls!r} txt={txt!r}")

    # ═══════════════════════════════════════════════════
    # 7b. 전체 완성도 — 다크모드 기본 확인
    # ═══════════════════════════════════════════════════
    print("\n[7b] 다크모드 기본 + 전체 완성도")
    # data-theme 확인
    html_el = page.locator("html, body")
    theme = page.evaluate("() => document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme') || 'not found'")
    print(f"  data-theme: {theme!r}")
    bg_color = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
    print(f"  body background-color: {bg_color!r}")
    s(page, "qa_11_final_overview.png", "최종 전체 화면")

    # oklch 토큰 확인
    oklch_count = page.evaluate("""
        () => {
            const sheets = [...document.styleSheets];
            let count = 0;
            for (const s of sheets) {
                try {
                    for (const r of s.cssRules) {
                        if (r.cssText && r.cssText.includes('oklch')) count++;
                    }
                } catch(e) {}
            }
            return count;
        }
    """)
    print(f"  oklch CSS 규칙 수: {oklch_count}")

    # CSS 변수 확인
    css_vars = page.evaluate("""
        () => {
            const root = getComputedStyle(document.documentElement);
            const vars = [];
            for (const s of document.styleSheets) {
                try {
                    for (const r of s.cssRules) {
                        if (r.selectorText === ':root') {
                            const txt = r.cssText;
                            const matches = txt.match(/--[\w-]+/g);
                            if (matches) vars.push(...matches);
                        }
                    }
                } catch(e) {}
            }
            return vars.slice(0, 30);
        }
    """)
    print(f"  CSS vars (첫 30개): {css_vars}")

    browser.close()
    print("\n=== QA 완료 ===")
