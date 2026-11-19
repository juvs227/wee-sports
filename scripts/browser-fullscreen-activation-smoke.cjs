// Exercise actual Chromium activation rules; requestFullscreen is observed,
// never replaced with a simulated success or failure.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const base=process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5262';

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[];
  const pass=value=>{checks.push(value);console.log('PASS:',value);};
  try {
    const tvContext=await browser.newContext({viewport:{width:1280,height:800}});
    await tvContext.addInitScript(()=>{
      window.__fullscreenAttempts=[];
      const native=Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen=function(...args){
        const attempt={active:navigator.userActivation.isActive,stage:document.querySelector('.game-countdown')?'countdown':document.querySelector('.game-session')?'game':'lobby'};
        window.__fullscreenAttempts.push(attempt);
        return native.apply(this,args).then(value=>{attempt.entered=Boolean(document.fullscreenElement);return value;},error=>{attempt.error=error.name;throw error;});
      };
    });
    const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
    await phoneContext.addInitScript(()=>{
      Object.defineProperty(window,'DeviceMotionEvent',{value:undefined,configurable:true});
      Object.defineProperty(window,'DeviceOrientationEvent',{value:undefined,configurable:true});
    });
    const tv=await tvContext.newPage(),phone=await phoneContext.newPage();
    for(const page of [tv,phone])page.on('pageerror',error=>errors.push(error.message));
    await tv.goto(base+'/home');
    await tv.getByRole('button',{name:'Play: Tennis',exact:true}).click();
    const code=await tv.getByTestId('lobby-code').innerText();
    assert.equal(await tv.evaluate(()=>window.__fullscreenAttempts.length),0);
    await phone.goto(base+'/join?code='+code);
    await phone.getByLabel('Your playing name',{exact:true}).fill('Alex');
    await phone.getByRole('button',{name:'Play',exact:true}).click();
    await phone.getByRole('button',{name:'Start game',exact:true}).waitFor();
    // Let the TV's lobby click lose transient activation. A phone tap has its
    // own document activation and must not be treated as a TV gesture.
    await tv.waitForTimeout(6200);
    await phone.getByRole('button',{name:'Start game',exact:true}).click();
    await phone.getByRole('button',{name:'Start now',exact:true}).click();
    await tv.locator('.game-countdown').waitFor();
    await tv.waitForFunction(()=>window.__fullscreenAttempts.some(attempt=>attempt.error));
    const automatic=await tv.evaluate(async()=>{
      let permission='unsupported';
      try {permission=(await navigator.permissions.query({name:'fullscreen',allowWithoutGesture:true})).state;} catch { /* Older browsers do not expose this descriptor. */ }
      return {attempts:window.__fullscreenAttempts,fullscreen:Boolean(document.fullscreenElement),permission};
    });
    assert.equal(automatic.attempts.length,1);
    assert.equal(automatic.attempts[0].active,false);
    assert.equal(automatic.attempts[0].stage,'countdown');
    assert.equal(automatic.fullscreen,false);
    const bounds=await tv.locator('.game-countdown').evaluate(element=>{
      const rect=element.getBoundingClientRect();return{x:rect.x,y:rect.y,w:rect.width,h:rect.height,vw:innerWidth,vh:innerHeight};
    });
    assert.deepEqual(bounds,{x:0,y:0,w:bounds.vw,h:bounds.vh,vw:bounds.vw,vh:bounds.vh});
    pass('First remote start requests fullscreen only after the lobby; real browser denial still fills the viewport');

    await tv.locator('iframe[title="Tennis game"]').waitFor();
    const frame=await tv.locator('iframe').elementHandle();
    const game=await frame.contentFrame();
    await game.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});
    await tv.keyboard.press('Enter');
    await tv.waitForFunction(()=>Boolean(document.fullscreenElement));
    const local=await tv.evaluate(()=>window.__fullscreenAttempts.at(-1));
    assert.equal(local.active,true);assert.equal(local.entered,true);
    // Fullscreen's DOM promise resolves before the queued fullscreenchange
    // event. Wait for the real UI to observe entry before testing an exit.
    await tv.getByRole('button',{name:'Exit full screen',exact:true,includeHidden:true}).waitFor({state:'attached'});
    pass('A real TV Enter focused inside the game iframe completes fullscreen on the first press without opening Display');

    await tv.evaluate(()=>document.exitFullscreen());
    await tv.waitForFunction(()=>!document.fullscreenElement);
    await tv.locator('.game-session:not(.game-session--immersive)').waitFor();
    await game.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});
    const before=await tv.evaluate(()=>window.__fullscreenAttempts.length);
    await tv.keyboard.press('Enter');
    assert.equal(await tv.evaluate(()=>window.__fullscreenAttempts.length),before,'an intentional exit must not be immediately reversed');
    assert.equal(await frame.evaluate(node=>node===document.querySelector('iframe')),true);
    pass('An intentional fullscreen exit is respected without remounting the match');

    // Reloading deliberately returns to the existing saved-match choice.
    // It must stay windowed until the player chooses to continue.
    await tv.reload();
    await tv.getByRole('heading',{name:'Your game is still here',exact:true}).waitFor();
    assert.equal(await tv.evaluate(()=>window.__fullscreenAttempts.length),0);
    await tv.getByRole('button',{name:'Continue game',exact:true}).click();
    await tv.waitForFunction(()=>Boolean(document.fullscreenElement));
    await tv.locator('.game-countdown').waitFor();
    assert.equal(await tv.evaluate(()=>window.__fullscreenAttempts[0].active),true);
    pass('Saved-match choices stay windowed; Continue enters fullscreen on its first real TV click');
    assert.deepEqual(errors,[]);
    const report={recordedAt:new Date().toISOString(),checks,errors,automatic,local,limitations:[
      'Browsers require a gesture on the TV document when automatic fullscreen permission is unavailable. A phone tap cannot grant it.',
      'Headless Chromium DOM Fullscreen API state was observed; this does not prove that a physical TV or managed browser hides its browser chrome.',
      'Chromium software rendering; physical TV browser and remote were not measured.'
    ]};
    if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
