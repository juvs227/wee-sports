const {test}=require('node:test');
const assert=require('node:assert/strict');

test('Forget cannot be overwritten by an older room save finishing late',async()=>{
  const {createPrivateWriteQueue}=await import('../src/privateWriteQueue.js');
  let finishSave;const values=new Map(),calls=[];
  const write=createPrivateWriteQueue(async(key,value)=>{
    calls.push({key,value});
    if(value?.token)await new Promise(resolve=>{finishSave=resolve;});
    values.set(key,value);
  });
  const saving=write('room',{code:'K7PM',token:'private-seat'});
  await Promise.resolve();await Promise.resolve();
  const forgetting=write('room',null);
  await Promise.resolve();
  assert.equal(calls.length,1,'Forget waits for the already running SecureStore write');
  finishSave();await saving;await forgetting;
  assert.equal(values.get('room'),null);
});

test('a failed private save does not block Forget or unrelated preference writes',async()=>{
  const {createPrivateWriteQueue}=await import('../src/privateWriteQueue.js');
  const values=new Map();
  const write=createPrivateWriteQueue(async(key,value)=>{
    if(value==='failed')throw new Error('storage unavailable');
    values.set(key,value);
  });
  const failed=write('room','failed');
  const cleared=write('room',null),preferences=write('preferences',{hand:'Left'});
  await assert.rejects(failed,/storage unavailable/);await cleared;await preferences;
  assert.equal(values.get('room'),null);assert.deepEqual(values.get('preferences'),{hand:'Left'});
});
