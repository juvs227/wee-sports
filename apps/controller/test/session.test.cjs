const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

async function fixture() {
  const { ControllerSession } = await import('../src/session.js');
  const { EVENTS } = await import('../../../shared/protocol.js');
  class Socket extends EventEmitter {
    connected = true;
    sendBuffer = [];
    io = { engine: { transport: { writable: true } } };
    sent = [];
    responses = new Map();
    volatile = { emit: (event, payload) => this.sent.push({ event, payload, volatile: true }),
      timeout: () => ({emit:(event,payload,ack) => {
        this.sent.push({event,payload,volatile:true});
        const response=this.responses.get(event);
        ack(response==='timeout' ? new Error('timeout') : null,response==='timeout' ? undefined : response || {ok:true});
      }}) };
    timeout() { return { emit: (event, payload, ack) => { this.sent.push({ event, payload }); const response = this.responses.get(event); ack(response === 'timeout' ? new Error('timeout') : null, response === 'timeout' ? undefined : response || { ok: true }); } }; }
    connect() { this.connected = true; super.emit('connect'); }
    disconnect() { this.connected = false; super.emit('disconnect'); }
  }
  const socket = new Socket();
  const feedback = [];
  let now = 1000;
  const session = new ControllerSession('https://game.example', { makeSocket: () => socket, now: () => now, feedback: event => feedback.push(event) });
  session.seat = { code: 'K7PM', slot: 0, phase: 'game', gameId: 'game-a', inputGeneration: 3, hostEpoch: 2, sport: 'bowling', paused: false };
  session.inputSetup='motion';
  return { session, socket, feedback, EVENTS, advance: ms => { now += ms; } };
}

test('room close, Home and Leave cannot be undone by a late resume response', async () => {
  for (const departure of ['closed','home','leave']) {
    const {session, socket, EVENTS} = await fixture();
    session.token='private-seat';
    const old = {...session.seat,token:session.token,ok:true};
    let complete;
    session.request = event => event === EVENTS.SESSION_RESUME ? new Promise(resolve=>{complete=resolve;}) : Promise.resolve({ok:true});
    const reconnect = session.onConnect();
    if (departure==='leave') await session.leave();
    else if (departure==='home') session.home();
    else socket.emit(EVENTS.ROOM_CLOSED,{code:old.code});
    complete(old); await reconnect;
    assert.equal(session.seat,null); assert.equal(session.token,null); assert.equal(session.playing(),false);
  }
});

test('a temporary resume timeout keeps the seat and retries without replaying motion', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const {session,socket,EVENTS}=await fixture();
  session.token='private-seat';
  const restored={...session.seat,ok:true,token:session.token};
  socket.responses.set(EVENTS.SESSION_RESUME,{ok:false,error:'outcome-unknown'});
  await session.onConnect();
  assert.equal(session.token,'private-seat');assert.equal(session.seat.gameId,'game-a');
  assert.equal(session.playing(),false);
  socket.responses.set(EVENTS.SESSION_RESUME,restored);
  t.mock.timers.tick(2000);
  for(let i=0;i<6;i++)await Promise.resolve();
  assert.equal(socket.sent.filter(event=>event.event===EVENTS.SESSION_RESUME).length,2);
  assert.equal(session.resuming,false);assert.equal(session.seat.gameId,'game-a');
  assert.equal(socket.sent.filter(event=>event.event===EVENTS.PLAYER_AIM).length,0);
  session.dispose();
});

test('only public HTTPS join links are accepted by the scanner', async () => {
  const { parseRoomLink, serverOrigin } = await import('../src/session.js');
  assert.deepEqual(parseRoomLink('https://game.example/join?code=K7PM'), { origin: 'https://game.example', code: 'K7PM' });
  for (const link of ['http://game.example/join?code=K7PM', 'https://u:p@game.example/join?code=K7PM',
    'https://game.example/host/K7PM', 'https://game.example/join?code=K7PM&token=private',
    'https://game.example/join?code=K7PM&code=2222', 'https://game.example/join?code=K7PM#token',
    'https://game.example/join?code=OOOO']) assert.throws(() => parseRoomLink(link));
  assert.equal(serverOrigin('http://10.0.2.2:5173', true), 'http://10.0.2.2:5173');
  assert.throws(() => serverOrigin('http://10.0.2.2:5173'));
  assert.throws(() => serverOrigin('https://game.example/private'));
});

