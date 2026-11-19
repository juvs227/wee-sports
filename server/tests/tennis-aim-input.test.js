import {expect, test} from 'vitest';
import {createTennisAim} from '@wee/shared/tennisAim.js';
import {normalizeNativeGyroscope, normalizeWebMotion, toLegacyMotionSample, DEG_TO_RAD} from '@wee/shared/motion.js';
import {createSwingStream} from '@wee/src/controller/swingStream.js';
import {createSimpleSwingStream} from '@wee/src/controller/motionGestures.js';
import {isSwing, isStrokeResult} from '@wee/shared/protocol.js';


function trace(controller,adapter=normalizeNativeGyroscope) {
  let index=0;
  const push=(rate,count=1,extra={})=>{
    let result;
    for(let i=0;i<count;i++) {
      const timeSeconds=index++/60;
      const reading=adapter===normalizeWebMotion ? {rotationRate:{alpha:rate.x/DEG_TO_RAD,beta:rate.y/DEG_TO_RAD,gamma:rate.z/DEG_TO_RAD}} : rate;
      result=controller.push(adapter(reading,{timeSeconds,sequence:index,...extra}));
    }
    return result;
  };
  Object.defineProperty(push,'nextTimeMs',{get:()=>index * 1000 / 60});
  return push;
}

test('tennis captures exact pre-onset pointing despite late recognition and follow-through',()=>{
  const aim=createTennisAim(),push=trace(aim);
  push({x:0,y:0,z:0});
  const pointed=push({x:-.25,y:.45,z:0},40);
  expect(pointed.aim).toBeGreaterThan(.25);expect(pointed.depth).toBeGreaterThan(.12);
  const onset=push.nextTimeMs;
  push({x:1,y:-5,z:.5},16);
  expect(aim.capture(onset)).toEqual(pointed);
  push({x:0,y:0,z:0},10);
  expect(aim.capture(onset)).toEqual(pointed,'late recognition cannot pick up the follow-through');
  const next=push({x:.2,y:-.3,z:0},20);
  const nextOnset=push.nextTimeMs;
  push({x:0,y:4,z:0});
  expect(aim.capture(nextOnset)).toEqual(next);
  expect(aim.capture().aim).toBeLessThan(pointed.aim);
});

test('equivalent web/native gyro traces capture identical bounded tennis placement',()=>{
  const native=createTennisAim(),web=createTennisAim();
  const app=trace(native),browser=trace(web,normalizeWebMotion);
  for(const [rate,count] of [[{x:0,y:0,z:0},1],[{x:.3,y:-.5,z:.05},100],[{x:2,y:4,z:0},8],[{x:0,y:0,z:0},5]]) {
    app(rate,count);browser(rate,count);
  }
  native.capture(101 * 1000 / 60);web.capture(101 * 1000 / 60);
  expect(native.capture().aim).toBeCloseTo(web.capture().aim,10);
  expect(native.capture().depth).toBeCloseTo(web.capture().depth,10);
  expect(Math.abs(native.capture().aim)).toBeLessThanOrEqual(1);
  expect(Math.abs(native.capture().depth)).toBeLessThanOrEqual(1);
});

test('quick reposition immediately followed by a hit uses the new target on the first swing',()=>{
  for(const adapter of [normalizeNativeGyroscope,normalizeWebMotion]) {
    for(const sensitivity of [.25,1,2]) for(const direction of [-1,1]) {
      const aim=createTennisAim({sensitivity}),push=trace(aim,adapter);
      push({x:0,y:0,z:0});const before=push({x:0,y:-direction * .6,z:0},30);
      // 69 deg/s is deliberate repositioning, below the recognizer onset.
      // Previously the independent 1.1 rad/s lock froze the opposite target.
      const pointed=push({x:0,y:direction * 1.2,z:0},30);
      const onset=push.nextTimeMs;
      push({x:0,y:direction * 5,z:0},12);
      expect(aim.capture(onset)).toEqual(pointed);
      expect(aim.capture().aim * direction).toBeGreaterThan(0);
      expect(before.aim * direction).toBeLessThan(0);
    }
  }
});

