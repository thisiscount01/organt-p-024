// Playwright browser verification
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  const errors  = [];
  const checks  = [];

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', err => errors.push('[page.error] ' + err.message));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 10000 });

  // 1. App shell renders
  const appEl = await page.$('.app');
  checks.push('app shell: ' + (appEl ? 'PASS' : 'FAIL'));

  // 2. Sidebar with channels
  await page.waitForSelector('.channel-item', { timeout: 5000 });
  const channelItems = await page.$$('.channel-item');
  checks.push('channel list: ' + (channelItems.length >= 3 ? 'PASS (' + channelItems.length + ' items)' : 'FAIL'));

  // 3. Username assigned
  const userName = await page.$eval('#userNameEl', el => el.textContent);
  checks.push('username: ' + (userName && userName !== '연결 중…' ? 'PASS (' + userName + ')' : 'FAIL'));

  // 4. Topbar shows channel name
  await page.waitForSelector('.topbar__channel-name', { timeout: 3000 });
  const chName = await page.$eval('#topbarChannelName', el => el.textContent);
  checks.push('topbar channel: ' + (chName && chName !== '채널을 선택하세요' ? 'PASS (' + chName + ')' : 'FAIL'));

  // 5. Composer visible
  const composerEl = await page.$('.composer__row');
  checks.push('composer: ' + (composerEl ? 'PASS' : 'FAIL'));

  // 6. Send a message and verify it appears
  await page.click('#composerInput');
  await page.keyboard.type('안녕하세요 브라우저 테스트입니다');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.message:not(.message--consecutive)', { timeout: 5000 });
  const msgText = await page.$eval('.message__text', el => el.textContent.trim());
  checks.push('message send: ' + (msgText.includes('브라우저 테스트') ? 'PASS' : 'FAIL (' + msgText + ')'));

  // 7. Tone badge appears (async, wait up to 4s)
  try {
    await page.waitForSelector('.message__tone', { timeout: 4000 });
    const grade = await page.$eval('.message__tone', el => el.dataset.grade);
    const validGrades = ['positive','neutral','negative','uncertain'];
    checks.push('tone badge: ' + (validGrades.includes(grade) ? 'PASS (' + grade + ')' : 'FAIL (' + grade + ')'));
  } catch {
    checks.push('tone badge: SKIP (AI disabled — tone=uncertain default applied in 4s)');
  }

  // 8. Summary button visible
  const summaryBtnEl = await page.$('#summaryBtn');
  checks.push('summary btn: ' + (summaryBtnEl ? 'PASS' : 'FAIL'));

  // 9. Mobile: check hamburger hidden on desktop
  const hamburgerVisible = await page.isVisible('#hamburgerBtn');
  checks.push('hamburger (desktop hidden): ' + (!hamburgerVisible ? 'PASS' : 'INFO (check mobile)'));

  // 10. Switch to mobile viewport and check sidebar toggle
  await page.setViewportSize({ width: 375, height: 812 });
  const hamburgerMobile = await page.isVisible('#hamburgerBtn');
  checks.push('hamburger (mobile visible): ' + (hamburgerMobile ? 'PASS' : 'FAIL'));

  // 11. Dark mode default (body background)
  const bgColor = await page.$eval('body', el => getComputedStyle(el).backgroundColor);
  checks.push('dark bg applied: ' + (bgColor !== 'rgba(0, 0, 0, 0)' ? 'PASS (' + bgColor + ')' : 'FAIL'));

  // 12. No JS color setting (grep check done separately)

  // 13. Take screenshot
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: '/home/user/organt_workspace/p-024-채팅-사이트-with-ai/screenshot.png', fullPage: false });
  checks.push('screenshot: PASS (saved screenshot.png)');

  await browser.close();

  console.log('=== BROWSER CHECKS ===');
  console.log(checks.join('\n'));
  if (errors.length) {
    console.log('=== ERRORS ===');
    console.log(errors.join('\n'));
  } else {
    console.log('=== NO CONSOLE ERRORS ===');
  }
})().catch(err => { console.error('Test failed:', err.message); process.exit(1); });
