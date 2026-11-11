const {test}=require('node:test');
const assert=require('node:assert/strict');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const roll={aim:.2,power:.5,spin:0};
async function fixture() {
  const {NativeBowlingActions}=await import('../src/bowlingActions.js');
  const states=[],notices=[],retries=[],requests=[];
  const session={seat:{gameId:'g1',inputGeneration:1,gameState:{phase:'ready'}},bowlingTurnKey:'g1-turn1',bowlingReleasedTurn:'g1-turn1',
    async action(){return {ok:true,id:'roll1'};},async request(event,payload){requests.push({event,payload});return {ok:true,status:'unknown'};}};
  let current=session;
  const actions=new NativeBowlingActions({session:()=>current,changed:state=>states.push(state),notice:value=>notices.push(value),retry:value=>retries.push(value)});
  return {actions,session,states,notices,retries,requests,setSession(value){current=value;},
    nextGame(id='g2'){session.seat={gameId:id,inputGeneration:2,gameState:{phase:'ready'}};session.bowlingTurnKey=`${id}-turn1`;actions.observe();}};
}

test('a late unknown roll acknowledgement cannot restore abandoned state or block the next game', async () => {
  const f=await fixture(),pending=deferred();
  f.session.action=()=>pending.promise;
  const first=f.actions.release(roll);
  assert.deepEqual(f.states.at(-1),{status:'pending',gameId:'g1'});
  f.session.seat={gameId:null,phase:'ready'};f.actions.observe();
  assert.equal(f.states.at(-1),null,'cancel immediately unblocks the UI while the old acknowledgement is still pending');
  f.nextGame();
  f.session.action=async()=>({ok:true,id:'new-roll'});
  await f.actions.release(roll);
  const currentTicket=f.actions.ticket, stateCount=f.states.length, noticeCount=f.notices.length;
  pending.resolve({ok:false,error:'outcome-unknown',id:'old-roll'});await first;
  assert.equal(f.actions.ticket,currentTicket);
  assert.equal(f.actions.unknown,null);
  assert.equal(f.states.length,stateCount);
  assert.equal(f.notices.length,noticeCount);
  assert.equal(f.retries.length,0);
});

test('abandoning an already unknown roll clears its latch at the lobby boundary', async () => {
  const f=await fixture();
  f.session.action=async()=>({ok:false,error:'outcome-unknown',id:'old-roll'});
  await assert.rejects(f.actions.release(roll),/outcome is unknown/);
  assert.deepEqual(f.actions.unknown,{id:'old-roll',gameId:'g1',status:'unknown'});
  f.session.seat={gameId:null,phase:'ready'};f.actions.observe();
  assert.equal(f.actions.ticket,null);assert.equal(f.states.at(-1),null);
  f.nextGame();f.session.action=async()=>({ok:true,id:'new-roll'});
  await f.actions.release(roll);
  assert.equal(f.actions.ticket.gameId,'g2');
});

test('replacing a session ignores late rejection without unlocking the new session delivery', async () => {
  const f=await fixture(),pending=deferred();
  f.session.action=()=>pending.promise;
  const first=f.actions.release(roll);
  const replacement={...f.session,action:async()=>({ok:true,id:'replacement-roll'})};
  f.setSession(replacement);f.actions.observe();
  await f.actions.release(roll);
  const ticket=f.actions.ticket;
  pending.resolve({ok:false,error:'not-playing',id:'old-roll'});await first;
  assert.equal(f.actions.ticket,ticket);
  assert.equal(replacement.bowlingReleasedTurn,'g1-turn1');
  assert.equal(f.retries.length,0);
});

test('a late outcome-status reply remains scoped to its original game and turn', async () => {
  const f=await fixture(),status=deferred();
  f.session.action=async()=>({ok:false,error:'outcome-unknown',id:'old-roll'});
  await assert.rejects(f.actions.release(roll));
  f.session.request=(event,payload)=>{f.requests.push({event,payload});return status.promise;};
  const checking=f.actions.check();
  assert.deepEqual(f.requests.at(-1),{event:'player:action-status',payload:{id:'old-roll',gameId:'g1'}});
  f.session.bowlingTurnKey='g1-turn2';f.actions.observe();
  f.session.action=async()=>({ok:true,id:'new-roll'});await f.actions.release(roll);
  const ticket=f.actions.ticket, noticeCount=f.notices.length;
  status.resolve({ok:true,status:'rejected'});await checking;
  assert.equal(f.actions.ticket,ticket);
  assert.equal(f.retries.length,0);
  assert.equal(f.notices.length,noticeCount);
});

test('pause and input-generation changes do not unlock an unresolved delivery for a duplicate roll', async () => {
  const f=await fixture();
  f.session.action=async()=>({ok:false,error:'outcome-unknown',id:'once'});
  await assert.rejects(f.actions.release(roll));
  f.session.seat.inputGeneration++;f.session.seat.paused=true;f.actions.observe();
  f.session.seat.inputGeneration++;f.session.seat.paused=false;f.actions.observe();
  await assert.rejects(f.actions.release(roll),/previous roll/);
  assert.equal(f.actions.unknown.gameId,'g1');
  f.session.request=async()=>({ok:true,status:'rejected'});
  await f.actions.check();
  assert.equal(f.actions.ticket,null);assert.equal(f.session.bowlingReleasedTurn,null);
  assert.equal(f.retries.length,1);
});

test('authoritative rolling resolves a pending ticket before a delayed acknowledgement', async () => {
  const f=await fixture(),pending=deferred();
  f.session.action=()=>pending.promise;
  const first=f.actions.release(roll);
  f.session.seat.gameState.phase='rolling';f.actions.observe();
  assert.equal(f.actions.ticket,null);
  pending.resolve({ok:false,error:'outcome-unknown',id:'already-rolling'});await first;
  assert.equal(f.actions.unknown,null);
  assert.equal(f.notices.length,0);
  f.session.seat.gameState.phase='ready';f.session.bowlingTurnKey='g1-turn2';
  f.session.action=async()=>({ok:true,id:'next-ball'});
  await f.actions.release(roll);
  assert.equal(f.actions.ticket.turnKey,'g1-turn2');
});
