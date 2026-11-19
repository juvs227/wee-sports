const { test } = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function sensor() {
  return { listeners: new Set(), requestPermissionsAsync: async () => ({ granted: true }),
    isAvailableAsync: async () => true, setUpdateInterval() {},
    addListener(fn) { this.listeners.add(fn); return { remove: () => this.listeners.delete(fn) }; } };
}
async function fixture() {
  const { MotionController } = await import('../src/motionCore.js');
  const sensors = { Gyroscope: sensor(), DeviceMotion: sensor() };
  const session = { seat: { sport: 'tennis' }, latest() {}, playing: () => true };
  return { sensors, controller: new MotionController({ session, sensors }) };
}

test('native tennis keeps compact recorded forehands and backhands for both hands', async () => {
  const {MotionController} = await import('../src/motionCore.js');
  for (const [name, hand, expected] of [
    ['two-forehands-one-backhand', 'Right', ['Forehand','Forehand','Backhand']],
    ['four-backhands', 'Right', Array(4).fill('Backhand')],
    ['left-mixed', 'Left', ['Forehand','Backhand','Forehand','Backhand']],
    ['left-four-backhands-new', 'Left', Array(4).fill('Backhand')],
    ['left-four-forehands', 'Left', Array(4).fill('Forehand')],
  ]) {
    const data = JSON.parse(readFileSync(resolve(__dirname, '../../../server/fixtures/team-motion', name + '.json')));
    let now = 1000;
    const strokes = [];
    const session = {seat:{sport:'tennis'},inputSetup:'motion',playing:()=>true};
    const controller = new MotionController({session,hand,sensors:{Gyroscope:sensor(),DeviceMotion:sensor()},now:()=>now,onSwing:stroke=>strokes.push(stroke)});
    try {
      await controller.calibrate();
      for (now = 1000; now < 2000; now += 16) controller.sample({x:0,y:0,z:0});
      for (const sample of data.samples ?? data) {
        now = 2000 + sample.timeMs;
        controller.sample({x:sample.rotationAlpha * .5 * Math.PI / 180,
          y:sample.rotationBeta * .5 * Math.PI / 180,z:sample.rotationGamma * .5 * Math.PI / 180});
      }
      assert.deepEqual(strokes.map(stroke=>stroke.label), expected, name);
      assert.ok(strokes.every(stroke=>stroke.hand === hand));
    } finally {controller.stop();}
  }
});

test('background while permission is pending cannot restart native sensors', async () => {
  const { sensors, controller } = await fixture();
  const permission = deferred();
  sensors.Gyroscope.requestPermissionsAsync = () => permission.promise;
  const pending = controller.calibrate();
  controller.stop(); permission.resolve({ granted: true }); await pending;
  assert.equal(controller.active, false);
  assert.equal(sensors.Gyroscope.listeners.size, 0);
  assert.equal(sensors.DeviceMotion.listeners.size, 0);
});

test('background during gravity availability cannot resurrect an old calibration', async () => {
  const { sensors, controller } = await fixture();
  const availability = deferred();
  sensors.DeviceMotion.isAvailableAsync = () => availability.promise;
  const pending = controller.calibrate();
  await new Promise(resolve => setImmediate(resolve));
  controller.stop(); availability.resolve(true); await pending;
  assert.equal(controller.active, false);
  assert.equal(sensors.Gyroscope.listeners.size, 0);
  assert.equal(sensors.DeviceMotion.listeners.size, 0);
});

test('a missing optional gravity sensor still allows gyro control and stop unsubscribes', async () => {
  const { sensors, controller } = await fixture();
  sensors.DeviceMotion.isAvailableAsync = async () => false;
  await controller.calibrate();
  assert.equal(sensors.Gyroscope.listeners.size, 1);
  assert.equal(sensors.DeviceMotion.listeners.size, 0);
  controller.stop();
  assert.equal(sensors.Gyroscope.listeners.size, 0);
});



test('DeviceMotion permission is requested separately and bowling cannot silently lose tilt aim', async () => {
  const {sensors, controller} = await fixture();
  let asked = 0;
  sensors.DeviceMotion.requestPermissionsAsync = async () => {asked++; return {granted:false};};
  controller.session.seat.sport = 'bowling';
  await assert.rejects(controller.calibrate(), {code:'permission-denied'});
  assert.equal(asked, 1);
  assert.equal(sensors.Gyroscope.listeners.size, 0);
  assert.equal(sensors.DeviceMotion.listeners.size, 0);
  controller.stop();
});



