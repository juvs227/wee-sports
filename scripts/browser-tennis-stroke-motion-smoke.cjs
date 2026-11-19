// Real built web controller, authenticated room and TV input bridge. Synthetic
// DeviceMotion replays validate software; they are not physical latency data.
const assert = require('node:assert/strict');
const {readFileSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {chromium} = require('playwright');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5307';
const fixtures = [
  ['two-forehands-one-backhand', 'Right', ['Forehand','Forehand','Backhand']],
  ['four-backhands', 'Right', Array(4).fill('Backhand')],
  ['left-mixed', 'Left', ['Forehand','Backhand','Forehand','Backhand']],
  ['left-four-backhands-new', 'Left', Array(4).fill('Backhand')],
  ['left-four-forehands', 'Left', Array(4).fill('Forehand')],
];

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium', headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks = [], errors = [];
  try {
    for (const hand of ['Right','Left']) {
      const tvContext = await browser.newContext({viewport:{width:960,height:640}});
      const phoneContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      await tvContext.addInitScript(() => {
        window.__received = [];
        window.addEventListener('message', event => {
          if (event.origin === location.origin && event.data?.type === 'wee:game-swing') window.__received.push(event.data.event);
        });
      });
      await phoneContext.addInitScript(() => {
        window.__messages = []; window.__capture = [];
        window.addEventListener('message', event => {
          if (event.origin === location.origin && ['wee:player-swing','wee:swing-ack','wee:lobby-state'].includes(event.data?.type)) window.__messages.push(event.data);
        });
        const Sensor = class {static requestPermission() {return Promise.resolve('granted');}};
        Object.defineProperty(window,'DeviceMotionEvent',{configurable:true,value:Sensor});
        Object.defineProperty(window,'DeviceOrientationEvent',{configurable:true,value:Sensor});
        const emit = (alpha=0,beta=0,gamma=0) => {
          window.__capture.push({timeMs:performance.now(),rotationAlpha:alpha,rotationBeta:beta,rotationGamma:gamma});
          if (window.__capture.length > 3000) window.__capture.shift();
          const event = new Event('devicemotion');
          Object.assign(event,{rotationRate:{alpha,beta,gamma},interval:16,
            acceleration:{x:0,y:0,z:0},accelerationIncludingGravity:{x:0,y:0,z:9.80665}});
          window.dispatchEvent(event);
        };
        setInterval(() => {if (!window.__replaying) emit();},16);
        window.__replay = async ({samples,gain}) => {
          window.__replaying = true;
          const start = performance.now();
          try {
            for (const sample of samples) {
              await new Promise(resolve => setTimeout(resolve,Math.max(0,start+sample.timeMs-performance.now())));
              emit(sample.rotationAlpha*gain,sample.rotationBeta*gain,sample.rotationGamma*gain);
            }
          } finally {window.__replaying = false;}
        };
      });
      const tv = await tvContext.newPage(), phone = await phoneContext.newPage();
      for (const page of [tv,phone]) page.on('pageerror',error => errors.push(error.message));
      await tv.goto(base+'/home');
      await tv.getByRole('button',{name:'Play: Tennis',exact:true}).click();
      const code = await tv.getByTestId('lobby-code').innerText();
      await phone.goto(base+'/join?code='+code);
      await phone.getByLabel('Your playing name',{exact:true}).fill(hand+' player');
      await phone.getByRole('button',{name:'Play',exact:true}).click();
      const controllerElement = phone.locator('iframe[title="Tennis phone controller"]');
      await controllerElement.waitFor();
      const controller = await (await controllerElement.elementHandle()).contentFrame();
      await controller.locator('#toggle-settings').click();
      await controller.locator('#hand').selectOption(hand);
      await controller.locator('#back-to-play').click();
      await phone.getByRole('button',{name:'Start game',exact:true}).click();
      await phone.getByRole('button',{name:'Start now',exact:true}).click();
      const gameElement = tv.locator('iframe[title="Tennis game"]');
      await gameElement.waitFor();
      const game = await (await gameElement.elementHandle()).contentFrame();
      await controller.waitForFunction(() => document.getElementById('play-status').textContent === 'Motion on');
      for (const [name, , expected] of fixtures.filter(row=>row[1] === hand)) {
        await phone.waitForTimeout(500);
        await game.evaluate(() => {window.__received=[];});
        const data = JSON.parse(readFileSync('server/fixtures/team-motion/'+name+'.json'));
        await controller.evaluate(config=>window.__replay(config),{samples:data.samples??data,gain:.5});
        await phone.waitForTimeout(400);
        const received = await game.evaluate(() => window.__received.map(({label,hand})=>({label,hand})));
        if (JSON.stringify(received) !== JSON.stringify(expected.map(label=>({label,hand})))) {
          writeFileSync(join(tmpdir(),'wee-browser-motion-failure.json'),JSON.stringify({name,received,
            phone:await phone.evaluate(()=>window.__messages),controller:await controller.evaluate(()=>({samples:window.__capture,messages:window.__messages,
              status:document.getElementById('play-status').textContent,latest:document.getElementById('latest').textContent}))},null,2));
        }
        assert.deepEqual(received,expected.map(label=>({label,hand})),name);
        checks.push({name,hand,gain:.5,received});
        console.log('PASS',name,received.length+' strokes');
      }
      await tvContext.close(); await phoneContext.close();
    }
    assert.deepEqual(errors,[]);
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify({recordedAt:new Date().toISOString(),checks,errors,
      limitations:['Synthetic replay through actual web UI and local room transport. Not physical iPhone motion, Wi-Fi/Railway latency or native Expo rendering.','These cases check detection, labels and once-only TV delivery. Real-model contact is checked separately.']},null,2)+'\n');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