test('latest aim is bounded and stamped from the active session, never client identity', async () => {
  const { session, socket, advance, EVENTS } = await fixture();
  assert.equal(session.latest('aim', { gameId: 'spoof', seq: 900, orientation: [0, 0, 0, 1] }), true);
  assert.equal(socket.sent[0].event, EVENTS.PLAYER_AIM);
  assert.equal(socket.sent[0].payload.gameId, 'game-a');
  assert.equal(socket.sent[0].payload.generation, 3);
  assert.equal(socket.sent[0].payload.hostEpoch, 2);
  assert.equal(socket.sent[0].payload.generation, 3);
  assert.equal(socket.sent[0].payload.hostEpoch, 2);
  assert.equal(socket.sent[0].payload.seq, 0);
  assert.equal(socket.sent[0].volatile, true);
  assert.equal(session.latest('aim', {}), false);
  advance(34);
  assert.equal(session.latest('aim', {}), true);
  assert.equal(socket.sent[1].payload.seq, 1);
  advance(34); socket.io.engine.transport.writable = false;
  assert.equal(session.latest('aim', {}), false);
  session.dispose();
});



test('Tools suspend gameplay while preserving live aim, setup, connection and deliberate game commands', async () => {
  const {session,socket,EVENTS,advance}=await fixture();
  session.setControlsActive(false);
  assert.equal(socket.connected,true);assert.equal(session.inputSetup,'motion');
  assert.equal((await session.action(EVENTS.PLAYER_SWING,{type:'swing'})).ok,false);
  assert.equal((await session.action(EVENTS.PLAYER_ROLL,{type:'roll'})).ok,false);
  assert.equal((await session.action(EVENTS.PLAYER_GAME_COMMAND,{action:'configure',settings:{assistance:'friendly'}})).ok,true);
  assert.equal(session.latest('aim',{reach:{x:0,y:0},angularVelocity:{x:0,y:0,z:0}}),true);
  session.inactive();session.foreground();
  assert.equal(session.controlsPlaying(),false,'an OS foreground callback cannot reopen controls behind Tools');
  session.setControlsActive(true);
  assert.equal(session.controlsPlaying(),true);
  session.seat.gameState={phase:'complete'};advance(17);
  assert.equal(session.controlsPlaying(),false);assert.equal(session.latest('aim',{}),false);
  assert.equal((await session.action(EVENTS.PLAYER_GAME_COMMAND,{action:'new-match'})).ok,true);
  session.dispose();
});

test('Leave releases the phone immediately even offline or with an unanswered server request', async () => {
  for (const connected of [false,true]) {
    const {session,socket,EVENTS}=await fixture();
    const saved=[],changes=[];
    session.save=value=>saved.push(value);session.changed=(seat,status)=>changes.push({seat,status});
    session.token='private-seat';socket.connected=connected;
    socket.timeout=()=>({emit:(event,payload)=>socket.sent.push({event,payload})});
    const leaving=session.leave();
    assert.equal(session.token,null);assert.equal(session.seat,null);assert.equal(socket.connected,false);
    assert.deepEqual(saved,[null]);assert.equal(changes.at(-1).status,'Left room');
    assert.equal(socket.sent.some(event=>event.event===EVENTS.PLAYER_LEAVE),connected);
    assert.equal((await leaving).ok,true);
    session.foreground();
    assert.equal(socket.connected,false);assert.equal(session.playing(),false);
    session.dispose();
  }
});

test('Home saves private return proof, marks the controller away and never auto-rejoins on foreground', async () => {
  const {session,socket,EVENTS}=await fixture();
  const saved=[],changes=[];let away=0;
  session.save=value=>saved.push(value);session.changed=(seat,status)=>changes.push({seat,status});
  session.token='private-seat';socket.on(EVENTS.SESSION_AWAY,()=>away++);
  socket.sendBuffer.push({oldMotion:true});
  session.home();
  assert.deepEqual(saved,[{origin:'https://game.example',code:'K7PM',token:'private-seat'}]);
  assert.equal(away,1);assert.equal(session.seat,null);assert.equal(session.token,null);
  assert.deepEqual(socket.sendBuffer,[]);assert.equal(session.latest('aim',{}),false);
  assert.deepEqual(changes.at(-1),{seat:null,status:'Ready to join'});
  session.background();session.foreground();
  assert.equal(socket.connected,false);assert.equal(changes.at(-1).status,'Ready to join');
  assert.equal((await session.restore(saved[0])).error,'room-ended','a stale Return continuation cannot reopen the detached session');
  assert.equal(session.token,null);assert.equal(session.seat,null);
  socket.connect();
  assert.equal(socket.connected,false,'even a late socket connect cannot reopen a parked controller');
  session.dispose();
});

