/* Actual page/controller and member cache; controlled IO, never a live-speed claim. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-heavy-read-phases.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,advance,advanceAction,finish,settle,reply,platforms}=new Function('require','__dirname',prefix+';return {setup,advance,advanceAction,finish,settle,reply,platforms};')(require,__dirname);
async function start(page){const h=await setup(page),run=h.c.liveQuery();await settle();for(let n=0;n<10&&h.L.loading;n++)await advance(h);assert.equal(h.L.loading,false);assert.equal(h.L.results.length,3);return {h,run};}
for(const page of ['providers','provider_payout','merchants'])test(page+': slow fees cannot block workorders or member reads after main, with three bounded module workers',async()=>{
 const {h,run}=await start(page),attachment=page==='merchants'?'memberDaily':'workorders';
 assert(h.waiting.some(e=>e.q.action==='rates'));assert(h.waiting.some(e=>e.q.action===attachment),'attachment starts while the first rate page is unresolved');assert.equal(h.active(),3);assert.equal(h.controls.ready(),false);
 await advanceAction(h,attachment);assert(h.waiting.some(e=>e.q.action==='rates'),'rate transport is still held');if(attachment==='workorders')assert(h.L.workorders);else assert(h.history.filter(q=>q.action==='memberDaily').length>=2,'member native progression is not gated by fee result');
 await finish(h,run);assert.equal(h.max(),3);assert.equal(h.L.results.length,3);assert.equal(h.L.comparisonStatus,'ready');if(page==='merchants'){assert.equal(h.L.providerIntake,null);assert.equal(h.L.providerComparisonIntake,null);}else{assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.L.providerComparisonIntake.status,'ready');}assert.equal(h.controls.ready(),true);
});
for(const page of ['providers','provider_payout','merchants'])test(page+': one attachment failure keeps independent main and remaining modules available without automatic repeat',async()=>{
 const {h,run}=await start(page),attachment=page==='merchants'?'memberDaily':'workorders';await advanceAction(h,attachment,Error('synthetic attachment failure'));await finish(h,run);assert.equal(h.L.results.length,3);assert.equal(h.L.feeLookupError,'');assert.equal(h.L.comparisonStatus,'ready');if(page==='merchants')assert.equal(h.L.providerIntake,null);else assert.equal(h.L.providerIntake.status,'ready');assert.equal(h.max(),3);assert.equal(h.history.filter(q=>q.action===attachment&&q.platformId===platforms[0].id).length,page==='merchants'?1:0);if(page!=='merchants')assert.equal(h.history.filter(q=>q.action==='workorders').length,1);
});
test('merchant true permission denial clears previously completed member cache before another explicit query',async()=>{
 const h=await setup('merchants');h.c.liveSet('platform',platforms[0].id);await finish(h,h.c.liveQuery());assert.equal(h.history.filter(q=>q.action==='memberDaily').length,1);
 h.c.liveSet('platform',platforms[1].id);const run=h.c.liveQuery();await settle();while(h.L.loading)await advance(h);assert(h.waiting.some(e=>e.q.action==='memberDaily'));
 await advanceAction(h,'memberDaily',Object.assign(Error('synthetic denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await run;await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.comparisonResults.length,0);assert.match(h.L.error,/权限/);assert.equal(h.controls.ready(),true);
 h.waiting.splice(0);const before=h.history.length;h.c.liveSet('platform',platforms[0].id);await finish(h,h.c.liveQuery());assert(h.history.slice(before).some(q=>q.action==='memberDaily'&&q.platformId===platforms[0].id),'previous scope member cache is cleared, not hidden behind cancelled owner');
});
for(const outcome of ['success','deny'])test('old member '+outcome+' after account/scope replacement cannot overwrite or clear the new query',async()=>{
 const {h,run}=await start('merchants'),index=h.waiting.findIndex(e=>e.q.action==='memberDaily'),old=h.waiting.splice(index,1)[0];h.c.hensemDataScope={mode:'selected',identity:'synthetic-next-account'};const next=h.c.liveQuery();await settle();
 if(outcome==='deny')old.d.reject(Object.assign(Error('old owner denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));else old.d.resolve(reply(old.q));await run;await settle();await finish(h,next);assert.equal(h.L.results.length,3);assert.equal(h.L.error,'');assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.controls.ready(),true);
});

test('merchant member host cancellation stops all supplemental workers and does not automatically retry',async()=>{
 const {h,run}=await start('merchants'),calls=h.history.length,serial=h.L.serial;
 await advanceAction(h,'memberDaily',Object.assign(Error('current host suspended'),{code:'ADMIN_LIVE_CANCELLED'}));await run;await settle();
 assert.equal(h.L.serial,serial+1);assert.equal(h.L.results.length,3);assert.equal(h.active(),0);assert.equal(h.controls.ready(),true);h.c.render();await settle();assert.equal(h.history.length,calls);
});
test('same-account token renewal does not cancel or duplicate any independent supplementary module',async()=>{
 const {h,run}=await start('merchants'),serial=h.L.serial;h.c.hensemAccessToken='synthetic-rotated-token';await finish(h,run);
 assert.equal(h.L.serial,serial);assert.equal(h.L.results.length,3);assert.equal(h.L.error,'');assert.equal(h.history.filter(q=>q.action==='memberDaily').length,3);assert.equal(h.history.filter(q=>q.action==='rates').length,1);assert.equal(h.controls.ready(),true);
});
test('member denial for a replaced native platform cannot cancel the current phase or erase main data',async()=>{
 const {h,run}=await start('merchants'),serial=h.L.serial,main=JSON.stringify(h.L.results);h.L.catalog=h.L.catalog.map(p=>p.id===platforms[0].id?{...p,sourceName:'Synthetic replacement native'}:p);
 await advanceAction(h,'memberDaily',Object.assign(Error('obsolete native denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await finish(h,run);
 assert.equal(h.L.serial,serial);assert.equal(JSON.stringify(h.L.results),main);assert.equal(h.L.error,'');assert.equal(h.controls.ready(),true);
});

for(const field of ['sourceName','name'])for(const outcome of ['ADMIN_LIVE_PERMISSION_DENIED','ADMIN_LIVE_CANCELLED'])test('old country-wide workorder '+outcome+' after same-ID '+field+' change cannot clear or continue the current owner',async()=>{
 const {h,run}=await start('provider_payout'),serial=h.L.serial,main=JSON.stringify(h.L.results),calls=h.history.length;
 h.L.catalog=h.L.catalog.map(p=>p.id===platforms[0].id?{...p,[field]:'Synthetic native replacement'}:p);
 await advanceAction(h,'workorders',Object.assign(Error('obsolete directory request'),{code:outcome}));await finish(h,run);
 assert.equal(h.L.serial,serial);assert.equal(JSON.stringify(h.L.results),main);assert.equal(h.L.error,'');assert.equal(h.history.length,calls,'obsolete phase cannot dispatch the remaining modules');assert.equal(h.controls.ready(),true);
});
test('old country-wide intake denial after same-ID native change cannot clear current main facts',async()=>{
 const {h,run}=await start('providers');await advanceAction(h,'rates');await advanceAction(h,'workorders');for(let i=0;i<3;i++)await advanceAction(h,'aggregate');assert(h.waiting.some(e=>e.q.action==='intakeCoverage'));
 const serial=h.L.serial,main=JSON.stringify(h.L.results);h.L.catalog=h.L.catalog.map(p=>p.id===platforms[0].id?{...p,sourceName:'Synthetic native replacement'}:p);
 await advanceAction(h,'intakeCoverage',Object.assign(Error('obsolete intake denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await finish(h,run);
 assert.equal(h.L.serial,serial);assert.equal(JSON.stringify(h.L.results),main);assert.equal(h.L.error,'');assert.equal(h.controls.ready(),true);
});
