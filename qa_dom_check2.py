from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("http://localhost:3000/")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)

    # Find all input/textarea/contenteditable
    els = page.query_selector_all("input, textarea, [contenteditable='true'], [contenteditable='']")
    print(f"Input elements: {len(els)}")
    for el in els:
        tag = el.evaluate("e => e.tagName")
        cls = el.get_attribute("class") or ""
        pid = el.get_attribute("id") or ""
        ph = el.get_attribute("placeholder") or ""
        ce = el.get_attribute("contenteditable") or ""
        print(f"  <{tag}> id={pid!r} class={cls!r} placeholder={ph!r} contenteditable={ce!r}")

    # Find all buttons
    btns = page.query_selector_all("button")
    print(f"\nAll buttons ({len(btns)}):")
    for b in btns:
        txt = (b.inner_text() or "").strip()[:50]
        cls = (b.get_attribute("class") or "")[:60]
        bid = b.get_attribute("id") or ""
        print(f"  [{bid}] cls={cls!r} txt={txt!r}")

    # Channel items
    chs = page.query_selector_all(".channel-item")
    print(f"\nChannel items: {len(chs)}")
    for c in chs:
        txt = (c.inner_text() or "").strip()[:40]
        active = "channel-item--active" in (c.get_attribute("class") or "")
        cid = c.get_attribute("data-channel-id") or ""
        print(f"  id={cid!r} active={active} txt={txt!r}")

    browser.close()