test('Return uses the saved private seat; an expired room clears proof instead of retrying forever', async () => {
  for (const error of [null,'no-room','bad-session','recovery-owner-required']) {
    const {session,socket,EVENTS}=await fixture();
    const saved=[],changes=[];
    session.save=value=>saved.push(value);session.changed=(seat,status)=>changes.push({seat,status});
    const accepted={...session.seat,ok:true,token:'valid-private-seat'};
    socket.responses.set(EVENTS.SESSION_RESUME,error ? {ok:false,error} : accepted);
    await session.restore({code:'K7PM',token:'valid-private-seat'});
    assert.equal(changes[0].status,'offline','reconnection has a visible escape route before acknowledgment');
    assert.equal(socket.sent.find(event=>event.event===EVENTS.SESSION_RESUME).payload.token,'valid-private-seat');
    if (error) {
      assert.equal(session.seat,null);assert.deepEqual(saved,[null]);assert.equal(socket.connected,false);
      session.foreground();assert.equal(socket.connected,false);
    } else {
      assert.equal(session.seat.slot,0);assert.equal(changes.at(-1).status,'online');
      assert.equal(saved[0].token,'valid-private-seat');
    }
    session.dispose();
  }
});

test('native bowling drops transport congestion without retaining a delayed roll', async () => {
  const {session,socket,EVENTS}=await fixture();
  session.seat.sport='bowling';socket.io.engine.transport.writable=false;
  const result=await session.action(EVENTS.PLAYER_ROLL,{type:'roll',aim:.2,power:.5});
  assert.equal(result.error,'network-busy');
  socket.io.engine.transport.writable=true;
  assert.equal(socket.sent.some(event=>event.event===EVENTS.PLAYER_ROLL),false);
  session.dispose();
});

test('Home and Leave cancel a bowling roll waiting for transport before it can send', async () => {
  for (const departure of ['home','leave']) {
    const {session,socket,EVENTS}=await fixture();
    session.seat.sport='bowling';socket.io.engine.transport.writable=false;
    const pending=session.action(EVENTS.PLAYER_ROLL,{type:'roll',aim:.2,power:.5});
    await session[departure]();socket.io.engine.transport.writable=true;
    assert.equal((await pending).error,'not-playing');
    assert.equal(socket.sent.some(event=>event.event===EVENTS.PLAYER_ROLL),false);
    session.dispose();
  }
});

test('backgrounding cancels buffered input and cannot emit gameplay while suspended', async () => {
  const { session, socket, EVENTS } = await fixture();
  socket.sendBuffer.push({ old: true });
  session.background();
  assert.deepEqual(socket.sendBuffer, []);
  assert.equal(session.latest('aim', {}), false);
  assert.deepEqual(await session.action(EVENTS.PLAYER_ROLL, { type: 'roll' }), { ok: false, error: 'not-playing' });
  session.dispose();
});



test('bowling aim keeps 60 Hz fresh updates while rejecting same-tick bursts', async () => {
  const {session, socket, advance} = await fixture();
  for (let index = 0; index < 60; index++) {
    assert.equal(session.latest('aim', {aim: index / 60}), true);
    assert.equal(session.latest('aim', {aim: -1}), false);
    advance(index % 2 ? 18 : 15);
  }
  assert.equal(socket.sent.length, 60);
  session.dispose();
});

test('personalized lobby updates move a remaining native player into the new leader seat', async () => {
  const {session,socket,EVENTS}=await fixture();
  session.seat.slot=1;
  session.token='private-reconnect-token';
  socket.emit(EVENTS.LOBBY_UPDATE,{code:'K7PM',slot:0,name:'Riley',leaderSlot:0,canStart:true,phase:'ready',
    gameId:null,inputGeneration:4,players:[{slot:0,name:'Riley',setup:'motion',ready:true}]});
  assert.equal(session.seat.slot,0);
  assert.equal(session.seat.leaderSlot,session.seat.slot);
  assert.equal(session.seat.canStart,true);
  assert.equal(session.token,'private-reconnect-token','a personalized snapshot does not replace the private room token');
  assert.equal(session.playing(),false);
  session.dispose();
});

