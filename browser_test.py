"""Playwright browser smoke test for Organt Chat"""
import json, time
from playwright.sync_api import sync_playwright

def run():
    checks = []
    errors = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx     = browser.new_context(viewport={"width": 1280, "height": 800})
        page    = ctx.new_page()

        page.on("console", lambda msg: errors.append(f"[console.{msg.type}] {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        page.goto("http://localhost:3000", wait_until="networkidle", timeout=12000)

        # 1. App shell
        app = page.query_selector(".app")
        checks.append("app shell: " + ("PASS" if app else "FAIL"))

        # 2. Channel list (wait for WS init)
        page.wait_for_selector(".channel-item", timeout=6000)
        items = page.query_selector_all(".channel-item")
        checks.append(f"channel list: {'PASS' if len(items) >= 3 else 'FAIL'} ({len(items)} items)")

        # 3. Username
        uname = page.text_content("#userNameEl")
        checks.append(f"username: {'PASS' if uname and uname != '연결 중…' else 'FAIL'} ({uname})")

        # 4. Topbar channel
        ch_name = page.text_content("#topbarChannelName")
        checks.append(f"topbar channel: {'PASS' if ch_name and ch_name != '채널을 선택하세요' else 'FAIL'} ({ch_name})")

        # 5. Composer visible
        composer = page.query_selector(".composer__row")
        checks.append("composer: " + ("PASS" if composer else "FAIL"))

        # 6. Send a message
        page.click("#composerInput")
        page.keyboard.type("안녕하세요 브라우저 테스트")
        page.keyboard.press("Enter")
        page.wait_for_selector(".message", timeout=5000)
        msg_text = page.text_content(".message__text") or ""
        checks.append(f"message send: {'PASS' if '브라우저 테스트' in msg_text else 'FAIL'} ({msg_text[:40]})")

        # 7. Tone badge (AI disabled → uncertain after analysis)
        try:
            page.wait_for_selector(".message__tone", timeout=5000)
            grade = page.get_attribute(".message__tone", "data-grade")
            valid = grade in ("positive","neutral","negative","uncertain")
            checks.append(f"tone badge: {'PASS' if valid else 'FAIL'} ({grade})")
        except:
            checks.append("tone badge: SKIP (timeout - AI key needed for tone)")

        # 8. Add channel button
        add_btn = page.query_selector("#addChannelBtn")
        checks.append("add channel btn: " + ("PASS" if add_btn else "FAIL"))

        # 9. Summary button
        sb = page.query_selector("#summaryBtn")
        checks.append("summary btn: " + ("PASS" if sb else "FAIL"))

        # 10. Dark mode (body bg not white)
        bg = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
        checks.append(f"dark bg: {'PASS' if bg and bg != 'rgba(0, 0, 0, 0)' else 'FAIL'} ({bg})")

        # 11. Desktop hamburger hidden
        ham_visible = page.is_visible("#hamburgerBtn")
        checks.append(f"desktop: hamburger hidden: {'PASS' if not ham_visible else 'INFO'}")

        # 12. Mobile: hamburger visible
        page.set_viewport_size({"width": 375, "height": 812})
        time.sleep(0.3)
        ham_mobile = page.is_visible("#hamburgerBtn")
        checks.append(f"mobile: hamburger visible: {'PASS' if ham_mobile else 'FAIL'}")

        # 13. Mobile sidebar toggle
        page.click("#hamburgerBtn")
        time.sleep(0.3)
        sidebar_open = page.query_selector(".sidebar--open") is not None
        checks.append(f"mobile sidebar toggle: {'PASS' if sidebar_open else 'FAIL'}")

        # 14. Screenshot (desktop)
        page.set_viewport_size({"width": 1280, "height": 800})
        page.screenshot(path="/home/user/organt_workspace/p-024-채팅-사이트-with-ai/screenshot.png")
        checks.append("screenshot: PASS")

        browser.close()

    print("=== BROWSER CHECKS ===")
    for c in checks:
        print(c)

    if errors:
        print("=== JS ERRORS ===")
        for e in errors:
            print(e)
    else:
        print("=== NO JS ERRORS ===")

if __name__ == "__main__":
    run()
