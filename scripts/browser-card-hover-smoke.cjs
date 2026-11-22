// Regression: a transformed stretched button used to collapse its full-card
// hit area every frame. Run against a disposable production server.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5199';

async function stableHover(page, card, point) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const initial = await card.boundingBox();
  await page.mouse.move(initial.x + initial.width * point[0], initial.y + initial.height * point[1]);
  const frames = await card.evaluate(element => new Promise(resolve => {
    const started = performance.now(), samples = [];
    const tick = () => {
      const button = element.querySelector('button'), box = element.getBoundingClientRect();
      const hitArea = getComputedStyle(button, '::after');
      samples.push({hover: button.matches(':hover'), x: box.x, y: box.y,
        width: Number.parseFloat(hitArea.width), height: Number.parseFloat(hitArea.height),
        expectedWidth: element.clientWidth, expectedHeight: element.clientHeight});
      if (performance.now() - started < 500) requestAnimationFrame(tick);
      else resolve(samples);
    };
    requestAnimationFrame(tick);
  }));
  assert.ok(frames.length >= 5, 'observe several real hover frames');
  for (const frame of frames) {
    assert.equal(frame.hover, true, 'stationary pointer must remain on the action');
    assert.ok(Math.abs(frame.x - initial.x) < .1 && Math.abs(frame.y - initial.y) < .1, 'card never moves out from under the pointer');
    assert.ok(Math.abs(frame.width - frame.expectedWidth) < 1 && Math.abs(frame.height - frame.expectedHeight) < 1,
      'action hit area stays the size of the card');
  }
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox']});
  const errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/home?view=classic');
    await page.getByRole('button', {name: 'Play: Tennis', exact: true}).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const name of ['Tennis', 'Bowling']) {
      const button = page.getByRole('button', {name: `Play: ${name}`, exact: true});
      const card = page.locator('.tile').filter({has: button});
      await card.scrollIntoViewIfNeeded();
      for (const point of [[.5, .1], [.5, .5], [.5, .9], [.5, .99]]) await stableHover(page, card, point);
      await button.focus();
      assert.equal(await card.evaluate(element => element.matches(':focus-within')), true);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(250);
      const focused = await card.evaluate(element => ({border: getComputedStyle(element).borderColor,
        accent: getComputedStyle(element).getPropertyValue('--accent').trim(), transform: getComputedStyle(element).transform}));
      assert.equal(focused.transform, 'none');
      assert.ok(focused.border && focused.accent);
      await button.evaluate(element => element.blur());
    }
    await page.emulateMedia({reducedMotion: 'reduce'});
    const tennis = page.locator('.tile').filter({has: page.getByRole('button', {name: 'Play: Tennis', exact: true})});
    await stableHover(page, tennis, [.5, .1]);
    assert.equal(await tennis.locator('.tile__icon').evaluate(element => getComputedStyle(element).transform), 'none');
    await page.emulateMedia({reducedMotion: 'no-preference'});
    // The artwork remains an actual activation target, including while pressed.
    const box = await tennis.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    const pressed = await tennis.evaluate(element => ({height: Number.parseFloat(getComputedStyle(element.querySelector('button'), '::after').height), expected: element.clientHeight}));
    assert.ok(Math.abs(pressed.height - pressed.expected) < 1, 'pressing artwork preserves the action hit area');
    await page.mouse.up();
    await page.getByTestId('lobby-code').waitFor();
    await context.close();

    const keyboardContext = await browser.newContext({viewport: {width: 1280, height: 900}});
    const keyboard = await keyboardContext.newPage(); keyboard.on('pageerror', error => errors.push(error.message));
    await keyboard.goto(base + '/home?view=classic');
    const bowling = keyboard.getByRole('button', {name: 'Play: Bowling', exact: true});
    await bowling.focus(); await keyboard.keyboard.press('Enter');
    await keyboard.getByTestId('lobby-code').waitFor();
    await keyboardContext.close();

    // A disconnected page must keep both actions disabled and non-interactive.
    const offlineContext = await browser.newContext({viewport: {width: 1280, height: 900}});
    await offlineContext.route('**/socket.io/**', route => route.abort());
    await offlineContext.routeWebSocket('**/socket.io/**', socket => socket.close());
    const offline = await offlineContext.newPage(); offline.on('pageerror', error => errors.push(error.message));
    await offline.goto(base + '/home?view=classic');
    const disabled = offline.locator('.tile[data-open="true"]');
    await disabled.first().waitFor();
    assert.equal(await disabled.count(), 2);
    for (const card of await disabled.all()) {
      assert.equal(await card.locator('button').isDisabled(), true);
      assert.equal(await card.getAttribute('data-interactive'), 'false');
      const initial = await card.boundingBox();
      await card.hover(); await offline.waitForTimeout(250);
      assert.equal(await card.evaluate(element => getComputedStyle(element).transform), 'none');
      await offline.mouse.click(initial.x + initial.width / 2, initial.y + 30);
      assert.equal(new URL(offline.url()).pathname, '/home');
    }
    assert.equal(await offline.locator('.tile[data-open="false"] button').count(), 0);
    await offlineContext.close();
    assert.deepEqual(errors, []);
    console.log('PASS: stable art/text/button/edge hover, full-card press, keyboard launch, reduced motion and disabled states');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