test('temporary native inactivity suppresses input without disconnecting, pausing or replaying old sequence IDs', async () => {
  const {session, socket, EVENTS, advance, feedback} = await fixture();
  session.token = 'reconnect-token';
  session.latest('aim', {reach:{x:0,y:0}});
  const sequence = socket.sent[0].payload.seq;
  const hit = {id:'once',gameId:'game-a',generation:3,hostEpoch:2};
  session.onFeedback(hit);
  session.inactive();
  assert.equal(socket.connected, true);
  assert.equal(session.latest('aim', {}), false);
  assert.equal((await session.action(EVENTS.PLAYER_SWING, {})).ok, false);
  session.foreground(); advance(17);
  assert.equal(session.latest('aim', {reach:{x:.2,y:0}}), true);
  assert.equal(socket.sent.at(-1).payload.seq, sequence + 1);
  session.onFeedback(hit);
  assert.equal(feedback.length,1);
  assert.equal(socket.sent.some(item => [EVENTS.SESSION_AWAY, EVENTS.SESSION_RESUME].includes(item.event)), false);
  session.dispose();
});

test('timed out deliberate action has one stable id and is never automatically resent', async () => {
  const { session, socket, EVENTS } = await fixture();
  socket.responses.set(EVENTS.PLAYER_ROLL, 'timeout');
  const response = await session.action(EVENTS.PLAYER_ROLL, { type: 'roll', aim: 0, power: .5, spin: 0 });
  assert.equal(response.error, 'outcome-unknown');
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].payload.id, response.id);
  assert.equal(socket.sent[0].payload.gameId, 'game-a');
  assert.deepEqual(socket.sendBuffer, []);
  session.dispose();
});

test('native tennis sends one expiring swing with its captured placement and stable identity', async () => {
  const {session,socket,EVENTS}=await fixture();
  session.seat.sport='tennis';
  const result=await session.action(EVENTS.PLAYER_SWING,{type:'swing',label:'Forehand',hand:'Right',power:.6,aim:-.4,depth:.25});
  assert.equal(result.ok,true);assert.equal(socket.sent.length,1);assert.equal(socket.sent[0].volatile,true);
  const {transportWaitMs=0,...delivered}=socket.sent[0].payload;
  assert.ok(Number.isFinite(transportWaitMs)&&transportWaitMs>=0&&transportWaitMs<160);
  assert.deepEqual(delivered,{type:'swing',label:'Forehand',hand:'Right',power:.6,aim:-.4,depth:.25,
    generation:3,hostEpoch:2,id:result.id,gameId:'game-a'});
  socket.responses.set(EVENTS.PLAYER_SWING,'timeout');
  const unknown=await session.action(EVENTS.PLAYER_SWING,{type:'swing',label:'Backhand',hand:'Right'});
  assert.equal(unknown.error,'outcome-unknown');assert.equal(socket.sent.length,2);
  assert.equal(socket.sent[1].payload.id,unknown.id);assert.deepEqual(socket.sendBuffer,[]);
  session.dispose();
});

test('native tennis tolerates brief handoff but drops old input through congestion', async () => {
  const {session,socket,EVENTS}=await fixture();
  session.seat.sport='tennis';
  const swing={type:'swing',label:'Forehand',hand:'Right',power:.5};
  socket.io.engine.transport.writable=false;
  const brief=session.action(EVENTS.PLAYER_SWING,swing);
  setTimeout(()=>{socket.io.engine.transport.writable=true;},8);
  assert.equal((await brief).ok,true);assert.equal(socket.sent.length,1);
  socket.io.engine.transport.writable=false;
  const pending=session.action(EVENTS.PLAYER_SWING,swing);
  assert.equal((await session.action(EVENTS.PLAYER_SWING,swing)).error,'network-busy');
  assert.equal((await pending).error,'network-busy');
  socket.io.engine.transport.writable=true;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(socket.sent.length,1,'restoring transport never replays the expired stroke');
  assert.deepEqual(socket.sendBuffer,[]);session.dispose();
});

