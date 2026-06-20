from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("http://localhost:3000/")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)

    # screenshot
    page.screenshot(path="/home/user/organt_workspace/p-024-채팅-사이트-with-ai/qa_dom_01.png")

    # all input-like elements
    els = page.query_selector_all("input, textarea, [contenteditable]")
    print(f"Input elements: {len(els)}")
    for el in els:
        tag = el.evaluate("e => e.tagName")
        cls = el.get_attribute("class") or ""
        pid = el.get_attribute("id") or ""
        ph = el.get_attribute("placeholder") or ""
        print(f"  <{tag}> id={pid!r} class={cls!r} placeholder={ph!r}")

    # all buttons
    btns = page.query_selector_all("button")
    print(f"\nButtons: {len(btns)}")
    for b in btns[:20]:
        txt = (b.inner_text() or "")[:40]
        cls = (b.get_attribute("class") or "")[:40]
        bid = b.get_attribute("id") or ""
        print(f"  btn id={bid!r} class={cls!r} text={txt!r}")

    # sidebar / channel list
    ch_els = page.query_selector_all("[class*='channel'], [class*='sidebar'], [class*='nav']")
    print(f"\nChannel/Sidebar elements: {len(ch_els)}")
    for c in ch_els[:10]:
        cls = (c.get_attribute("class") or "")[:60]
        txt = (c.inner_text() or "")[:80]
        print(f"  class={cls!r} text={txt!r}")

    # dump first 3000 chars of body HTML
    print("\n--- HTML preview ---")
    print(page.content()[:3000])

    browser.close()
