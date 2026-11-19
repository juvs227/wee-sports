// Run against a disposable built server. Requires Playwright and Chromium.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5190';
const recovery = process.env.WEE_SMOKE_RECOVERY === '1';
const profiles = process.env.WEE_SMOKE_PROFILES === '1';
(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const errors = [];
  try {
    for (const sport of ['Bowling', 'Tennis']) {
      const tvContext = await browser.newContext({viewport: {width: 1280, height: 900}});
      const phoneContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
      await phoneContext.addInitScript(() => {
        Object.defineProperty(window, 'DeviceMotionEvent', {configurable: true, value: undefined});
        Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true, value: undefined});
      });
      const tv = await tvContext.newPage(), phone = await phoneContext.newPage();
      for (const page of [tv, phone]) page.on('pageerror', error => errors.push(error.message));
      await phone.goto(base + '/');
      await phone.getByRole('heading', {name: 'Ready to play?', exact: true}).waitFor();
      assert.equal(await phone.locator('[data-display-role="remote"]').count(), 1);
      await tv.goto(base + '/');
      await tv.getByRole('heading', {name: 'Pick a sport', exact: true}).waitFor();
      assert.equal(await tv.locator('.tile[data-open="true"]').count(), 2);
      await tv.getByRole('button', {name: `Play: ${sport}`, exact: true}).click();
      const code = await tv.getByTestId('lobby-code').innerText();
      await phone.goto(base + '/join?code=' + code);
      await phone.getByLabel('Your playing name', {exact: true}).fill('Split test');
      await phone.getByRole('button', {name: 'Play', exact: true}).click();
      await phone.getByRole('button', {name: 'Start game', exact: true}).click();
      await phone.getByRole('button', {name: 'Start now', exact: true}).click();
      const controller = phone.frameLocator(`iframe[title="${sport} phone controller"]`);
      const game = tv.frameLocator(`iframe[title="${sport} game"]`);
      await game.locator('canvas').waitFor({timeout: 20000});
      if (sport === 'Bowling') {
        await controller.getByRole('button', {name: 'Roll', exact: true}).click();
        await controller.getByText('Watch the lane', {exact: true}).waitFor({timeout: 5000});
        await game.locator('body').getByText(/Frame 1 \/ 10 · Ball 2|Frame 2 \/ 10/).waitFor({timeout: 30000});
        if (recovery) {
          const state = await game.locator('#frame-label').innerText();
          await tv.reload();
          await tv.getByRole('heading', {name: 'Your game is still here', exact: true}).waitFor();
          await tv.getByRole('button', {name: 'Continue game', exact: true}).click();
          await game.locator('canvas').waitFor({timeout: 20000});
          await game.locator('#frame-label').filter({hasText: state}).waitFor({timeout: 15000});
        }
      } else {
        const frame = tv.frames().find(value => value.url().includes('/game.html'));
        await frame.evaluate(() => {
          window.__splitSwings = [];
          window.addEventListener('message', event => {if (event.data?.type === 'wee:game-swing') window.__splitSwings.push(event.data.event);});
        });
        await controller.locator('#forehand').click();
        await frame.waitForFunction(() => window.__splitSwings.length === 1, null, {timeout: 10000});
        assert.equal(await frame.evaluate(() => window.__splitSwings[0].label), 'Forehand');
      }
      console.log(`PASS ${sport}: card home, phone home, guest join, automatic touch setup, start, authenticated input${recovery && sport === 'Bowling' ? ', TV checkpoint recovery' : ''}`);
      await tvContext.close(); await phoneContext.close();
    }
    for (const path of ['/table-tennis.html', '/table-tennis-controller.html', '/island/homepage.webp']) {
      const response = await fetch(base + path);
      if (profiles || !path.endsWith('.html')) assert.equal(response.status, 404, `${path} must not be served`);
      else if (response.status === 200) assert.match(await response.text(), /id="root"/, 'older preview servers may return only the generic SPA fallback');
      else assert.equal(response.status, 404);
    }
    if (profiles) {
      const username = 'split_' + Date.now();
      const response = await fetch(base + '/api/profile/register', {method: 'POST',
        headers: {'content-type': 'application/json', 'x-wee-client': 'native'},
        body: JSON.stringify({username, password: 'local-smoke-only-passphrase', displayName: 'Split test'})});
      assert.equal(response.status, 201);
      const account = await response.json(); assert.ok(account.token);
      const result = await fetch(base + '/api/profile/history', {headers: {authorization: 'Bearer ' + account.token}});
      assert.equal(result.status, 200); assert.deepEqual((await result.json()).history, []);
      console.log('PASS optional native profile registration and authenticated history on disposable storage');
    }
    assert.deepEqual(errors, []); console.log('PASS no browser exceptions; excluded game entries and artwork are absent');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
