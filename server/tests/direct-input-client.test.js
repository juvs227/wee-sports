import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createDirectInput} from '@client/lib/directInput.js';

class Socket {
  connected = true; handlers = new Map(); sent = []; grant = true;
  io = {engine:{transport:{name:'websocket'}}};
  on(name,fn) {this.handlers.set(name,fn);}
  off(name) {this.handlers.delete(name);}
  dispatch(name,value) {this.handlers.get(name)?.(value);}
  timeout() {return {emit:(name,value,ack) => {
    this.sent.push({name,value});
    ack?.(null,name === 'direct:register' ? {ok:this.grant,leaseMs:3000} : {ok:true});
  }};}
}
class Channel {
  label = 'wee-input-v1'; readyState = 'open'; bufferedAmount = 0; sent = []; drop = false;
  send(value) {this.sent.push(value); if (!this.drop) Promise.resolve().then(() => this.other?.onmessage?.({data:value}));}
  close() {this.readyState = 'closed';}
}
class PC {
  static all = [];
  connectionState = 'connected';
  constructor(config) {this.config = config; PC.all.push(this);}
  createDataChannel(_name,options) {this.options = options; return this.channel = new Channel();}
  async createOffer() {return {type:'offer',sdp:'test'};}
  async createAnswer() {return {type:'answer',sdp:'test'};}
  async setLocalDescription(value) {this.localDescription = value;}
  async setRemoteDescription(value) {this.remoteDescription = value;}
  async addIceCandidate() {}
  close() {this.connectionState = 'closed';}
}
const scope = {gameId:'game-one',generation:2,hostEpoch:1};
const swing = (id = 'stroke-one') => ({...scope,type:'swing',id,label:'Forehand',hand:'Right',power:.6,aim:.5,depth:0,netNormal:[0,0,1],swingNormal:[1,0,0]});
const result = id => ({gameId:scope.gameId,id,player:1,result:'hit',reason:'Good contact',receivedToContactMs:30});
const flush = async () => {for(let index=0;index<12;index++) await Promise.resolve();};
let cleanup = [];
beforeEach(() => {vi.useFakeTimers();vi.setSystemTime(10000);PC.all=[];cleanup=[];});
afterEach(() => {cleanup.forEach(fn=>fn());vi.clearAllTimers();vi.useRealTimers();});
async function fixture(sport = 'tennis') {
  const tvSocket = new Socket(), phoneSocket = new Socket();
  const onSwing = vi.fn(()=>true), onStrokeResult = vi.fn();
  const tv = createDirectInput({socket:tvSocket,context:{...scope,role:'host',sport},PeerConnection:PC,onSwing});
  const phone = createDirectInput({socket:phoneSocket,context:{...scope,role:'player',player:1,sport},PeerConnection:PC,onStrokeResult});
  cleanup.push(tv.dispose,phone.dispose);
  const pair = {...scope,pairId:'private-pair',player:1,sport};
  tvSocket.dispatch('direct:peer',{...pair,role:'host'});
  phoneSocket.dispatch('direct:peer',{...pair,role:'player'});
  const a = PC.all[0].channel, b = new Channel(); a.other=b;b.other=a;
  PC.all[1].ondatachannel({channel:b});
  a.onopen?.(); b.onopen?.(); await flush();
  return {tv,phone,tvSocket,phoneSocket,onSwing,onStrokeResult,a,b,pair};
}

test('unsupported browsers use the existing relay without negotiation',()=>{
  const socket = new Socket();
  const input = createDirectInput({socket,context:{...scope,role:'player',sport:'tennis'},PeerConnection:null});
  expect(input.sendSwing(swing())).toBe(null);
  expect(socket.sent).toEqual([]);input.dispose();
});

test('polling relay sends no optional lease traffic and a WebSocket upgrade enables negotiation',async()=>{
  const socket=new Socket();socket.io.engine.transport.name='polling';
  const input=createDirectInput({socket,context:{...scope,role:'player',player:1,sport:'tennis'},PeerConnection:PC});
  cleanup.push(input.dispose);
  await vi.advanceTimersByTimeAsync(5000);
  expect(socket.sent).toEqual([]);expect(input.sendSwing(swing())).toBe(null);
  socket.io.engine.transport.name='websocket';await vi.advanceTimersByTimeAsync(250);
  expect(socket.sent.some(event=>event.name==='direct:register')).toBe(true);
});

