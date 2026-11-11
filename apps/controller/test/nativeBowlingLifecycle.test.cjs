const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function sensor() {
  return {listeners:new Set(),isAvailableAsync:async()=>true,requestPermissionsAsync:async()=>({granted:true}),setUpdateInterval(){},
    addListener(fn){this.listeners.add(fn);return {remove:()=>this.listeners.delete(fn)};},emit(value){for(const fn of this.listeners)fn(value);}};
}

async function fixture({raw = false, permission} = {}) {
  const {ControllerSession} = await import('../src/session.js');
  const {AutomaticControllerSetup} = await import('../src/automaticSetup.js');
  const {MotionController} = await import('../src/motionCore.js');
  const sensors = {Gyroscope:sensor(),DeviceMotion:sensor(),Accelerometer:sensor()};
  sensors.DeviceMotion.isAvailableAsync=async()=>!raw;
  if(permission) sensors.DeviceMotion.requestPermissionsAsync=()=>permission.promise;
  let now=1000, motion;
  class Socket extends EventEmitter {
    connected=true;sendBuffer=[];sent=[];io={engine:{transport:{writable:true}}};
    volatile={emit:(event,payload)=>this.sent.push({event,payload,volatile:true}),
      timeout:()=>({emit:(event,payload,ack)=>{this.sent.push({event,payload,volatile:true});ack(null,{ok:true});}})};
    timeout(){return {emit:(event,payload,ack)=>{this.sent.push({event,payload});ack(null,{ok:true});}};}
    disconnect(){this.connected=false;super.emit('disconnect');}
  }
  const socket=new Socket(),updates=[];
  const session=new ControllerSession('https://game.example',{makeSocket:()=>socket,now:()=>now});
  session.seat={code:'K7PM',slot:0,leaderSlot:0,canStart:false,sport:'bowling',phase:'ready',gameId:'game-1',inputGeneration:1,hostEpoch:1,
    players:[{slot:0,setup:null,ready:false}],gameState:{phase:'ready',currentPlayer:1,frame:1}};
  const flow=new AutomaticControllerSetup({session,changed:update=>updates.push(update),makeMotion:onStatus=>{
    motion=new MotionController({session,sensors,now:()=>now,onStatus,onRelease:roll=>session.action('player:roll',{type:'roll',aim:roll.aim,power:roll.power,spin:roll.spin})});
    return motion;
  }});
  return {sensors,session,socket,flow,updates,get motion(){return motion;},
    advance(ms){now+=ms;},
    sample({gyro={x:0,y:0,z:0},gravity={x:0,y:0,z:-9.80665},fresh=true,dt=1000/60}={}){
      now+=dt;
      if(fresh) {
        if(raw) sensors.Accelerometer.emit(Object.fromEntries(['x','y','z'].map(axis=>[axis,gravity[axis]/9.80665])));
        else sensors.DeviceMotion.emit({acceleration:{x:0,y:0,z:0},accelerationIncludingGravity:gravity,orientation:0});
      }
      sensors.Gyroscope.emit(gyro);
    },
    start(){session.seat={...session.seat,phase:'game',inputGeneration:2,players:[{slot:0,setup:'motion',ready:true}]};session.observeBowlingTurn();flow.update(session.seat,'online');motion.resetInput();},
    stop(){flow.stop();session.dispose();},
  };
}

test('iPhone permission time is not counted as sensor silence and fresh motion can actually bowl', async () => {
  const permission=deferred(), f=await fixture({permission});
  try {
    f.flow.update(f.session.seat,'online');await tick();
    f.session.inactive();f.advance(12000);
    permission.resolve({granted:true});await tick();
    f.motion.checkReadings();
    f.session.foreground();f.advance(250);f.motion.checkReadings();
    assert.equal(f.flow.mode,'motion','reading the permission prompt must not force buttons');
    assert.equal(f.session.inputSetup,null,'permissions alone are not playable samples');
    f.advance(150);
    for(let i=0;i<15;i++)f.sample();await tick();
    assert.equal(f.session.inputSetup,'motion');
    assert.ok(f.socket.sent.some(item=>item.event==='player:ready'));
    await f.flow.startGame();
    assert.ok(f.socket.sent.some(item=>item.event==='player:start'));
    f.start();
    for(let i=0;i<40;i++)f.sample();
    for(let i=0;i<20;i++)f.sample({gyro:{x:240*Math.PI/180,y:0,z:0}});
    for(let i=0;i<30;i++)f.sample();await tick();
    const rolls=f.socket.sent.filter(item=>item.event==='player:roll');
    assert.equal(rolls.length,1,'native sensor callbacks reach a real session action exactly once');
    assert.equal(rolls[0].volatile,true,'a physical roll uses expiring input delivery');
    assert.equal(rolls[0].payload.gameId,'game-1');
    assert.equal(rolls[0].payload.generation,2);
    assert.ok(rolls[0].payload.power>=.2);
    assert.equal(f.flow.motionIssue,null);
  } finally {f.stop();}
});