test('a late DeviceMotion permission grant cannot resurrect a backgrounded controller', async () => {
  const {sensors, controller} = await fixture();
  const permission = deferred();
  sensors.DeviceMotion.requestPermissionsAsync = () => permission.promise;
  const pending = controller.calibrate();
  await new Promise(resolve => setImmediate(resolve));
  controller.stop(); permission.resolve({granted:true}); await pending;
  assert.equal(sensors.Gyroscope.listeners.size,0);
  assert.equal(sensors.DeviceMotion.listeners.size,0);
});

test('native tennis recognizes the web forehand and backhand traces once in radians per second', async () => {
  const {MotionController} = await import('../src/motionCore.js');
  for (const [label, peak] of [['Forehand',[170,310,0]], ['Backhand',[-400,-300,0]]]) {
    let now = 1000;
    const strokes = [];
    const session = {seat:{sport:'tennis'},inputSetup:'motion',playing:()=>true};
    const sensors = {Gyroscope:sensor(),DeviceMotion:sensor()};
    const controller = new MotionController({session,sensors,now:()=>now,onSwing:stroke=>strokes.push(stroke)});
    try {
      await controller.calibrate();
      for (let time=0;time<=1200;time+=20) {
        now=1000+time;
        const rate = time < 400 ? [0,0,0] : time < 540 ? peak : time < 600 ? peak.map(value=>value*.35) : [0,0,0];
        controller.sample(Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,rate[i]*Math.PI/180])));
      }
      assert.equal(strokes.length,1);
      assert.equal(strokes[0].label,label);
      assert.equal(strokes[0].hand,'Right');
      assert.ok(strokes[0].power>=.2 && strokes[0].power<=1);
      assert.equal(strokes[0].aim,0,'neutral aim is captured before the power stroke changes orientation');
      assert.equal(Math.abs(strokes[0].depth),0);
    } finally {controller.stop();}
  }
});

test('native gyro capture timestamps reject delayed callback batches before they can make a swing', async () => {
  const {MotionController}=await import('../src/motionCore.js');
  let now=1000;const strokes=[];
  const session={seat:{sport:'tennis'},inputSetup:'motion',playing:()=>true};
  const controller=new MotionController({session,sensors:{Gyroscope:sensor(),DeviceMotion:sensor()},now:()=>now,onSwing:stroke=>strokes.push(stroke)});
  try {
    await controller.calibrate();
    // Capture clock uses phone uptime, independent of the JS clock origin.
    for(let i=0;i<20;i++){now=1000+i*20;controller.sample({timestamp:100+i*.02,x:0,y:0,z:0});}
    const accepted=controller.samples,previous=controller.lastTime;
    now=2000;
    for(let i=20;i<30;i++)controller.sample({timestamp:100+i*.02,x:3,y:6,z:0});
    assert.equal(controller.staleSamples,10);
    assert.equal(controller.samples,accepted);assert.equal(controller.lastTime,previous);
    assert.ok(controller.maxCaptureAgeMs>=590);assert.deepEqual(strokes,[]);
    for(let i=0;i<20;i++){now=2000+i*20;controller.sample({timestamp:101+i*.02,x:0,y:0,z:0});}
    assert.equal(controller.samples,accepted+20);assert.equal(controller.captureAgeMs,0);
    assert.deepEqual(strokes,[],'fresh quiet input after a delayed batch cannot finish a discarded swing');
    const latest=controller.samples;
    controller.sample({timestamp:101.38,x:3,y:6,z:0});
    controller.sample({timestamp:101.2,x:3,y:6,z:0});
    assert.equal(controller.samples,latest,'duplicate and out-of-order native frames are ignored');
  }finally{controller.stop();}
});