test('a waiting native tennis stroke cannot cross Tools, pause, or replacement-game boundaries', async () => {
  for (const boundary of ['tools','pause','game']) {
    const {session,socket,EVENTS}=await fixture();
    session.seat.sport='tennis';socket.io.engine.transport.writable=false;
    const pending=session.action(EVENTS.PLAYER_SWING,{type:'swing',label:'Forehand',hand:'Right'});
    if(boundary==='tools') {session.setControlsActive(false);session.setControlsActive(true);}
    else if(boundary==='pause') {
      socket.emit(EVENTS.LOBBY_UPDATE,{...session.seat,paused:true,inputGeneration:4});
      socket.emit(EVENTS.LOBBY_UPDATE,{...session.seat,paused:false,inputGeneration:5});
    } else socket.emit(EVENTS.LOBBY_UPDATE,{...session.seat,gameId:'game-b',inputGeneration:4});
    socket.io.engine.transport.writable=true;
    assert.equal((await pending).error,'not-playing');assert.equal(socket.sent.length,0);
    session.dispose();
  }
});

test('feedback is scoped to the live match/generation and deduplicated', async () => {
  const { session, feedback } = await fixture();
  const event = { id: 'hit-a', gameId: 'game-a', generation: 3, hostEpoch: 2 };
  session.onFeedback({ ...event, generation: 2 });
  session.onFeedback({ ...event, gameId: 'game-old' });
  session.onFeedback(event); session.onFeedback(event);
  assert.equal(feedback.length, 1);
  session.background(); session.onFeedback({ ...event, id: 'hit-b' });
  assert.equal(feedback.length, 1);
  session.dispose();
});

test('resume revalidates setup instead of replaying pre-interruption input', async () => {
  const { session, socket, EVENTS } = await fixture();
  session.token = 'private-reconnect-token';
  socket.responses.set(EVENTS.SESSION_RESUME, { ok: true, ...session.seat, inputGeneration: 4, token: session.token });
  socket.sendBuffer.push({ old: true });
  session.background(); session.foreground();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.seat.inputGeneration, 4);
  assert.deepEqual(socket.sendBuffer, []);
  assert.ok(socket.sent.some(item => item.event === EVENTS.PLAYER_SETUP && item.payload.setup === null));
  assert.equal(socket.sent.filter(item => item.event === EVENTS.PLAYER_AIM).length, 0);
  session.dispose();
});

test('bowling delivery latch advances only for an authoritative delivery or match boundary', async () => {
  const {session} = await fixture();
  session.seat = {...session.seat,sport:'bowling',gameState:{phase:'ready',frame:1,currentPlayer:1}};
  session.observeBowlingTurn(); const first = session.bowlingTurnKey;
  session.seat.paused = true; session.seat.inputGeneration++; session.observeBowlingTurn();
  assert.equal(session.bowlingTurnKey,first,'pause does not authorize another roll');
  session.seat.paused = false; session.seat.inputGeneration++; session.observeBowlingTurn();
  assert.equal(session.bowlingTurnKey,first,'resume does not authorize another roll');
  session.seat.gameState.phase='rolling'; session.observeBowlingTurn();
  assert.equal(session.bowlingTurnKey,first);
  session.seat.gameState.phase='ready'; session.observeBowlingTurn();
  assert.notEqual(session.bowlingTurnKey,first,'next ball with same player and frame is a new delivery');
  session.dispose();
});

test('late resume acknowledgements cannot reactivate a backgrounded controller', async () => {
  const {session,socket,EVENTS} = await fixture();
  const changes = [];
  session.changed = (seat,state) => changes.push(state);
  session.token = 'private-reconnect-token';
  let resume;
  socket.timeout = () => ({emit(event,payload,ack) {
    socket.sent.push({event,payload});
    if(event === EVENTS.SESSION_RESUME) resume = ack;
    else ack(null,{ok:true});
  }});
  const pending = session.onConnect();
  session.background();
  resume(null,{ok:true,...session.seat,inputGeneration:4});
  await pending;
  assert.equal(changes.includes('online'),false);
  assert.equal(socket.sent.some(value=>value.event === EVENTS.PLAYER_SETUP),false);
  assert.equal(session.seat.inputGeneration,3);
  session.dispose();
});