test('a transport downgrade closes direct input without putting cleanup traffic ahead of polling swings',async()=>{
  const f=await fixture(), before=f.phoneSocket.sent.length;
  f.phoneSocket.io.engine.transport.name='polling';
  expect(f.phone.sendSwing(swing())).toBe(null);
  await vi.advanceTimersByTimeAsync(250);f.phone.dispose();
  expect(PC.all[1].connectionState).toBe('closed');
  expect(f.phoneSocket.sent).toHaveLength(before);
});

test('healthy LAN swing is admitted once and receives correlated feedback',async()=>{
  const f = await fixture();
  expect(PC.all[0].config).toEqual({iceServers:[]});
  expect(PC.all[0].options).toEqual({ordered:false});
  const pending = f.phone.sendSwing(swing());expect(pending).not.toBe(null);await flush();
  expect(await pending).toEqual({ok:true,id:'stroke-one',receivers:1});
  expect(f.onSwing).toHaveBeenCalledExactlyOnceWith({...swing(),player:1});
  expect(f.tv.sendStrokeResult(result('unknown'))).toBe(false);
  expect(f.tv.sendStrokeResult(result('stroke-one'))).toBe(true);await flush();
  expect(f.onStrokeResult).toHaveBeenCalledExactlyOnceWith(result('stroke-one'));
  expect(f.tv.sendStrokeResult(result('stroke-one'))).toBe(false);
});

test('an emitted swing with a lost acknowledgement never becomes a relay retry',async()=>{
  const f = await fixture();f.a.drop = true;
  const pending = f.phone.sendSwing(swing());await flush();
  expect(f.onSwing).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1200);
  expect(await pending).toEqual({ok:false,error:'outcome-unknown',id:'stroke-one'});
  expect(f.phoneSocket.sent.some(event=>event.name==='player:swing')).toBe(false);
  expect(await f.phone.sendSwing(swing())).toMatchObject({ok:false,error:'duplicate-swing'});
});

test('a brief TV main-thread stall does not silently discard a discrete tennis swing',async()=>{
  const f=await fixture();f.b.drop=true;
  const pending=f.phone.sendSwing(swing());
  const raw=f.b.sent.find(value=>JSON.parse(value).kind==='swing');
  // The socket relay would still deliver this action. A direct channel must
  // not turn a short render stall into an invisible missed swing instead.
  await vi.advanceTimersByTimeAsync(180);
  f.a.onmessage({data:raw});await flush();
  expect(f.onSwing).toHaveBeenCalledExactlyOnceWith({...swing(),player:1});
  expect(await pending).toMatchObject({ok:true});
});

test.each([250,251,-161])('direct tennis accepts only its bounded input age: %sms',async age=>{
  const f=await fixture();f.b.drop=true;
  const pending=f.phone.sendSwing(swing());
  const packet=JSON.parse(f.b.sent.find(value=>JSON.parse(value).kind==='swing'));
  if(age<0)packet.at-=age;
  else await vi.advanceTimersByTimeAsync(age);
  f.a.onmessage({data:JSON.stringify(packet)});await flush();
  expect(f.onSwing).toHaveBeenCalledTimes(age===250?1:0);
  expect(await pending).toMatchObject(age===250?{ok:true}:{ok:false,error:'input-expired'});
  expect(f.phoneSocket.sent.some(event=>event.name==='player:swing')).toBe(false);
});

test('fresh tennis result after a brief phone stall still reaches the controller',async()=>{
  const f=await fixture();const pending=f.phone.sendSwing(swing());await flush();await pending;
  f.a.drop=true;expect(f.tv.sendStrokeResult(result('stroke-one'))).toBe(true);
  const raw=f.a.sent.find(value=>JSON.parse(value).kind==='result');
  await vi.advanceTimersByTimeAsync(180);f.b.onmessage({data:raw});await flush();
  expect(f.onStrokeResult).toHaveBeenCalledExactlyOnceWith(result('stroke-one'));
  f.b.onmessage({data:raw});expect(f.onStrokeResult).toHaveBeenCalledTimes(1);
});

