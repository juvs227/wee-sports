// Real Chromium and shipped player/racket models. The injected delay is a
// controlled regression check, not a measurement of a physical phone or TV.
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createServer}=require('node:http');
const {writeFileSync}=require('node:fs');
const {chromium}=require('playwright');
const html=`<!doctype html><style>body{margin:0}</style><div id="court"></div><script type="module">
import {World} from '/src/Tennis/World.ts';
import {predictBaselineIntercept} from '/src/Tennis/autoPosition.ts';
const world=new World(document.querySelector('#court'));
window.world=world;
window.runContact=async({label,hand,delayMs})=>{
 const game=world.gameLogic,ball=world.ball,player=world.player2,results=[];
 world.onStrokeResult=result=>results.push(result);
 world.player1.setPosition(0,10);world.player2.setPosition(0,-10);
 world.startRound();world.botEnabled=false;ball.userData.serveDelayRemaining=0;
 const tick=async()=>{await new Promise(resolve=>setTimeout(resolve,8));game.update(1/120);};
 game.swing({label:'Forehand',hand:'Right',player:1,id:'serve'});
 const animation=(label==='Backhand')!==(hand==='Left')?'SwingLeft':'SwingRight';
 let reached=false;
 for(let i=0;i<600;i++){
  const data=ball.userData;
  if(data.lastHitBy==='player1'&&!data.waitingForRacketHit){
   const intercept=predictBaselineIntercept({position:ball.position,velocity:data.velocity,gravity:data.gravity,bounceCount:data.bounceCount},player.group.position.z+player.strikeOffsets[animation].z);
   if(intercept&&intercept.time<=1/120){reached=true;break;}
  }
  await tick();
 }
 if(!reached)throw Error('No incoming ball reached the racket window');
 for(let i=0;i<Math.round(delayMs/1000*120);i++)await tick();
 const before=ball.position.toArray(),receivedAt=performance.now();
 game.swing({label,hand,player:2,id:'late-return',aim:.7,depth:-.6});
 for(let i=0;i<120&&!results.some(result=>result.id==='late-return');i++)await tick();
 const strokes=results.filter(result=>result.id==='late-return');
 world.renderer.render(world.scene,world.camera);
 return{label,hand,delayMs,before,after:ball.position.toArray(),lastHitBy:ball.userData.lastHitBy,strokes,elapsedAfterInputMs:performance.now()-receivedAt};
};
</script>`;
(async()=>{
 const {createServer:createVite}=await import('vite');
 const vite=await createVite({root:process.cwd(),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
 const server=createServer((request,response)=>{
  if(request.url==='/__late_contact'){response.setHeader('Content-Type','text/html');response.end(html);return;}
  vite.middlewares(request,response);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM||'/usr/bin/chromium',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const measurements=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:960,height:640}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/__late_contact');
  await page.waitForFunction(()=>window.world?.player1.hitbox&&window.world?.player2.hitbox,null,{timeout:30000});
  for(const hand of ['Right','Left'])for(const label of ['Forehand','Backhand'])for(const delayMs of [0,120]){
   const result=await page.evaluate(config=>window.runContact(config),{hand,label,delayMs});
   assert.equal(result.strokes.length,1,'one correlated result per input');
   assert.equal(result.strokes[0].result,'hit',`${hand} ${label}, ${delayMs}ms delivery delay should hit`);
   assert.equal(result.lastHitBy,'player2','the actual ball was returned');
   measurements.push(result);console.log('PASS',hand,label,delayMs+'ms');
  }
  assert.deepEqual(errors,[]);
  const report={recordedAt:new Date().toISOString(),checks:measurements.length,measurements,errors,
   limitations:['Real Chromium/GLB animation and contact with a controlled delay after the incoming-ball window. Does not include live sensors, Railway RTT or physical TV FPS.','Software WebGL; render submission time is included after contact and is not a motion-to-display latency measurement.']};
  if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await vite.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
