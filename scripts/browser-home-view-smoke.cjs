// Run against a disposable production server, with Playwright available.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5190';
(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    const page = await context.newPage(), requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.goto(base + '/');
    await page.getByRole('heading', {name: 'Pick a sport', exact: true}).waitFor();
    assert.equal(await page.getByRole('radio', {name: 'Classic', exact: true}).isChecked(), true);
    assert.equal(requests.some(url => /\/island\/|\/Island(?:Home|Landing|Motion|Scenery)[-.]/.test(url)), false);
    const classic = page.getByRole('radio', {name: 'Classic', exact: true});
    const island = page.getByRole('radio', {name: 'Island', exact: true});
    await classic.focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('link', {name: 'Play', exact: true}).waitFor();
    assert.equal(await island.evaluate(input => input === document.activeElement), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('wee:home-view:v1')), 'island');
    await page.getByRole('link', {name: 'Play', exact: true}).click();
    await page.getByRole('heading', {name: 'Choose a sport', exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Play: Tennis', exact: true}).count(), 1);
    assert.equal(await page.getByRole('button', {name: 'Play: Bowling', exact: true}).count(), 1);
    assert.equal(await page.getByText('Table Tennis', {exact: true}).count(), 0);
    assert.equal(await page.locator('.island-motion[data-ready="true"]').count(), 0);
    const top = await page.locator('.home-header').boundingBox();
    const title = await page.getByRole('heading', {name: 'Choose a sport', exact: true}).boundingBox();
    assert.ok(top.y + top.height < title.y, 'map title clears the shared header');
    await page.goto(base + '/home'); await page.getByRole('heading', {name: 'Choose a sport', exact: true}).waitFor();
    await page.reload(); await page.getByRole('heading', {name: 'Choose a sport', exact: true}).waitFor();
    assert.equal(await island.isChecked(), true);
    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    await page.getByRole('button', {name: 'Join a game', exact: true}).click();
    await page.getByRole('textbox', {name: 'Lobby code', exact: true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', {name: 'Menu', exact: true}).evaluate(button => button === document.activeElement), true);
    // React Router commits the URL/view transition asynchronously. Check the resulting view.
    await classic.click(); await page.getByRole('heading', {name: 'Pick a sport', exact: true}).waitFor();
    assert.equal(await classic.isChecked(), true);
    assert.equal(await page.locator('.island-screen, .island-motion').count(), 0);
    await page.goto(base + '/home'); await page.getByRole('heading', {name: 'Pick a sport', exact: true}).waitFor();
    await page.goto(base + '/home?view=island');
    for (const width of [390, 768, 1024, 1920]) {
      await page.setViewportSize({width, height: 900});
      await page.getByRole('button', {name: 'Play: Tennis', exact: true}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}`);
      for (const name of ['Classic', 'Island']) {
        const bounds = await page.getByRole('radio', {name, exact: true}).boundingBox();
        assert.ok(bounds.height >= 44 && bounds.width >= 44);
      }
    }
    await page.getByRole('button', {name: /switch to dark/i}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await context.close();

    const blocked = await browser.newContext({viewport: {width: 1280, height: 800}, reducedMotion: 'reduce'});
    await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {get() {throw new Error('Storage unavailable');}}));
    const noStorage = await blocked.newPage(); noStorage.on('pageerror', error => errors.push(error.message));
    await noStorage.goto(base + '/'); await noStorage.getByRole('radio', {name: 'Island', exact: true}).click();
    await noStorage.getByRole('link', {name: 'Play', exact: true}).click();
    await noStorage.reload(); await noStorage.getByRole('heading', {name: 'Choose a sport', exact: true}).waitFor();
    await noStorage.getByRole('radio', {name: 'Classic', exact: true}).click();
    await noStorage.getByRole('heading', {name: 'Pick a sport', exact: true}).waitFor();
    await blocked.close();

    const failedImage = await browser.newContext({viewport: {width: 1280, height: 800}, reducedMotion: 'reduce'});
    await failedImage.route('**/island/homepage.webp*', route => route.abort());
    const fallback = await failedImage.newPage(); fallback.on('pageerror', error => errors.push(error.message));
    await fallback.goto(base + '/home?view=island');
    await fallback.getByText('The island image couldn’t load. The controls are still available.').waitFor();
    await fallback.getByRole('button', {name: 'Play: Bowling', exact: true}).click();
    await fallback.getByTestId('lobby-code').waitFor(); await failedImage.close();

    const failedChunk = await browser.newContext();
    await failedChunk.route('**/assets/IslandHome-*.js', route => route.abort());
    const recovery = await failedChunk.newPage();
    await recovery.goto(base + '/home?view=island');
    await recovery.getByRole('heading', {name: 'The island couldn’t load', exact: true}).waitFor();
    await recovery.getByRole('radio', {name: 'Classic', exact: true}).click();
    await recovery.getByRole('button', {name: 'Play: Tennis', exact: true}).click();
    await recovery.getByTestId('lobby-code').waitFor(); await failedChunk.close();
    const phoneContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
    const phone = await phoneContext.newPage(); phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(base + '/?view=island');
    await phone.getByRole('heading', {name: 'Ready to play?', exact: true}).waitFor();
    assert.equal(await phone.getByRole('radio', {name: 'Island', exact: true}).count(), 0);
    assert.equal(await phone.locator('.island-screen').count(), 0);
    await phoneContext.close();
    assert.deepEqual(errors, []);
    console.log('PASS: default/lazy Classic, keyboard switch, stored choice, island navigation, menu focus, responsive targets, dark/reduced motion, blocked storage and failed asset recovery');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
