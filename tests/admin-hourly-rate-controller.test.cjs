const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-hourly-rate-controller.js'),'utf8');
const from='2026-11-10T18:30:00.000Z',to='2026-11-11T18:30:00.000Z',wait=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const platform=i=>({id:'p'+i,name:'P'+i,currency:'INR',timezone:'Asia/Kolkata'});
 const platforms=[1,2,3,4].map(platform),L={results:platforms.map(platform=>({platform,groups:{hourly:[]}})),serial:1,view:'business',pageQueried:true,queryScope:'base',queryNow:100,direction:'all',status:'all',currency:'INR',from,to};
 const calls=[];let model,page='time',detail=true,context='user1:v1';
 const win={HensemHourlyRateData:{build:m=>(model=m,{})},HensemBandSuccessMatricesUI:{render:()=>''}};
 vm.runInNewContext(source,{window:win,AbortController,setTimeout,clearTimeout,queueMicrotask});
 const ctx={L,E:String,access:()=>context,page:()=>page,allowed:()=>true,canDrill:()=>detail,platforms:()=>platforms,query:p=>({platformId:p.id,status:'all',direction:L.direction,currency:L.currency,startAt:from,endAt:to,successBasis:'created',offset:50,limit:20}),request:(q,o)=>new Promise((resolve,reject)=>calls.push({q,o,resolve,reject})),render:()=>{},denied:e=>e.code==='42501'};
 const api=win.HensemHourlyRateController,app=api.create(ctx);
 const reply=call=>({platform:{id:call.q.platformId},startAt:from,endAt:to,complete:true,hasMore:false,successBasis:'created',providerHourMatrix:true,segment:{kind:'custom',hourRange:{minHour:0,maxHour:24}},summary:[],groups:{provider_hour:[],hourly:[]}});
 return {win,api,app,calls,ctx,reply,L,model:()=>model,detail:x=>detail=x,context:x=>context=x,page:x=>page=x};
}
test('one full-day crossing per platform shared by both directions, two in flight, no repeat on sorting or rendering, retry only failed native',async()=>{
 const h=fixture(),action=h.win.HensemHourlyMatrixActions;h.app.html();assert.equal(h.calls.length,0);
 const run=action.load();assert.equal(h.calls.length,2);for(const c of h.calls){assert.equal(c.q.providerHourMatrix,true);assert.equal(c.q.direction,'all');assert.equal(c.q.offset,0)}
 await action.load();assert.equal(h.calls.length,2);h.calls[0].resolve(h.reply(h.calls[0]));h.calls[1].reject(Error('failed'));await wait();assert.equal(h.calls.length,4);
 h.calls.slice(2).forEach(c=>c.resolve(h.reply(c)));await run;assert.match(h.app.html(),/重试未完成商户/);assert.equal(h.model().providerHours.size,3);
 action.direction('withdraw');h.app.html();assert.equal(h.model().direction,'withdraw');assert.equal(h.calls.length,4);
 const retry=action.load(true);assert.equal(h.calls.length,5);assert.equal(h.calls[4].q.platformId,h.calls[1].q.platformId);h.calls[4].resolve(h.reply(h.calls[4]));await retry;h.app.html();assert.equal(h.model().providerHours.size,4);h.app.cancel();
});
test('query replacement, permission loss and denied reads never paint private responses from a previous scope',async()=>{
 const h=fixture(),action=h.win.HensemHourlyMatrixActions;const old=action.load();h.context('other');h.L.serial++;h.page('amount');h.app.html();assert(h.calls[0].o.signal.aborted);
 h.calls.forEach(c=>c.resolve(h.reply(c)));await old;h.app.html();assert.equal(h.model().providerHours.size,0);
 h.detail(false);await action.load();assert.equal(h.calls.length,2);
 h.detail(true);const latest=action.load();h.calls[2].reject(Object.assign(Error('hidden'),{code:'42501'}));h.calls[3].resolve(h.reply(h.calls[3]));await latest;assert.match(h.app.html(),/未获/);await action.load(true);assert.equal(h.calls.length,4);h.app.cancel();
});
test('reject mismatched clocks, wrong platform, old or incomplete groups; never convert an explicit time filter into an unfiltered read',()=>{
 const h=fixture(),base=h.ctx.query({id:'p1'});const q=h.api.matrixRequest(base),good=h.reply({q});
 assert.equal(h.api.verified(good,q).complete,true);for(const changes of [{providerHourMatrix:undefined},{hasMore:true},{startAt:to},{platform:{id:'p2'}},{successBasis:undefined},{groups:{hourly:[]}}])assert.throws(()=>h.api.verified({...good,...changes},q));
 assert.throws(()=>h.api.matrixRequest({...base,successEndAt:to}));assert.throws(()=>h.api.matrixRequest({...base,successBasis:'source_updated',successStartAt:from,successEndAt:to}));assert.throws(()=>h.api.matrixRequest({...base,status:'success'}));h.app.cancel();
});
