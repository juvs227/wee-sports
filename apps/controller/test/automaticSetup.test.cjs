const {test} = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise,resolve};}

async function fixture({sensorError = false} = {}) {
  const {AutomaticControllerSetup} = await import('../src/automaticSetup.js');
  const calls = [], motions = [];
  const session = {seat:{code:'K7PM',slot:0,sport:'bowling',phase:'ready',gameId:'g1',inputGeneration:1,players:[{slot:0,setup:null,ready:false}]},
    async request(event,payload) {calls.push({event,payload}); return {ok:true};}};
  const flow = new AutomaticControllerSetup({session,makeMotion(status) {
    const motion = {status,stopped:false,stop(){this.stopped=true;},async calibrate(){if(sensorError) throw new Error('denied');}};
    motions.push(motion); return motion;
  }});
  return {flow,session,calls,motions};
}

test('a missing TV does not trigger repeated ready requests; returning resumes automatic readiness', async () => {
  const {flow,session,calls}=await fixture({sensorError:true});
  session.seat.paused=true;
  flow.update(session.seat,'online');await tick();
  for(let i=0;i<5;i++){flow.update(session.seat,'online');await tick();}
  assert.equal(calls.filter(call=>call.event==='player:ready').length,0);
  session.seat.paused=false;
  flow.update(session.seat,'online');await tick();
  assert.deepEqual(calls.filter(call=>call.event==='player:ready'),[{event:'player:ready',payload:{ready:true,skipTutorial:true}}]);
  flow.stop();
});

test('native auto-ready requires real sample readiness and accepted setup', async () => {
  const {flow,session,calls,motions} = await fixture();
  const setupAck = deferred();
  session.request = async (event,payload) => {calls.push({event,payload}); return event === 'player:setup' ? setupAck.promise : {ok:true};};
  flow.update(session.seat,'online'); await tick();
  assert.equal(calls.length,0,'permission availability alone does not make a player ready');
  motions[0].status({state:'ready'}); await tick();
  assert.deepEqual(calls,[{event:'player:setup',payload:{setup:'motion'}}]);
  setupAck.resolve({ok:true}); await tick();
  assert.equal(calls.at(-1).event,'player:ready');
  assert.equal(session.inputSetup,'motion');
  flow.stop();
});

test('native sensor denial selects touch and auto-readies without another setup tap', async () => {
  const {flow,session,calls,motions} = await fixture({sensorError:true});
  flow.update(session.seat,'online'); await tick();
  assert.equal(motions[0].stopped,true);
  assert.equal(flow.mode,'touch');
  assert.deepEqual(calls.map(call=>call.event),['player:setup','player:ready']);
  assert.equal(calls[0].payload.setup,'buttons');
  flow.stop();
});

test('tennis uses motion readiness instead of silently forcing touch mode', async () => {
  const {flow,session,calls,motions} = await fixture();
  session.seat.sport = 'tennis';
  flow.update(session.seat,'online'); await tick();
  assert.equal(motions.length,1);
  assert.equal(calls.length,0);
  motions[0].status({state:'ready'}); await tick();
  assert.equal(session.inputSetup,'motion');
  assert.equal(calls.at(-1).event,'player:ready');
  flow.stop();
});

test('old sensor callbacks cannot ready after background; foreground warms automatically', async () => {
  const {flow,session,calls,motions} = await fixture();
  flow.update(session.seat,'online'); await tick();
  flow.update(session.seat,'suspended'); motions[0].status({state:'ready'}); await tick();
  assert.equal(calls.length,0);
  flow.update(session.seat,'online'); await tick();
  assert.equal(motions.length,2);
  assert.equal(calls.length,0);
  motions[1].status({state:'ready'}); await tick();
  assert.equal(calls.at(-1).event,'player:ready');
  flow.stop();
});



test('samples lost while setup acknowledgement is pending cannot auto-ready stale motion', async () => {
  const {flow,session,calls,motions} = await fixture();
  const pending = deferred();
  session.request = async (event,payload) => {calls.push({event,payload}); return payload.setup === 'motion' ? pending.promise : {ok:true};};
  flow.update(session.seat,'online'); await tick();
  motions[0].status({state:'ready'}); motions[0].status({state:'warming'});
  pending.resolve({ok:true}); await tick();
  assert.equal(calls.some(call=>call.event === 'player:ready'),false);
  assert.deepEqual(calls.at(-1),{event:'player:setup',payload:{setup:null}});
  assert.equal(session.inputSetup,null);
  flow.stop();
});



test('a failed motion attempt offers retry and does not silently become the permanent preference', async () => {
  const {flow,session,motions} = await fixture({sensorError:true});
  flow.update(session.seat,'online'); await tick();
  assert.equal(flow.mode,'touch');assert.equal(flow.requestedMode,'motion');
  assert.equal(flow.motionIssue.message,'denied');
  flow.select('motion');await tick();
  assert.equal(motions.length,2,'Try motion starts a real new sensor attempt');
  flow.update(session.seat,'suspended');flow.update(session.seat,'online');await tick();
  assert.equal(motions.length,3,'returning can recover after a temporary sensor failure');
  flow.select('touch');await tick();
  flow.update(session.seat,'suspended');flow.update(session.seat,'online');await tick();
  assert.equal(motions.length,3,'explicit touch preference survives reconnect');
  assert.equal(flow.motionIssue,null);
  flow.stop();
});

test('Wait for friends cancels countdown without automatically readying again', async () => {
  const {flow,session,calls,motions} = await fixture();
  flow.update(session.seat,'online'); motions[0].status({state:'ready'}); await tick();
  session.seat.players[0].setup = 'motion';
  session.seat.phase = 'countdown'; flow.update(session.seat,'online');
  await flow.waitForFriends();
  assert.deepEqual(calls.at(-1),{event:'player:ready',payload:{ready:false}});
  const before = calls.length;
  session.seat.phase = 'ready'; flow.update(session.seat,'online'); await tick();
  assert.equal(calls.length,before);
  flow.play(); await tick();
  assert.deepEqual(calls.at(-1),{event:'player:ready',payload:{ready:true,skipTutorial:true}});
  flow.stop();
});