test('native tennis preserves a deliberate held aim through the fast part of a recognized stroke', async () => {
  const {MotionController}=await import('../src/motionCore.js');
  const captures=[];
  for(const hand of ['Right','Left']) {
  let now=1000;const strokes=[];
  const session={seat:{sport:'tennis'},inputSetup:'motion',playing:()=>true};
  const controller=new MotionController({session,hand,sensors:{Gyroscope:sensor(),DeviceMotion:sensor()},now:()=>now,onSwing:stroke=>strokes.push(stroke)});
  const push=(rate,count)=>{for(let i=0;i<count;i++){now+=20;controller.sample({...rate,timestamp:50+now/1000});}};
  try {
    await controller.calibrate();
    push({x:0,y:0,z:0},20);push({x:-.2,y:.4,z:0},40);push({x:0,y:0,z:0},60);
    const peak=hand==='Right' ? {x:170*Math.PI/180,y:310*Math.PI/180,z:0} : {x:400*Math.PI/180,y:-200*Math.PI/180,z:0};
    push(peak,7);
    push({x:peak.x*.35,y:peak.y*.35,z:0},3);push({x:0,y:0,z:0},30);
    assert.equal(strokes.length,1);assert.equal(strokes[0].hand,hand);
    assert.ok(['Forehand','Backhand'].includes(strokes[0].label));
    assert.ok(strokes[0].aim>.3 && strokes[0].aim<.34);
    assert.ok(strokes[0].depth>.14 && strokes[0].depth<.18);
    captures.push({aim:strokes[0].aim,depth:strokes[0].depth});
  }finally{controller.stop();}
  }
  assert.deepEqual(captures[0],captures[1],'handedness changes stroke labels, not the phone pointing direction');
});

test('native tennis discards a partial swing on interruption and suppresses paused movement', async () => {
  const {MotionController} = await import('../src/motionCore.js');
  let now = 1000, playing = true;
  const strokes = [];
  const session = {seat:{sport:'tennis'},inputSetup:'motion',playing:()=>playing};
  const controller = new MotionController({session,sensors:{Gyroscope:sensor(),DeviceMotion:sensor()},now:()=>now,onSwing:stroke=>strokes.push(stroke)});
  try {
    await controller.calibrate();
    for (let i=0;i<15;i++) {controller.sample({x:0,y:0,z:0});now+=20;}
    controller.sample({x:3,y:6,z:0}); now+=20;
    playing=false;
    for (let i=0;i<20;i++) {controller.sample({x:3,y:6,z:0});now+=20;}
    playing=true;
    for (let i=0;i<15;i++) {controller.sample({x:0,y:0,z:0});now+=20;}
    assert.deepEqual(strokes,[]);
  } finally {controller.stop();}
});

test('native tennis uses a quick new aim on the first recognized hit without a quiet pause', async () => {
  const {MotionController}=await import('../src/motionCore.js');
  for(const hand of ['Right','Left']) {
    let now=120000; const strokes=[];
    const session={seat:{sport:'tennis'},inputSetup:'motion',playing:()=>true};
    const controller=new MotionController({session,hand,sensors:{Gyroscope:sensor(),DeviceMotion:sensor()},
      now:()=>now,onSwing:stroke=>strokes.push(stroke)});
    const push=(rate,count)=>{for(let i=0;i<count;i++){now+=20;controller.sample({...rate,timestamp:50+now/1000});}};
    try {
      await controller.calibrate();
      push({x:0,y:0,z:0},20);
      push({x:0,y:-.6,z:0},25);
      push({x:0,y:1.2,z:0},25);
      assert.deepEqual(strokes,[],'a quick aiming adjustment is not a stroke');
      push(hand==='Right' ? {x:6,y:12,z:0} : {x:7,y:-4,z:0},12);
      push({x:0,y:0,z:0},20);
      assert.equal(strokes.length,1);
      assert.ok(strokes[0].aim>.29 && strokes[0].aim<.31,'first hit uses the new rightward aim');
    }finally{controller.stop();}
  }
});

test('only the current native bowler streams aim, with fresh gravity samples', async () => {
  const {MotionController} = await import('../src/motionCore.js');
  let now = 1000;
  const aims = [];
  const session = {seat:{sport:'bowling',slot:1,gameState:{phase:'ready',currentPlayer:1}},
    inputSetup:'motion',bowlingTurnKey:'turn-1',playing:()=>true,latest:(kind,value)=>aims.push({kind,value})};
  const controller = new MotionController({session,sensors:{Gyroscope:sensor(),DeviceMotion:sensor()},now:()=>now});
  try {
    await controller.calibrate();
    const sample = () => {
      controller.device = {acceleration:{x:0,y:0,z:0},accelerationIncludingGravity:{x:-3,y:0,z:-9.35}};
      controller.deviceReceived = now;
      controller.sample({x:0,y:0,z:0});now+=20;
    };
    for(let i=0;i<20;i++) sample();
    assert.deepEqual(aims,[], 'waiting bowlers do not send aim traffic');
    session.seat.gameState.currentPlayer=2; session.bowlingTurnKey='turn-2'; sample();
    assert.equal(aims.length,1);
    assert.equal(aims[0].kind,'aim');
    assert.ok(Math.abs(aims[0].value.aim)>0, 'tilt reaches the TV instead of staying centered');
  } finally {controller.stop();}
});
