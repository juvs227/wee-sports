import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import {io as connectClient} from 'socket.io-client';
import {createDirectInputBroker} from './directInputBroker.js';
import {RoomStore} from './RoomStore.js';
import {createGameServer} from './app.js';
import {EVENTS, PROTOCOL_VERSION as v} from '../../shared/protocol.js';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';

const capabilities = createControllerCapabilities({buttons:true});
const sdp = 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 00:11\r\n';

function fixture(t, {sport = 'tennis', count = 2} = {}) {
  let time = 0;
  const store = new RoomStore({now:() => time});
  const io = new EventEmitter(); io.sockets = {sockets:new Map()};
  const broker = createDirectInputBroker({io,store,now:() => time,sweepMs:60000});
  t.after(() => broker.close());
  const socket = id => {
    const handlers = new Map(), sent = [];
    const value = {id,connected:true,sent,
      on(event,fn) {handlers.set(event,fn);}, once(event,fn) {handlers.set(event,fn);},
      emit(event,payload) {sent.push({event,payload});},
      request(event,payload) {let result; handlers.get(event)(payload,reply => {result = reply;}); return result;},
      disconnect() {value.connected=false;handlers.get('disconnect')?.();store.disconnect(id);},
    };
    io.sockets.sockets.set(id,value); io.emit('connection',value); return value;
  };
  const host = socket('host'), phones = Array.from({length:count},(_,index) => socket(`phone${index}`));
  const room = store.createRoom(host.id,{v,sport,capabilities});
  const seats = phones.map((phone,index) => store.join(phone.id,{v,code:room.code,name:`P${index}`,capabilities}));
  for (const phone of phones) {store.setSetup(phone.id,{setup:'buttons'});store.setReady(phone.id,{ready:true});}
  assert.equal(store.startGame(phones[0].id).ok,true); time += 5000;
  store.finishCountdown(room.code);
  if (store.lobby(room.code).phase==='vote') for (const phone of phones) store.vote(phone.id,{watch:false});
  assert.equal(store.lobby(room.code).phase,'game');
  const context = () => {const state=store.lobby(room.code);return {gameId:state.gameId,generation:state.inputGeneration,hostEpoch:state.hostEpoch};};
  const register = peer => peer.request('direct:register',context());
  const open = (phone=phones[0]) => {assert.equal(register(host).ok,true);assert.equal(register(phone).ok,true);return phone.request('direct:open',context());};
  return {store,io,broker,host,phones,phone:phones[0],room,seats,socket,context,register,open,advance:ms => {time += ms;}};
}

for (const sport of ['tennis']) test(`${sport}: signaling binds each of two phones to its authenticated TV/slot without leaking identities`, t => {
  const f=fixture(t,{sport});
  const first=f.open(), second=f.open(f.phones[1]);
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.notEqual(first.pairId,second.pairId);
  const invitations=f.host.sent.filter(item=>item.event==='direct:peer').map(item=>item.payload);
  assert.deepEqual(invitations.map(value=>value.player),[1,2]);
  assert.ok(invitations.every(value=>value.role==='host' && value.sport===sport && value.leaseMs===3000));
  for (const invitation of invitations) {
    assert.deepEqual(Object.keys(invitation).sort(),['gameId','generation','hostEpoch','leaseMs','pairId','player','role','sport']);
    assert.equal(JSON.stringify(invitation).includes(f.room.token),false);
    assert.equal(JSON.stringify(invitation).includes(f.seats[0].token),false);
  }
  assert.equal(f.phone.request('direct:open',f.context()).pairId,first.pairId,'repeated open does not allocate more peers');
  assert.equal(f.host.sent.filter(item=>item.event==='direct:peer').length,2);
  assert.equal(f.host.request('direct:signal',{pairId:first.pairId,description:{type:'offer',sdp}}).ok,true);
  assert.equal(f.phone.sent.at(-1).payload.description.type,'offer');
  assert.equal(f.phone.request('direct:signal',{pairId:first.pairId,description:{type:'answer',sdp}}).ok,true);
  assert.equal(f.host.sent.at(-1).payload.description.type,'answer');
  assert.equal(f.phone.request('direct:signal',{pairId:first.pairId,candidate:null}).ok,true);
  assert.deepEqual(f.host.sent.at(-1).payload,{pairId:first.pairId,candidate:null});
});

test('foreign members, unauthenticated sockets and the host cannot impersonate a phone or address another peer', t => {
  const f=fixture(t), pair=f.open(), stranger=f.socket('stranger');
  assert.equal(stranger.request('direct:register',f.context()).ok,false);
  assert.equal(stranger.request('direct:open',{...f.context(),target:f.host.id}).ok,false);
  assert.equal(stranger.request('direct:signal',{pairId:pair.pairId,candidate:null}).error,'unknown-peer');
  assert.equal(stranger.request('direct:close',{pairId:pair.pairId}).ok,false);
  f.register(f.phones[1]);
  assert.equal(f.phones[1].request('direct:signal',{pairId:pair.pairId,candidate:null}).error,'unknown-peer');
  assert.equal(f.host.request('direct:open',f.context()).error,'not-controller');
  const other=f.store.createRoom(stranger.id,{v,sport:'tennis',capabilities});
  assert.equal(other.ok,true);
  assert.equal(stranger.request('direct:signal',{pairId:pair.pairId,description:{type:'offer',sdp}}).error,'unknown-peer');
  assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate:null}).ok,true);
});

