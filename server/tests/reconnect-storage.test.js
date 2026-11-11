import {afterEach,beforeEach,expect,test,vi} from 'vitest';

let reconnect, values;
beforeEach(async()=>{
  vi.resetModules();values=new Map();
  vi.stubGlobal('window',{localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  reconnect=await import('@client/lib/reconnect.js');
});
afterEach(()=>vi.unstubAllGlobals());

test('a phone return shortcut requires its own scoped private proof',()=>{
  const {saveToken,clearToken,lastPlayerRoom,lastHostRoom,loadToken}=reconnect;
  saveToken('host','K7PM','host-secret');
  expect(lastPlayerRoom()).toBe(null);
  saveToken('player','K7PM','player-secret');
  expect(lastPlayerRoom()).toBe('K7PM');
  saveToken('player','Q2RT','other-secret');
  clearToken('player','K7PM');
  expect(lastPlayerRoom()).toBe('Q2RT');
  expect(lastHostRoom()).toBe('K7PM');
  expect(loadToken('host','K7PM')).toBe('host-secret');
  clearToken('player','Q2RT');
  expect(lastPlayerRoom()).toBe(null);
  expect(values.has('wee:last-player-room')).toBe(false);
});

test('a shortcut survives reload but an orphan public room code cannot restore a seat',async()=>{
  reconnect.saveToken('player','K7PM','private');
  vi.resetModules();reconnect=await import('@client/lib/reconnect.js');
  expect(reconnect.lastPlayerRoom()).toBe('K7PM');
  values.delete('wee:session:v2:player:K7PM');
  expect(reconnect.lastPlayerRoom()).toBe(null);
});

test('blocked storage supports same-tab home and return, then forgetting the room',()=>{
  Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked');}});
  expect(reconnect.saveToken('player','K7PM','private')).toBe(false);
  expect(reconnect.lastPlayerRoom()).toBe('K7PM');
  reconnect.clearToken('player','K7PM');
  expect(reconnect.lastPlayerRoom()).toBe(null);
});
