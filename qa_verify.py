from playwright.sync_api import sync_playwright

SHOTS = "/home/user/organt_workspace/p-024-채팅-사이트-with-ai/"

def shot(page, name, msg=""):
    page.screenshot(path=SHOTS + name)
    if msg:
        print(f"[OK] {name}: {msg}")

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])

    # ── 1. Initial Load ──
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("http://localhost:3000/")
    page.wait_for_load_state("networkidle")
    shot(page, "qa_01_initial.png", "initial page loaded")

    # ── 2. Sidebar inspection ──
    sidebar = page.locator(".sidebar, #sidebar, [class*='sidebar'], [class*='channel-list']").first
    print("Sidebar visible:", sidebar.is_visible() if sidebar.count() > 0 else "not found")
    shot(page, "qa_02_sidebar.png", "sidebar state")

    # ── 3. Markdown send ──
    inp = page.locator("textarea").first
    inp.fill("**굵게** _이탤릭_ `코드`\n```js\nconsole.log('hello');\n```")
    shot(page, "qa_03_input_filled.png", "input with markdown")
    # Enter sends
    inp.press("Enter")
    page.wait_for_timeout(1500)
    shot(page, "qa_04_markdown_rendered.png", "markdown rendered")

    # check rendered html
    msgs = page.query_selector_all("[class*='message'], [class*='msg-']")
    print(f"Messages found: {len(msgs)}")
    if msgs:
        last = msgs[-1]
        inner = last.inner_html()
        print("Last msg innerHTML (first 300):", inner[:300])

    # ── 4. Typing indicator test (2nd context) ──
    page2 = browser.new_page(viewport={"width": 1280, "height": 800})
    page2.goto("http://localhost:3000/")
    page2.wait_for_load_state("networkidle")
    inp2 = page2.locator("textarea").first
    inp2.fill("typing from tab 2...")
    page2.wait_for_timeout(600)
    shot(page, "qa_05_typing_indicator.png", "typing indicator from tab1 after tab2 types")
    typing_els = page.query_selector_all("[class*='typing'], [class*='indicator']")
    print(f"Typing indicator elements: {len(typing_els)}")
    if typing_els:
        for el in typing_els:
            print("  typing el:", el.inner_text()[:80])
    page2.close()

    # ── 5. Channel switch + unread badge ──
    # ai-chat 채널 클릭
    ai_link = page.locator("text=ai-chat").first
    ai_count = ai_link.count() if ai_link else 0
    print("ai-chat link count:", ai_count)
    if ai_count:
        ai_link.click()
        page.wait_for_timeout(600)
        shot(page, "qa_06_ai_channel.png", "ai-chat channel")

    # General 채널로 돌아가 배지 확인
    gen_link = page.locator("text=general").first
    if gen_link.count():
        gen_link.click()
        page.wait_for_timeout(400)

    # @AI mention
    inp = page.locator("textarea").first
    inp.fill("@AI 테스트입니다")
    inp.press("Enter")
    page.wait_for_timeout(3000)
    shot(page, "qa_07_at_ai_response.png", "@AI mention response")

    ai_bubbles = page.query_selector_all("[class*='ai'], [class*='bot'], [class*='assistant']")
    print(f"AI bubble elements: {len(ai_bubbles)}")

    # ── 6. Summary panel ──
    summary_sel = "button:has-text('요약'), button:has-text('Summary'), button:has-text('대화 요약'), #summary-btn, [data-action='summary']"
    sb = page.locator(summary_sel).first
    print("Summary button found:", sb.count() > 0)
    if sb.count() > 0:
        sb.click()
        page.wait_for_timeout(1500)
        shot(page, "qa_08_summary_panel.png", "summary panel open")
        panel = page.query_selector_all("[class*='summary'], [class*='side'], #summary-panel")
        print(f"Summary panel elements: {len(panel)}")
        if panel:
            print("Panel text:", panel[0].inner_text()[:200])
    else:
        shot(page, "qa_08_no_summary.png", "summary button NOT found")

    # ── 7. Tone badges ──
    badges = page.query_selector_all("[class*='tone'], [class*='grade'], [class*='badge'][class*='pos'], [class*='badge'][class*='neg']")
    print(f"Tone badge elements found: {len(badges)}")
    for b in badges[:5]:
        print("  badge:", b.inner_text()[:40], "class:", b.get_attribute("class"))

    shot(page, "qa_09_tone_badges.png", "tone badges")

    # ── 8. Unread badge after sending to other channel ──
    # Send msg to ai-chat while on general
    ai_link2 = page.locator("text=ai-chat").first
    if ai_link2.count():
        ai_link2.click()
        page.wait_for_timeout(300)
        inp_ai = page.locator("textarea").first
        inp_ai.fill("badge test message")
        inp_ai.press("Enter")
        page.wait_for_timeout(400)
        # switch to general and check sidebar
        gen_link2 = page.locator("text=general").first
        if gen_link2.count():
            gen_link2.click()
            page.wait_for_timeout(400)
        shot(page, "qa_10_unread_badge.png", "unread badge on ai-chat after switching to general")
        unread_badges = page.query_selector_all("[class*='badge'], [class*='unread'], [class*='count']")
        print(f"Unread badge elements: {len(unread_badges)}")
        for ub in unread_badges[:5]:
            print("  unread:", ub.inner_text()[:30], "class:", ub.get_attribute("class"))

    # ── 9. Mobile 375px ──
    mob = browser.new_page(viewport={"width": 375, "height": 667})
    mob.goto("http://localhost:3000/")
    mob.wait_for_load_state("networkidle")
    shot(mob, "qa_11_mobile_375.png", "mobile 375px initial")
    # Check sidebar toggle
    toggle = mob.locator("[class*='toggle'], [class*='hamburger'], button[aria-label*='menu'], button[aria-label*='채널']").first
    print("Mobile toggle button found:", toggle.count() > 0)
    mob_inp = mob.locator("textarea").first
    mob_inp.fill("모바일 메시지 테스트")
    mob_inp.press("Enter")
    mob.wait_for_timeout(800)
    shot(mob, "qa_12_mobile_sent.png", "mobile message sent")
    mob.close()

    browser.close()
    print("=== All done ===")