test('bowling and a missing controller setup never get a direct gameplay channel', t => {
  const f=fixture(t,{sport:'bowling'});
  assert.equal(f.register(f.host).ok,false);assert.equal(f.register(f.phone).ok,false);
  assert.equal(f.phone.request('direct:open',f.context()).ok,false);
});

for (const change of ['pause','setup','lobby','close','host-replacement','phone-replacement','disconnect']) {
  test(`a ${change} invalidates direct signaling and notifies both peers`, t => {
    const f=fixture(t), pair=f.open(), old=f.context();
    if (change==='pause') f.store.setPaused(f.host.id,{gameId:old.gameId,paused:true});
    if (change==='setup') f.store.setSetup(f.phone.id,{setup:null});
    if (change==='lobby') f.store.returnToLobby(f.host.id,{gameId:old.gameId},'host');
    if (change==='close') f.store.leaveSession(f.host.id,{code:f.room.code,token:f.room.token},'host');
    if (change==='host-replacement' || change==='phone-replacement') {
      const host=change==='host-replacement', replacement=f.socket('replacement');
      assert.equal(f.store.resume(replacement.id,{v,code:f.room.code,role:host?'host':'player',token:host?f.room.token:f.seats[0].token}).ok,true);
    }
    if (change==='disconnect') f.phone.disconnect();
    f.broker.sync();
    assert.ok(f.host.sent.some(item=>item.event==='direct:closed' && item.payload.pairId===pair.pairId));
    assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate:null}).error,'unknown-peer');
    assert.equal(f.phone.request('direct:open',old).ok,false);
  });
}

test('leases must be renewed by both current sockets; expiry cannot be extended by signaling traffic', t => {
  const f=fixture(t), pair=f.open();
  f.advance(2500);assert.equal(f.register(f.host).ok,true);
  assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate:null}).ok,true);
  f.advance(501);f.broker.sync();
  assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate:null}).error,'unknown-peer');
  assert.ok(f.host.sent.some(item=>item.event==='direct:closed'));
  const next=f.open();assert.equal(next.ok,true);assert.notEqual(next.pairId,pair.pairId);
});

test('late old-generation register/unregister cannot delete a newly authorized channel', t => {
  const f=fixture(t), previous=f.context(); f.open();
  f.store.setPaused(f.host.id,{gameId:previous.gameId,paused:true});
  f.store.setPaused(f.host.id,{gameId:previous.gameId,paused:false});
  const pair=f.open();assert.equal(pair.ok,true);assert.notEqual(f.context().generation,previous.generation);
  assert.equal(f.phone.request('direct:unregister',previous).ok,false);
  assert.equal(f.phone.request('direct:register',previous).ok,false);
  assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate:null}).ok,true);
  assert.equal(f.phone.request('direct:unregister',f.context()).ok,true);
  assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate:null}).error,'unknown-peer');
});

test('signaling bounds SDP, media, roles, candidate shape and repeated descriptions', t => {
  const f=fixture(t), pair=f.open();
  for (const description of [{type:'answer',sdp},{type:'offer',sdp:'x'.repeat(6600)},
    {type:'offer',sdp:sdp+'m=audio 9 RTP/AVP 0\r\n'},{type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'}]) {
    assert.equal(f.host.request('direct:signal',{pairId:pair.pairId,description}).error,'bad-signal');
  }
  for (const candidate of [{candidate:'https://other.test'}, {candidate:'candidate:'+'x'.repeat(2050)},
    {candidate:'candidate:123',sdpMLineIndex:9},{candidate:'candidate:123',usernameFragment:123},[]]) {
    assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate}).error,'bad-signal');
  }
  assert.equal(f.host.request('direct:signal',{pairId:pair.pairId,description:{type:'offer',sdp},candidate:null}).error,'bad-signal');
  assert.equal(f.host.request('direct:signal',{pairId:pair.pairId,description:{type:'offer',sdp}}).ok,true);
  assert.equal(f.host.request('direct:signal',{pairId:pair.pairId,description:{type:'offer',sdp}}).error,'already-signaled');
  assert.equal(f.phone.request('direct:signal',{pairId:pair.pairId,candidate:{candidate:'candidate:1 1 udp 1 192.168.1.2 50000 typ host',sdpMid:'0',sdpMLineIndex:0,extra:'strip'}}).ok,true);
  assert.equal(Object.hasOwn(f.host.sent.at(-1).payload.candidate,'extra'),false);
});

test('candidate and request floods stay bounded without allocating extra pairs', t => {
  const f=fixture(t), pair=f.open();
  const results=Array.from({length:120},()=>f.phone.request('direct:signal',{pairId:pair.pairId,candidate:null}));
  assert.equal(results.filter(value=>value.ok).length,64);
  assert.ok(results.slice(64).every(value=>value.error==='rate-limited'));
  assert.equal(f.host.sent.filter(item=>item.event==='direct:signal').length,64);
});

