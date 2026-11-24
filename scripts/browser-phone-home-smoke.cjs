// Real browser navigation + Socket.IO room ownership, without fake durable rooms.
const {chromium} = require('playwright');
const {io} = require('socket.io-client');
const assert = require('node:assert/strict');
const {mkdirSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5252';
const phoneOptions = {
  viewport: {width: 390, height: 844},
  colorScheme: 'dark',
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, check, message) {
  for (let i = 0; i < 60; i++) {
    const value = await read();
    if (check(value)) return value;
    await pause(50);
  }
  throw new Error(message);
}

(async () => {
  const {EVENTS, PROTOCOL_VERSION: v} = await import('../shared/protocol.js');
  const browser = await chromium.launch({
    executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const host = io(base, {transports: ['websocket'], reconnection: false});
  const req = (event, payload) =>
    new Promise((resolve, reject) =>
      host
        .timeout(3000)
        .emit(event, payload, (error, result) =>
          error ? reject(error) : resolve(result),
        ),
    );
  const checks = [],
    errors = [];
  const capture = async (page, name) => {
    if (process.env.WEE_SMOKE_SCREENSHOTS) {
      mkdirSync(process.env.WEE_SMOKE_SCREENSHOTS, {recursive: true});
      await page.screenshot({
        path: join(process.env.WEE_SMOKE_SCREENSHOTS, name + '.png'),
        fullPage: true,
        animations: 'disabled',
      });
    }
  };
  const pass = message => {
    checks.push(message);
    console.log('PASS:', message);
  };
  let room;
  const create = async () => {
    room = await req(EVENTS.HOST_CREATE, {v, sport: 'bowling'});
    assert.equal(room.ok, true);
    return room;
  };
  const lobby = () => req(EVENTS.LOBBY_GET, {code: room.code});
  const close = () =>
    req(EVENTS.HOST_CLOSE, {code: room.code, token: room.token});
  try {
    await new Promise((resolve, reject) => {
      host.once('connect', resolve);
      host.once('connect_error', reject);
    });
    const context = await browser.newContext(phoneOptions);
    await context.addInitScript(() => {
      Object.defineProperty(window, 'DeviceMotionEvent', {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(window, 'DeviceOrientationEvent', {
        value: undefined,
        configurable: true,
      });
    });
    const phone = await context.newPage();
    phone.on('pageerror', error => errors.push(error.message));
    const home = () =>
      phone
        .locator('.phone-session__navigation')
        .getByRole('button', {name: 'Go home', exact: true});
    const confirmHome = async () => {
      await home().click();
      await phone
        .getByRole('dialog')
        .getByRole('button', {name: 'Go home', exact: true})
        .click();
      await phone
        .getByRole('heading', {name: 'Ready to play?', exact: true})
        .waitFor();
    };
    const returnLink = () =>
      phone.getByRole('link', {
        name: `Return to room ${room.code}`,
        exact: true,
      });
    const join = async () => {
      await phone.goto(base + '/join?code=' + room.code);
      await phone.getByLabel('Your playing name').fill('Alex');
      await phone.getByRole('button', {name: 'Play', exact: true}).click();
      await phone.locator('.phone-session__navigation').waitFor();
    };

    await create();
    await join();
    await home().click();
    await phone
      .getByRole('dialog')
      .getByRole('button', {name: 'Keep playing', exact: true})
      .click();
    assert.equal((await lobby()).players.length, 1);
    assert.equal(await phone.locator('.phone-session__navigation').count(), 1);
    pass('Cancel Go home preserves the controller and its room seat');

    await confirmHome();
    const exited = await until(
      lobby,
      value => value.players.length === 0,
      'confirmed home must release the seat immediately',
    );
    assert.equal(exited.reconnecting.length, 0);
    assert.equal(await returnLink().count(), 0);
    assert.equal(await phone.locator('iframe').count(), 0);
    assert.equal(
      await phone.evaluate(() => document.activeElement?.tagName),
      'H1',
    );
    await capture(phone, 'phone-confirmed-home');
    await close();
    pass(
      'Confirmed Go home releases the seat without a reconnect grace period',
    );

    await create();
    await join();
    await close();
    await phone
      .getByText('Room closed. Scan the TV to play again.', {exact: true})
      .waitFor();
    assert.equal(await returnLink().count(), 0);
    pass('Closing the TV room sends the phone home and clears its stale seat');

    await create();
    await join();
    // Actual navigation still preserves a temporary reconnect opportunity.
    await phone.goto(base + '/home');
    await returnLink().waitFor();
    await until(
      lobby,
      value => value.reconnecting.some(member => member.name === 'Alex'),
      'unconfirmed navigation reserves the seat',
    );
    await returnLink().click();
    await phone.locator('.you').waitFor();
    await until(
      lobby,
      value => value.reconnecting.length === 0,
      'return restores the same seat',
    );
    await phone.goto(base + '/home');
    await returnLink().waitFor();
    await phone.getByRole('button', {name: 'Leave room', exact: true}).click();
    await phone
      .getByRole('dialog')
      .getByRole('button', {name: 'Go home', exact: true})
      .click();
    await until(
      lobby,
      value => value.players.length === 0,
      'saved-room Leave must release the server seat',
    );
    assert.equal(await returnLink().count(), 0);
    await close();
    pass(
      'Saved-room Leave releases the server seat as well as its local proof',
    );

    await create();
    await join();
    await context.setOffline(true);
    await phone
      .getByText('Reconnecting your controller…', {exact: true})
      .waitFor();
    await context.setOffline(false);
    await until(
      lobby,
      value => value.reconnecting.length === 0,
      'temporary disconnect must recover',
    );
    await until(
      lobby,
      value => value.players.length === 1,
      'reconnect retains the player',
    );
    await context.setOffline(true);
    await phone
      .getByText('Reconnecting your controller…', {exact: true})
      .waitFor();
    await confirmHome();
    assert.equal(await returnLink().count(), 0);
    assert.equal(await phone.locator('iframe').count(), 0);
    await context.setOffline(false);
    await close();
    pass(
      'Temporary drops retain a seat; confirmed offline exit can still leave locally',
    );

    await create();
    const pendingContext = await browser.newContext(phoneOptions);
    await pendingContext.addInitScript(() => {
      Object.defineProperty(window, 'DeviceMotionEvent', {
        value: {
          requestPermission: () =>
            new Promise(resolve => {
              window.__allowMotion = () => resolve('granted');
            }),
        },
        configurable: true,
      });
      Object.defineProperty(window, 'DeviceOrientationEvent', {
        value: {requestPermission: () => Promise.resolve('granted')},
        configurable: true,
      });
    });
    const pending = await pendingContext.newPage();
    pending.on('pageerror', error => errors.push(error.message));
    await pending.goto(base + '/join?code=' + room.code);
    await pending.getByLabel('Your playing name').fill('Sam');
    await pending.getByRole('button', {name: 'Play', exact: true}).click();
    await until(
      lobby,
      value => value.players.length === 1,
      'join must reach server while permission is pending',
    );
    await pending.getByRole('link', {name: 'Go home', exact: true}).click();
    await pending
      .getByRole('heading', {name: 'Ready to play?', exact: true})
      .waitFor();
    await until(
      lobby,
      value => value.players.length === 0,
      'leaving pending permission must release the half-joined seat',
    );
    await pending.evaluate(() => window.__allowMotion());
    await pending.waitForTimeout(100);
    assert.match(pending.url(), /\/home$/);
    assert.equal(await pending.locator('iframe').count(), 0);
    assert.equal(await pending.locator('.remote-return').count(), 0);
    await close();
    await pendingContext.close();
    pass(
      'A late motion-permission reply cannot undo Go home or leave a half-joined active seat',
    );

    assert.deepEqual(errors, []);
    if (process.env.WEE_SMOKE_REPORT)
      writeFileSync(
        process.env.WEE_SMOKE_REPORT,
        JSON.stringify(
          {
            checks,
            errors,
            limitations: [
              'Synthetic browser permissions and touch controllers; physical iPhone motion is not measured.',
            ],
          },
          null,
          2,
        ) + '\n',
      );
  } catch (error) {
    for (const context of browser.contexts())
      for (const page of context.pages())
        console.error(
          'PAGE_STATE',
          page.url(),
          await page
            .locator('body')
            .innerText()
            .catch(() => ''),
        );
    throw error;
  } finally {
    host.disconnect();
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