test('motion bowling works with raw Accelerometer when optional fused sensors are absent', async () => {
  const f=await fixture({raw:true});
  try {
    f.flow.update(f.session.seat,'online');await tick();
    for(let i=0;i<15;i++)f.sample();await tick();f.start();
    const gravity={x:-3,y:0,z:-Math.sqrt(9.80665**2-9)};
    for(let i=0;i<40;i++)f.sample({gravity});
    assert.ok(f.socket.sent.filter(item=>item.event==='player:aim').some(item=>Math.abs(item.payload.aim)>.2));
    for(let i=0;i<20;i++)f.sample({gyro:{x:240*Math.PI/180,y:0,z:0},gravity});
    for(let i=0;i<30;i++)f.sample({gravity});await tick();
    assert.equal(f.socket.sent.filter(item=>item.event==='player:roll').length,1);
    assert.equal(f.session.inputSetup,'motion');
    f.flow.stop();
    assert.equal(f.sensors.Accelerometer.listeners.size,0);
  } finally {f.stop();}
});

test('an upright iPhone stays in motion mode and screen-up tilt becomes live without rejoining', async () => {
  const f=await fixture();
  try {
    f.flow.update(f.session.seat,'online');await tick();
    for(let i=0;i<15;i++)f.sample({gravity:{x:0,y:-9.80665,z:0}});await tick();f.start();
    for(let i=0;i<30;i++)f.sample({gravity:{x:0,y:-9.80665,z:0}});
    assert.equal(f.session.inputSetup,'motion');assert.equal(f.flow.mode,'motion');
    const aimStart=f.socket.sent.length;
    for(let i=0;i<20;i++)f.sample({gravity:{x:-3,y:0,z:-Math.sqrt(9.80665**2-9)}});
    assert.ok(f.socket.sent.slice(aimStart).some(item=>item.event==='player:aim' && Math.abs(item.payload.aim)>.2));
    assert.equal(f.socket.sent.filter(item=>item.event==='player:roll').length,0);
  } finally {f.stop();}
});

test('native 30 Hz gravity and 60 Hz gyro keep a quick aiming tilt continuous without releasing', async () => {
  const {bowlingTiltAim}=await import('../../../src/controller/motionGestures.js');
  const f=await fixture();
  try {
    f.flow.update(f.session.seat,'online');await tick();
    for(let i=0;i<15;i++)f.sample();await tick();f.start();
    for(let i=0;i<40;i++)f.sample();
    let previous=0;
    for(let i=1;i<=6;i++) {
      const angle=i*5*Math.PI/180;
      const gravity={x:Math.sin(angle)*9.80665,y:0,z:-Math.cos(angle)*9.80665};
      f.sample({gravity,gyro:{x:0,y:300*Math.PI/180,z:0},fresh:i%2===0});
      const aim=f.socket.sent.filter(item=>item.event==='player:aim').at(-1).payload.aim;
      assert.ok(aim>previous,`tilt ${i*5}° advances on every gyro callback`);
      const expected=bowlingTiltAim(gravity,0);
      assert.ok(Math.abs(expected-aim)<.1,`tilt ${i*5}° remains within .1 normalized aim (${aim} vs ${expected})`);
      previous=aim;
    }
    assert.equal(f.socket.sent.filter(item=>item.event==='player:roll').length,0);
  } finally {f.stop();}
});

test('temporary inactive permission overlays do not expire an otherwise live motion controller', async () => {
  const f=await fixture();
  try {
    f.flow.update(f.session.seat,'online');await tick();
    for(let i=0;i<15;i++)f.sample();await tick();f.start();
    f.session.inactive();f.advance(5000);f.motion.checkReadings();
    assert.equal(f.flow.mode,'motion');
    f.session.foreground();f.advance(250);f.motion.checkReadings();
    assert.equal(f.flow.mode,'motion');
    for(let i=0;i<15;i++)f.sample();await tick();
    assert.equal(f.session.inputSetup,'motion');
    assert.equal(f.socket.sent.filter(item=>item.event==='player:roll').length,0);
  } finally {f.stop();}
});

test('browsing native Tools cannot bowl, and closing Tools does not replay movement',async()=>{
  const f=await fixture();
  try {
    f.flow.update(f.session.seat,'online');await tick();
    for(let i=0;i<15;i++)f.sample();await tick();f.start();
    for(let i=0;i<40;i++)f.sample();
    f.session.setControlsActive(false);const before=f.socket.sent.length;
    for(let i=0;i<20;i++)f.sample({gyro:{x:240*Math.PI/180,y:0,z:0}});
    for(let i=0;i<20;i++)f.sample();
    assert.equal(f.socket.sent.length,before,'Tools keep the room connected without sending aim or roll gestures');
    assert.equal(f.session.inputSetup,'motion');assert.equal(f.socket.connected,true);
    f.session.setControlsActive(true);
    for(let i=0;i<20;i++)f.sample({gyro:{x:240*Math.PI/180,y:0,z:0}});
    assert.equal(f.socket.sent.filter(item=>item.event==='player:roll').length,0);
    for(let i=0;i<40;i++)f.sample();
    for(let i=0;i<20;i++)f.sample({gyro:{x:240*Math.PI/180,y:0,z:0}});
    for(let i=0;i<30;i++)f.sample();await tick();
    assert.equal(f.socket.sent.filter(item=>item.event==='player:roll').length,1);
  }finally{f.stop();}
});