test('congested or closed data channels fall back before sending and never queue input',async()=>{
  const f = await fixture();f.b.bufferedAmount = 25;
  expect(f.phone.sendSwing(swing())).toBe(null);
  expect(f.b.sent.map(raw=>JSON.parse(raw).kind)).not.toContain('swing');
  f.b.bufferedAmount = 0;f.phoneSocket.dispatch('direct:closed',{pairId:f.pair.pairId});
  expect(f.phone.sendSwing(swing())).toBe(null);
});

test.each(['disconnect','dispose','lease'])('departures invalidate a pending direct action: %s',async mode=>{
  const f = await fixture();f.a.drop = true;
  const pending=f.phone.sendSwing(swing());await flush();
  if(mode==='disconnect'){f.phoneSocket.connected=false;f.phoneSocket.dispatch('disconnect');}
  else if(mode==='dispose')f.phone.dispose();
  else{f.phoneSocket.grant=false;await vi.advanceTimersByTimeAsync(1000);}
  expect(await pending).toMatchObject({ok:false,error:'outcome-unknown'});
  expect(f.phone.sendSwing(swing('new'))).toBe(null);
  expect(f.onStrokeResult).not.toHaveBeenCalled();
});



test('peer identity cannot choose another player and server-like rate budgets remain enforced',async()=>{
  const f=await fixture();
  for(let i=0;i<24;i++) {f.phone.sendSwing({...swing('stroke-'+i),player:2});await flush();}
  expect(f.onSwing).toHaveBeenCalledTimes(20);
  expect(f.onSwing.mock.calls.every(([event])=>event.player===1)).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  const next=f.phone.sendSwing(swing('next'));await flush();expect((await next).ok).toBe(true);
});



test('unavailable ICE negotiation backs off instead of recreating peers continuously',async()=>{
  const socket=new Socket();
  const input=createDirectInput({socket,context:{...scope,role:'player',player:1,sport:'tennis'},PeerConnection:PC});
  cleanup.push(input.dispose);
  socket.dispatch('direct:peer',{...scope,pairId:'no-ice',player:1,sport:'tennis',role:'player'});
  await vi.advanceTimersByTimeAsync(7000);
  expect(PC.all[0].connectionState).toBe('closed');
  const opens=()=>socket.sent.filter(event=>event.name==='direct:open').length;
  expect(opens()).toBe(0);
  await vi.advanceTimersByTimeAsync(4000);expect(opens()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);expect(opens()).toBe(1);
  expect(input.sendSwing(swing())).toBe(null);
});

test('only protocol fields cross the channel and in-flight action bookkeeping stays bounded',async()=>{
  const f=await fixture();
  const cyclic={};cyclic.self=cyclic;
  const first=f.phone.sendSwing({...swing('clean'),unexpected:cyclic,large:1n});await flush();
  expect((await first).ok).toBe(true);
  expect(f.onSwing.mock.calls[0][0]).toEqual({...swing('clean'),player:1});
  f.a.drop=true;
  for(let i=0;i<32;i++){f.phone.sendSwing(swing('pending-'+i));await flush();}
  expect(await f.phone.sendSwing(swing('over-limit'))).toMatchObject({ok:false,error:'rate-limited'});
  expect(f.b.sent.filter(raw=>JSON.parse(raw).event?.id==='over-limit')).toHaveLength(0);
});

test('a browser that refuses peer construction releases the broker pair and stops negotiation',async()=>{
  const socket=new Socket();
  const input=createDirectInput({socket,context:{...scope,role:'player',player:1,sport:'tennis'},PeerConnection:class{constructor(){throw new Error('unavailable');}}});
  cleanup.push(input.dispose);
  socket.dispatch('direct:peer',{...scope,pairId:'unsupported',player:1,sport:'tennis',role:'player'});
  expect(socket.sent.some(event=>event.name==='direct:close'&&event.value.pairId==='unsupported')).toBe(true);
  const messages=socket.sent.length;
  await vi.advanceTimersByTimeAsync(10000);expect(socket.sent.length).toBe(messages);
  expect(input.sendSwing(swing())).toBe(null);
});