test('gaps, calibration changes, rotations and invalid samples clear stale placement',()=>{
  for(const discontinuity of ['gap','revision','rotation','invalid']) {
    const aim=createTennisAim(),push=trace(aim);
    push({x:0,y:0,z:0});push({x:0,y:.5,z:0},40);
    const onset=push.nextTimeMs;push({x:0,y:4,z:0});aim.capture(onset);
    expect(aim.capture().aim).toBeGreaterThan(.25);
    if(discontinuity==='invalid') aim.push(null);
    else aim.push(normalizeNativeGyroscope({x:0,y:0,z:0},{timeSeconds:discontinuity==='gap' ? 2 : .71,sequence:43,
      calibrationRevision:discontinuity==='revision' ? 1 : 0,screenAngle:discontinuity==='rotation' ? 90 : 0}));
    expect(aim.capture()).toEqual({aim:0,depth:0});
    expect(aim.capture(onset)).toEqual({aim:0,depth:0},'previous calibration history cannot be captured again');
  }
});

test('real recognizer onset uses the canonical phone clock for web and native captures',()=>{
  for(const adapter of [normalizeNativeGyroscope,normalizeWebMotion]) for(const mode of ['complete','fast','Forehand','Backhand']) {
    const selected=mode==='Forehand'||mode==='Backhand';
    const aim=createTennisAim(),stream=selected ? createSimpleSwingStream(mode) : createSwingStream('Right',{fast:mode==='fast'});
    const originMs=120000, events=[];
    let sequence=0, pointed;
    const push=(rate,count)=>{
      for(let i=0;i<count;i++) {
        const timeSeconds=originMs / 1000 + sequence / 60;
        const reading=adapter===normalizeWebMotion ? {rotationRate:{alpha:rate.x/DEG_TO_RAD,beta:rate.y/DEG_TO_RAD,gamma:0}} : rate;
        const sample=adapter(reading,{timeSeconds,sequence:sequence++});
        const pose=aim.push(sample);
        stream.push(toLegacyMotionSample(sample,{timeOriginSeconds:adapter===normalizeWebMotion ? originMs / 1000 : 0}));
        for(const stroke of stream.analyze()) if(stroke.label!=='Unknown') events.push({stroke,
          target:aim.capture(stroke.startMs + (adapter===normalizeWebMotion ? originMs : 0))});
        pointed=pose;
      }
    };
    push({x:0,y:0,z:0},10);push({x:0,y:-.6,z:0},30);push({x:0,y:1.2,z:0},30);
    const target={...pointed};
    push({x:6,y:12,z:0},12);push({x:0,y:0,z:0},20);
    expect(events).toHaveLength(1);
    expect(events[0].stroke.label).toBe(selected ? mode : 'Forehand');
    expect(events[0].target).toEqual(target);
    expect(events[0].target.aim).toBeGreaterThan(0);
  }
});

test('expired or unknown onset clocks cannot reuse old placement',()=>{
  const aim=createTennisAim(),push=trace(aim);
  push({x:0,y:0,z:0});push({x:0,y:.6,z:0},30);
  const onset=push.nextTimeMs;push({x:1,y:5,z:0},8);
  expect(aim.capture(onset).aim).toBeGreaterThan(0);
  push({x:0,y:0,z:0},240);
  for(const time of [onset,-1,NaN,Infinity,push.nextTimeMs + 10000]) {
    expect(aim.capture(time)).toEqual({aim:0,depth:0});
  }
});

test('tennis placement is optional for legacy/touch but rejects malformed coordinates',()=>{
  const swing={type:'swing',id:'stroke',label:'Forehand',hand:'Right'};
  expect(isSwing(swing)).toBe(true);
  expect(isSwing({...swing,aim:-1,depth:1})).toBe(true);
  for(const value of [NaN,Infinity,-1.01,1.01,'0',null]) {
    expect(isSwing({...swing,aim:value})).toBe(false);
    expect(isSwing({...swing,depth:value})).toBe(false);
  }
});



test('preparation diagnostics accept a local duration for misses without inventing contact time',()=>{
  const result={id:'stroke',gameId:'game-a',player:1,result:'miss',reason:'late',receivedToPreparationMs:12};
  expect(isStrokeResult(result)).toBe(true);
  expect(isStrokeResult({...result,receivedToPreparationMs:-1})).toBe(false);
  expect(isStrokeResult({...result,receivedToContactMs:24})).toBe(false);
});
