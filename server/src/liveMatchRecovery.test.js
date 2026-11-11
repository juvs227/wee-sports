import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RoomStore} from './RoomStore.js';
import {PHASES, PROTOCOL_VERSION as v, RECONNECT_MS} from '../../shared/protocol.js';
import {ScoreSystem} from '../../src/Tennis/scoreSystem.ts';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';

function fixture(sport = 'bowling', count = 1) {
  let now = 1000;
  const store = new RoomStore({now:() => now});
  const capabilities = createControllerCapabilities();
  const host = store.createRoom('tv', {v,sport,capabilities});
  const seats = Array.from({length:count}, (_,i) => store.join(`p${i}`, {v,code:host.code,name:`Player ${i}`,capabilities}));
  const ready = () => seats.forEach((_,i) => {
    store.setSetup(`p${i}`, {setup:'buttons'});
    store.setReady(`p${i}`, {ready:true,skipTutorial:true});
  });
  const finish = () => {now += 5000; store.finishCountdown(host.code);};
  ready(); store.startGame('p0'); finish();
  let checkpoint;
  if (sport === 'tennis') {
    const score = new ScoreSystem(); score.awardPoint('player2','player1');
    checkpoint = {version:1,boundary:'point',score:score.checkpoint(),humanOpponent:count === 2,
      settings:{format:'full',assistance:'standard',botDifficulty:'standard',timingAssist:true,autoMove:true}};
  } else checkpoint = {version:1,boundary:'settled',match:{version:1,
    players:seats.map((seat,i) => ({player:i+1,name:seat.name})),deliveries:[]},
    pins:Array.from({length:10}, (_,i) => ({id:i+1,position:[i*.1,.4,-9],quaternion:[0,0,0,1],standing:true})),settings:{aim:.2}};
  const initial = store.lobby(host.code);
  const save = store.saveCheckpoint('tv',{gameId:initial.gameId,generation:initial.inputGeneration,hostEpoch:initial.hostEpoch,sport,
    rulesVersion:1,checkpointVersion:1,expectedRevision:0,payload:checkpoint});
  assert.equal(save.ok,true, save.error);
  return {store,host,seats,initial,checkpoint,ready,finish,advance:ms => {now += ms;}};
}

for (const [sport,count] of [['tennis',1],['tennis',2],['bowling',8]]) {
  test(`${sport}/${count}: returning keeps a private stable checkpoint and both choices are authoritative`, () => {
    const {store,host,initial,checkpoint,ready,finish} = fixture(sport,count);
    assert.equal(store.returnToLobby('tv',{gameId:initial.gameId}).ok,true);
    let lobby = store.lobby(host.code);
    assert.equal(lobby.phase,PHASES.READY); assert.equal(lobby.gameId,null); assert.equal(lobby.gameState,null);
    assert.equal(lobby.resumeGame.gameId,initial.gameId);
    assert.equal(JSON.stringify(lobby).includes('profileBindings'),false);
    assert.equal(JSON.stringify(lobby).includes('payload'),false);
    assert.equal(store.resolveMatch('p0',{gameId:initial.gameId,choice:'continue'}).error,'not-host');
    assert.equal(store.resolveMatch('tv',{gameId:initial.gameId,choice:'continue'}).error,'players-not-ready');
    ready(); assert.equal(store.startGame('p0').ok,false);
    assert.equal(store.resolveMatch('tv',{gameId:initial.gameId,choice:'continue'}).ok,true);
    finish(); lobby = store.lobby(host.code);
    assert.equal(lobby.phase,PHASES.GAME); assert.equal(lobby.gameId,initial.gameId);
    assert.ok(lobby.inputGeneration > initial.inputGeneration); assert.ok(lobby.hostEpoch > initial.hostEpoch);
    assert.deepEqual(store.recovery('tv',{gameId:lobby.gameId,hostEpoch:lobby.hostEpoch}).checkpoint.payload,checkpoint);
    store.returnToLobby('tv',{gameId:lobby.gameId});
    assert.equal(store.resolveMatch('tv',{gameId:initial.gameId,choice:'new'}).ok,true);
    ready(); store.startGame('p0'); finish();
    lobby = store.lobby(host.code); assert.notEqual(lobby.gameId,initial.gameId);
    assert.equal(store.recovery('tv',{gameId:lobby.gameId,hostEpoch:lobby.hostEpoch}).checkpoint,null);
  });
}

for (const navigation of [true,false]) test(`TV ${navigation ? 'navigation' : 'disconnect'} releases phone gameplay immediately and the room outlives the ordinary grace while players remain`, () => {
  const {store,host,initial,advance,ready} = fixture();
  store.disconnect('tv',navigation ? host.code : undefined);
  assert.equal(store.lobby(host.code).phase,PHASES.READY);
  assert.equal(store.lobby(host.code).resumeGame.gameId,initial.gameId);
  advance(RECONNECT_MS * 2); assert.deepEqual(store.expireDisconnected(),[]);
  const resumed = store.resume('tv-back',{v,code:host.code,role:'host',token:host.token});
  assert.equal(resumed.ok,true); assert.equal(resumed.phase,PHASES.READY);
  ready(); assert.equal(store.lobby(host.code).resumeGame.canContinue,true);
});

test('closing after pagehide uses the reserved identity; a stale/replaced TV cannot close its replacement', () => {
  const {store,host} = fixture();
  store.resume('new-tv',{v,code:host.code,role:'host',token:host.token});
  assert.equal(store.leaveSession('tv',{code:host.code,token:host.token},'host').ok,false);
  store.disconnect('new-tv',host.code);
  assert.equal(store.leaveSession('new-tv',{code:host.code,token:host.token},'host').closed,true);
  assert.equal(store.lobby(host.code),null);
});



test('setup interruption during a recovery countdown preserves the saved match', () => {
  const {store,host,initial,ready} = fixture();
  store.returnToLobby('tv',{gameId:initial.gameId}); ready();
  store.resolveMatch('tv',{gameId:initial.gameId,choice:'continue'});
  store.setSetup('p0',{setup:null});
  assert.equal(store.lobby(host.code).phase,PHASES.READY);
  assert.equal(store.lobby(host.code).resumeGame.gameId,initial.gameId);
});
