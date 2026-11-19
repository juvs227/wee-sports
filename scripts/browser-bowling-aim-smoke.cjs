// Real browser range sanitization, phone controller and authenticated TV bridge.
// Synthetic sensor samples verify software behavior, not physical device latency.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5205';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const errors = [];
  try {
    const tvContext = await browser.newContext({viewport: {width: 960, height: 640}});
    const phoneContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    for (const context of [tvContext, phoneContext]) await context.addInitScript(() => {
      window.__bowlingMessages = [];
      window.addEventListener('message', event => {
        if (event.origin === location.origin && ['wee:player-aim', 'wee:player-roll', 'wee:game-aim', 'wee:game-roll'].includes(event.data?.type)) {
          window.__bowlingMessages.push(event.data);
        }
      });
    });
    await phoneContext.addInitScript(() => {
      const Sensor = class {static requestPermission() {return Promise.resolve('granted');}};
      Object.defineProperty(window, 'DeviceMotionEvent', {configurable: true, value: Sensor});
      Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true, value: Sensor});
      window.__bowlingPose = {angle: 0, pitch: 0, twist: 0};
      setInterval(() => {
        const {angle, pitch, twist} = window.__bowlingPose;
        const radians = angle * Math.PI / 180;
        const event = new Event('devicemotion');
        Object.assign(event, {rotationRate: {alpha: pitch, beta: twist, gamma: 0}, interval: 16,
          acceleration: {x: 0, y: 0, z: 0},
          accelerationIncludingGravity: {x: -Math.sin(radians) * 9.80665, y: 0, z: Math.cos(radians) * 9.80665}});
        window.dispatchEvent(event);
      }, 16);
    });
    const tv = await tvContext.newPage(), phone = await phoneContext.newPage();
    for (const page of [tv, phone]) page.on('pageerror', error => errors.push(error.message));
    await tv.goto(base + '/home');
    await tv.getByRole('button', {name: 'Play: Bowling', exact: true}).click();
    const code = await tv.getByTestId('lobby-code').innerText();
    await phone.goto(base + '/join?code=' + code);
    await phone.getByLabel('Your playing name', {exact: true}).fill('Aim precision');
    await phone.getByRole('button', {name: 'Play', exact: true}).click();
    const controllerElement = phone.locator('iframe[title="Bowling phone controller"]');
    await controllerElement.waitFor();
    const controller = await (await controllerElement.elementHandle()).contentFrame();
    await phone.getByRole('button', {name: 'Start game', exact: true}).click();
    await phone.getByRole('button', {name: 'Start now', exact: true}).click();
    const gameElement = tv.locator('iframe[title="Bowling game"]');
    await gameElement.waitFor();
    const game = await (await gameElement.elementHandle()).contentFrame();
    await controller.locator('#play-title').filter({hasText: 'Swing forward to bowl'}).waitFor();
    await game.locator('canvas').waitFor();

    // Establish the browser behavior that the old sensor-to-slider-to-relay
    // path inherited. A detached clone cannot change the active controller.
    const range = await controller.evaluate(() => {
      const input = document.getElementById('aim').cloneNode();
      input.value = '.02'; const low = Number(input.value);
      input.value = '.03'; return {step: Number(input.step), low, high: Number(input.value)};
    });
    assert.deepEqual(range, {step: .05, low: 0, high: .05});
    await phone.evaluate(() => {window.__bowlingMessages = [];});
    // A diagonal aiming adjustment used to lock the guide and bowl by itself.
    await controller.evaluate(() => {window.__bowlingPose = {angle: 12, pitch: 160, twist: 180};});
    await phone.waitForTimeout(320);
    await controller.evaluate(() => {window.__bowlingPose = {angle: 12, pitch: 0, twist: 0};});
    await phone.waitForTimeout(120);
    await controller.evaluate(async () => {
      window.__bowlingPose.pitch = 700;
      await new Promise(resolve => setTimeout(resolve, 24));
      window.__bowlingPose.pitch = 0;
    });
    await phone.waitForTimeout(160);
    const positioning = await phone.evaluate(() => window.__bowlingMessages);
    const positioningAims = positioning.filter(message => message.type === 'wee:player-aim');
    assert.ok(positioningAims.length > 3, 'Positioning must keep the live aim stream active');
    assert.ok(positioningAims.every(message => !message.event.locked), 'Aiming and a short twitch must not lock the line');
    assert.equal(positioning.filter(message => message.type === 'wee:player-roll').length, 0, 'Positioning must not bowl');
    await controller.evaluate(() => {window.__bowlingPose.angle = 0;});
    await phone.waitForTimeout(240);
    await phone.evaluate(() => {window.__bowlingMessages = [];});
    await game.evaluate(() => {window.__bowlingMessages = [];});
    for (const angle of [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]) {
      await controller.evaluate(value => {window.__bowlingPose.angle = value;}, angle);
      await phone.waitForTimeout(48);
    }
    await phone.waitForTimeout(240);
    const preview = await phone.evaluate(() => window.__bowlingMessages.filter(message => message.type === 'wee:player-aim' && !message.event.locked).map(message => message.event.aim));
    const fine = preview.filter(aim => Math.abs(aim / .05 - Math.round(aim / .05)) > .02);
    assert.ok(fine.length >= 8, `Expected continuous aim between touch steps, got ${JSON.stringify(preview)}`);
    const settled = preview.at(-1);
    assert.ok(Math.abs(settled - 4.5 / 34) < .001, 'Settled preview must retain the actual gravity aim');
    const slider = await controller.locator('#aim').inputValue();
    assert.ok(Math.abs(settled - Number(slider)) > .01, 'Motion must not read its sanitized touch display back');
    await game.waitForFunction(expected => window.__bowlingMessages.some(message => message.type === 'wee:game-aim' && Math.abs(message.event.aim - expected) < .001), settled);

    await controller.evaluate(() => {window.__bowlingPose.pitch = 500;});
    await phone.waitForFunction(() => window.__bowlingMessages.some(message => message.type === 'wee:player-aim' && message.event.locked));
    const locked = await phone.evaluate(() => window.__bowlingMessages.find(message => message.type === 'wee:player-aim' && message.event.locked).event.aim);
    await controller.evaluate(() => {window.__bowlingPose.angle = -20;});
    await phone.waitForTimeout(300);
    await controller.evaluate(() => {window.__bowlingPose.pitch = 0;});
    await game.waitForFunction(() => window.__bowlingMessages.some(message => message.type === 'wee:game-roll'));
    const rolls = await game.evaluate(() => window.__bowlingMessages.filter(message => message.type === 'wee:game-roll').map(message => message.event));
    assert.equal(rolls.length, 1);
    assert.equal(rolls[0].aim, locked, 'Authenticated roll must use the precise locked line, even after the phone tilts away');
    assert.ok(Math.abs(locked - settled) < .001);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({result: 'PASS', sensorSource: 'synthetic DeviceMotion at 16ms', range,
      unlockedPositioningPackets: positioningAims.length, accidentalRolls: 0,
      previewPackets: preview.length, betweenStepPackets: fine.length, settledAim: settled,
      sliderAim: Number(slider), lockedAim: locked, rollAim: rolls[0].aim, browserErrors: errors}, null, 2));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