test('peer heartbeats avoid public snapshots and room changes validate only that room', t => {
  const f=fixture(t,{count:1}), otherHost=f.socket('other-host'), otherPhone=f.socket('other-phone');
  const otherRoom=f.store.createRoom(otherHost.id,{v,sport:'tennis',capabilities});
  f.store.join(otherPhone.id,{v,code:otherRoom.code,name:'Other',capabilities});
  f.store.setSetup(otherPhone.id,{setup:'buttons'});f.store.setReady(otherPhone.id,{ready:true});
  f.store.startGame(otherPhone.id);f.advance(5000);f.store.finishCountdown(otherRoom.code);
  if(f.store.lobby(otherRoom.code).phase==='vote')f.store.vote(otherPhone.id,{watch:false});
  const other=f.store.lobby(otherRoom.code), otherScope={gameId:other.gameId,generation:other.inputGeneration,hostEpoch:other.hostEpoch};
  const first=f.open(), scope=f.context();
  otherHost.request('direct:register',otherScope);otherPhone.request('direct:register',otherScope);
  const second=otherPhone.request('direct:open',otherScope);
  assert.equal(second.ok,true);

  const contexts=[], original=f.store.directInputContext.bind(f.store);
  f.store.directInputContext=id=>{contexts.push(id);return original(id);};
  f.store.lobby=()=>{throw new Error('Signaling must not rebuild a public lobby snapshot');};
  f.store.sessionContext=()=>{throw new Error('Signaling must not build profile/player snapshots');};
  assert.equal(f.host.request('direct:register',scope).ok,true);
  assert.deepEqual(new Set(contexts),new Set([f.host.id,f.phone.id]));
  contexts.length=0;
  assert.equal(f.host.request('direct:signal',{pairId:first.pairId,description:{type:'offer',sdp}}).ok,true);
  assert.deepEqual(new Set(contexts),new Set([f.host.id,f.phone.id]));

  f.store.setPaused(otherHost.id,{gameId:other.gameId,paused:true});
  f.broker.sync(f.room.code);
  assert.equal(otherHost.sent.some(item=>item.event==='direct:closed'),false);
  contexts.length=0;f.broker.sync(otherRoom.code);
  assert.deepEqual(new Set(contexts),new Set([otherHost.id,otherPhone.id]));
  assert.ok(otherHost.sent.some(item=>item.event==='direct:closed'&&item.payload.pairId===second.pairId));
  assert.equal(f.host.sent.some(item=>item.event==='direct:closed'),false);

  f.advance(3001);f.broker.sync();
  assert.ok(f.host.sent.some(item=>item.event==='direct:closed'&&item.payload.pairId===first.pairId));
});

test('real sockets route signaling to the authenticated TV and revoke it immediately on a room pause', async t => {
  let time=0;
  const store=new RoomStore({now:()=>time}), app=createGameServer({store,tickMs:10}), clients=[];
  t.after(async()=>{clients.forEach(client=>client.disconnect());await app.close();});
  app.http.listen(0,'127.0.0.1');await once(app.http,'listening');
  const connect=async()=>{const socket=connectClient(`http://127.0.0.1:${app.http.address().port}`,{transports:['websocket'],reconnection:false});clients.push(socket);await once(socket,'connect');return socket;};
  const host=await connect(),phone=await connect();
  const send=(socket,event,payload={})=>socket.timeout(2000).emitWithAck(event,payload);
  const room=await send(host,EVENTS.HOST_CREATE,{v,sport:'tennis',capabilities});
  await send(phone,EVENTS.PLAYER_JOIN,{v,code:room.code,name:'Player',capabilities});
  await send(phone,EVENTS.PLAYER_SETUP,{setup:'buttons'});await send(phone,EVENTS.PLAYER_READY,{ready:true});
  await send(phone,EVENTS.PLAYER_START);time+=5000;store.finishCountdown(room.code);
  if (store.lobby(room.code).phase==='vote') store.vote(phone.id,{watch:false});
  const state=store.lobby(room.code), context={gameId:state.gameId,generation:state.inputGeneration,hostEpoch:state.hostEpoch};
  assert.equal((await send(host,'direct:register',context)).ok,true);assert.equal((await send(phone,'direct:register',context)).ok,true);
  const invitation=once(host,'direct:peer'), pair=await send(phone,'direct:open',context);
  assert.equal((await invitation)[0].pairId,pair.pairId);
  const offer=once(phone,'direct:signal');
  assert.equal((await send(host,'direct:signal',{pairId:pair.pairId,description:{type:'offer',sdp}})).ok,true);
  assert.equal((await offer)[0].description.type,'offer');
  const closed=once(phone,'direct:closed');
  assert.equal((await send(host,EVENTS.HOST_PAUSE,{gameId:state.gameId,paused:true})).ok,true);
  assert.equal((await closed)[0].pairId,pair.pairId);
  assert.equal((await send(phone,'direct:signal',{pairId:pair.pairId,candidate:null})).error,'unknown-peer');
});
