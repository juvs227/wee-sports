// Production profile UI with synthetic HTTP/room responses. No accounts or
// rooms are written. Run only against an already running disposable server.
const {chromium, devices} = require('playwright');
const assert = require('node:assert/strict');
const {mkdirSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');

const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5221';
const shots = process.env.WEE_SMOKE_SCREENSHOTS;
const profile = {username: 'profile_smoke', displayName: 'Profile Smoke', avatar: 'ball', revision: 1,
  preferences: {hand: 'Right', sensitivity: 1, assistance: 'friendly', sound: true,
    haptics: true, reducedMotion: false, touchControls: false}};
const json = (route, data, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});

function observeSocket(page) {
  const state = {connections: 0, disconnects: 0, closed: 0, websockets: 0};
  const received = value => {
    for (const packet of String(value).split('\x1e')) if (/^40(?:\{|$)/.test(packet)) state.connections++;
  };
  page.on('websocket', socket => {
    if (!socket.url().includes('/socket.io/')) return;
    state.websockets++;
    socket.on('framereceived', frame => received(frame.payload));
    socket.on('framesent', frame => {if (/^41(?:$|\[)/.test(String(frame.payload))) state.disconnects++;});
    socket.on('close', () => {state.closed++;});
  });
  page.on('response', response => {
    if (response.url().includes('/socket.io/') && response.url().includes('transport=polling')) {
      response.text().then(received).catch(() => { /* A cancelled polling request has no readable body. */ });
    }
  });
  return {
    snapshot: () => ({...state}),
    async ready() {
      const deadline = Date.now() + 7000;
      while (!state.connections && Date.now() < deadline) await page.waitForTimeout(25);
      assert.ok(state.connections > 0, 'the production Socket.IO connection must finish its handshake');
    },
  };
}

// Keep the real Engine.IO connection and intercept only this test's resume
// acknowledgements. No synthetic reconnect token reaches the room store.
async function interceptResume(page, respond) {
  await page.routeWebSocket('**/socket.io/**', socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => {
      const packet = /^42(\d+)(\[.*\])$/.exec(String(message));
      if (packet) {
        const [event, payload] = JSON.parse(packet[2]);
        if (event === 'session:resume') {
          socket.send(`43${packet[1]}${JSON.stringify([respond(payload)])}`);
          return;
        }
      }
      server.send(message);
    });
  });
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const checks = [], errors = [], measurements = {};
  let failure;
  const pass = text => {checks.push(text); console.log('PASS:', text);};
  const screenshot = async (page, name) => {
    if (!shots) return;
    mkdirSync(shots, {recursive: true});
    await page.screenshot({path: join(shots, name + '.png'), animations: 'disabled'});
  };
  const watch = (page, label) => page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  try {
    const timeoutContext = await browser.newContext({viewport: {width: 1280, height: 800}});
    const timeoutPage = await timeoutContext.newPage();
    watch(timeoutPage, 'timeout');
    const held = [];
    let requestedAt;
    await timeoutPage.route('**/api/profile**', route => {
      requestedAt ??= Date.now();
      held.push(route); // Deliberately never respond before the real deadline.
    });
    await timeoutPage.goto(base + '/profile');
    await timeoutPage.getByRole('status').filter({hasText: 'Loading profile…'}).waitFor();
    await timeoutPage.getByRole('alert').filter({hasText: 'The profile request took too long.'}).waitFor({timeout: 15000});
    measurements.profileTimeoutMs = Date.now() - requestedAt;
    assert.ok(measurements.profileTimeoutMs >= 9000, 'exercise the real ten-second deadline without changing browser clocks');
    assert.equal(held.length, 1, 'the failed request must not be automatically retried');
    assert.equal(await timeoutPage.getByRole('status').filter({hasText: 'Loading profile…'}).count(), 0);
    assert.match(await timeoutPage.getByRole('alert').innerText(), /Check your connection and reload before trying again/);
    await timeoutPage.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    await screenshot(timeoutPage, 'profile-timeout');
    await timeoutContext.close();
    pass('A genuinely stalled profile request ends after ten seconds with an actionable error, no spinner and no automatic retry');

    const navigationContext = await browser.newContext({viewport: {width: 1280, height: 800}});
    const navigationPage = await navigationContext.newPage();
    watch(navigationPage, 'navigation');
    const connection = observeSocket(navigationPage);
    const requestedPaths = [];
    let pendingLogin;
    await navigationPage.route('**/api/profile**', route => {
      const path = new URL(route.request().url()).pathname;
      requestedPaths.push(path);
      if (path === '/api/profile/login') {pendingLogin = route; return;}
      return json(route, {error: 'not-signed-in'}, 401);
    });
    await navigationPage.goto(base + '/profile');
    await navigationPage.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    await connection.ready();
    await navigationPage.getByLabel('Username', {exact: true}).fill('profile_smoke');
    await navigationPage.getByLabel('Password', {exact: true}).fill('synthetic test password only');
    await navigationPage.getByRole('button', {name: 'Sign in', exact: true}).click();
    const loginDeadline = Date.now() + 5000;
    while (!pendingLogin && Date.now() < loginDeadline) await navigationPage.waitForTimeout(25);
    assert.ok(pendingLogin, 'the synthetic sign-in request must reach its interception route');
    const beforeNavigation = connection.snapshot();
    const cancelled = navigationPage.waitForEvent('requestfailed', {
      predicate: request => new URL(request.url()).pathname === '/api/profile/login', timeout: 5000,
    });
    await navigationPage.getByRole('link', {name: 'Back to games', exact: true}).click();
    await navigationPage.getByRole('heading', {name: 'Pick a sport', exact: true}).waitFor();
    const failedRequest = await cancelled;
    assert.match(failedRequest.failure().errorText, /ABORTED|CANCELLED/i);
    // Attempt to deliver a successful response after the page has cancelled it.
    // Chromium can discard the response or reject fulfillment of an aborted route.
    await json(pendingLogin, {profile}).catch(() => {});
    await navigationPage.waitForTimeout(350);
    assert.equal(new URL(navigationPage.url()).pathname, '/home');
    assert.equal(await navigationPage.locator('.profile-page').count(), 0);
    assert.equal(await navigationPage.getByRole('heading', {name: 'Pick a sport', exact: true}).isVisible(), true);
    assert.deepEqual(connection.snapshot(), beforeNavigation, 'leaving a pending sign-in must not reconnect the shared socket');
    assert.deepEqual(requestedPaths, ['/api/profile', '/api/profile/login'], 'a cancelled sign-in must not start profile/history follow-up requests');
    measurements.navigationSocket = connection.snapshot();
    await navigationContext.close();
    pass('Navigation cancels delayed sign-in; an arriving success cannot change the new page, start history requests or reconnect its socket');

    const recoveryContext = await browser.newContext({viewport: {width: 1280, height: 800}});
    const recoveryPage = await recoveryContext.newPage();
    watch(recoveryPage, 'owner-recovery');
    const tokenKey = 'wee:session:v2:host:K7PM';
    const token = 'synthetic-host-seat-proof';
    await recoveryContext.addInitScript(({key, value}) => localStorage.setItem(key, value), {key: tokenKey, value: token});
    let signedIn = false;
    const resumes = [];
    await interceptResume(recoveryPage, payload => {
      resumes.push(payload);
      return signedIn ? {ok: true, code: 'K7PM', token, sport: 'tennis', phase: 'ready', players: [], paused: false,
        gameId: null, inputGeneration: 1, hostEpoch: 1} : {ok: false, error: 'recovery-owner-required'};
    });
    await recoveryPage.route('**/api/phone-link', route => json(route, {status: 'local', origin: null}));
    await recoveryPage.route('**/api/profile**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/profile/login') signedIn = true;
      if (!signedIn) return json(route, {error: 'not-signed-in'}, 401);
      return json(route, path === '/api/profile/history' ? {history: []}
        : path === '/api/profile/recovery' ? {matches: []} : {profile});
    });
    await recoveryPage.goto(base + '/host/K7PM');
    await recoveryPage.getByRole('heading', {name: 'Sign in to reconnect', exact: true}).waitFor();
    assert.equal(await recoveryPage.evaluate(key => localStorage.getItem(key), tokenKey), token);
    await recoveryPage.waitForTimeout(2100);
    assert.equal(resumes.length, 1, 'owner mismatch must stop the two-second retry loop');
    await screenshot(recoveryPage, 'profile-owner-sign-in');
    await recoveryPage.getByRole('link', {name: 'Sign in', exact: true}).click();
    await recoveryPage.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    assert.equal(await recoveryPage.getByRole('link', {name: 'Back to room', exact: true}).getAttribute('href'), '/host/K7PM');
    await recoveryPage.getByLabel('Username', {exact: true}).fill('profile_smoke');
    await recoveryPage.getByLabel('Password', {exact: true}).fill('synthetic test password only');
    await recoveryPage.getByRole('button', {name: 'Sign in', exact: true}).click();
    await recoveryPage.getByRole('button', {name: 'Sign out', exact: true}).waitFor();
    await recoveryPage.getByRole('link', {name: 'Back to room', exact: true}).click();
    await recoveryPage.getByTestId('lobby-code').waitFor();
    assert.equal(await recoveryPage.getByTestId('lobby-code').innerText(), 'K7PM');
    assert.equal(resumes.length, 2);
    assert.ok(resumes.every(request => request.token === token && request.code === 'K7PM' && request.role === 'host'));
    pass('A saved-room owner mismatch stops retrying, keeps its proof, links through sign-in and returns to the same room identity');

    await recoveryPage.goto(base + '/profile');
    await recoveryPage.getByRole('button', {name: 'Sign out', exact: true}).waitFor();
    for (const returnTo of ['/join?code=K7PM', 'https://outside.example', '//outside.example', '/profile']) {
      await recoveryPage.evaluate(returnTo => {
        const state = {...history.state, usr: {returnTo}};
        history.replaceState(state, '', location.href);
        window.dispatchEvent(new PopStateEvent('popstate', {state}));
      }, returnTo);
      const valid = returnTo === '/join?code=K7PM';
      const link = recoveryPage.getByRole('link', {name: valid ? 'Back to room' : 'Back to games', exact: true});
      await link.waitFor();
      assert.equal(await link.getAttribute('href'), valid ? returnTo : '/home');
    }
    await recoveryContext.close();
    pass('Profile return navigation accepts the phone room route and rejects external or unrelated destinations');

    const phoneContext = await browser.newContext({...devices['iPhone 13']});
    await phoneContext.addInitScript(() => localStorage.setItem('wee:session:v2:player:K7PM', 'synthetic-player-seat-proof'));
    const phone = await phoneContext.newPage();
    watch(phone, 'phone-owner');
    await interceptResume(phone, () => ({ok: false, error: 'recovery-owner-required'}));
    await phone.route('**/api/phone-link', route => json(route, {status: 'local', origin: null}));
    await phone.route('**/api/profile**', route => json(route, {error: 'not-signed-in'}, 401));
    await phone.goto(base + '/join?code=K7PM');
    await phone.getByRole('alert').filter({hasText: 'Sign in to the profile that saved this game'}).waitFor();
    await phone.getByRole('link', {name: 'Sign in', exact: true}).click();
    await phone.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    assert.equal(await phone.getByRole('link', {name: 'Back to room', exact: true}).getAttribute('href'), '/join?code=K7PM');
    assert.equal(await phone.evaluate(() => localStorage.getItem('wee:session:v2:player:K7PM')), 'synthetic-player-seat-proof');
    await phoneContext.close();
    pass('Phone recovery presents the same sign-in next step and preserves its private seat and phone return route');
    assert.deepEqual(errors, []);
    pass('No uncaught browser errors');
  } catch (error) {
    failure = error.message;
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('PAGE_STATE', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
    }
    throw error;
  } finally {
    const report = {recordedAt: new Date().toISOString(), base, browser: browser.version(), checks, errors, measurements,
      ...(failure ? {failure} : {}), limitations: [
        'Profile responses and saved-room resume acknowledgements are synthetic; this test does not establish server authentication or persistence correctness.',
        'The application, real ten-second deadline, browser navigation, request cancellation and Socket.IO connection lifecycle execute without replacing application code or clocks.',
        'Phone layout uses Chromium iPhone emulation; physical Safari permissions and sensor behavior require device checks.',
      ]};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
