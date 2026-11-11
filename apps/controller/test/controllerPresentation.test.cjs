const {test}=require('node:test');
const assert=require('node:assert/strict');



test('native tennis shows direct set points, including reset points and the final set',async()=>{
  const {matchSummary}=await import('../src/controllerPresentation.js');
  const seat={sport:'tennis',phase:'game',players:[{slot:0,name:'Riley'},{slot:1,name:'Sam'}],
    gameState:{phase:'serve',score:[0,0],sets:[1,0],completedSets:[{player1:8,player2:6}],targetPoints:7,setsToWin:2}};
  let summary=matchSummary(seat);
  assert.equal(summary.label,'Set 2 · Best of 3');assert.deepEqual(summary.score,[0,0]);assert.equal(summary.tally,'1–0 sets');
  assert.equal(summary.detail,'First to 7 points · Win by 2');
  seat.gameState={...seat.gameState,phase:'complete',score:[7,4],sets:[2,0],completedSets:[{player1:8,player2:6},{player1:7,player2:4}],winner:1};
  summary=matchSummary(seat);
  assert.equal(summary.label,'Set 2 · Best of 3');assert.deepEqual(summary.score,[7,4]);assert.equal(summary.result,'Riley wins!');
});



test('play cues never ask a paused or disconnected bowler to swing, and final results remain TV first',async()=>{
  const {controllerPlayState}=await import('../src/controllerPresentation.js');
  const seat={sport:'bowling',slot:0,phase:'game',players:[{slot:0,name:'Sam'},{slot:1,name:'Ari'}],gameState:{phase:'ready',currentPlayer:1}};
  assert.equal(controllerPlayState(seat,'online','motion').active,true);
  assert.deepEqual(controllerPlayState({...seat,paused:true},'online','motion'),{title:'Game paused',hint:'Your controller is ready when play resumes.',active:false});
  assert.equal(controllerPlayState(seat,'offline','motion').active,false);
  assert.equal(controllerPlayState(seat,'online',null).title,'Getting ready');
  assert.equal(controllerPlayState({...seat,gameState:{phase:'ready',currentPlayer:2}},'online','motion').hint,'Ari is bowling.');
  assert.equal(controllerPlayState({...seat,paused:true,gameState:{phase:'complete'}},'offline',null).title,'Match complete');
});

test('native start confirmation is tied to the ready roster, sport and connection generation',async()=>{
  const {startConfirmationKey}=await import('../../../shared/startConfirmation.js');
  const seat={code:'ABCD',sport:'bowling',phase:'ready',canStart:true,leaderSlot:0,inputGeneration:1,players:[{id:'sam',slot:0,ready:true,setup:'motion'}]};
  const key=startConfirmationKey(seat);assert.ok(key);
  assert.equal(startConfirmationKey({...seat,countdown:null}),key);
  for(const change of [{sport:'tennis'},{inputGeneration:2},{players:[...seat.players,{id:'ari',slot:1,ready:true,setup:'buttons'}]}])assert.notEqual(startConfirmationKey({...seat,...change}),key);
  for(const change of [{paused:true},{canStart:false},{phase:'countdown'}])assert.equal(startConfirmationKey({...seat,...change}),null);
});

test('a missing TV is distinguished from a missing player named TV',async()=>{
  const {controllerPlayState,waitingForTv}=await import('../src/controllerPresentation.js');
  const seat={phase:'game',sport:'tennis',paused:true,reconnecting:[{role:'host',name:'TV'}]};
  assert.equal(controllerPlayState(seat,'online','motion').title,'Waiting for the TV');
  assert.equal(waitingForTv({...seat,reconnecting:[{role:'player',name:'TV'}]}),false);
  assert.equal(waitingForTv({...seat,reconnecting:[{name:'TV'}]}),true,'older servers still show TV reconnection');
  assert.equal(controllerPlayState(seat,'offline','motion').title,'Reconnecting');
});
