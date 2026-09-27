/* Synthetic retained-tab results: alias placeholders must not create a second platform. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harness=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P}=new Function('require','__dirname',harness+';return {ready,completeAggregate,P};')(require,__dirname);
const raw={...P,id:'11111111-1111-4111-8111-111111111111',name:'RAJA',sourceName:'RAJA',source:'ar',team:'M8'},alias={...raw,id:'22222222-2222-4222-8222-222222222222',name:'RAJALOTTERY',sourceName:'RAJALOTTERY'};
const noData=p=>({platform:p,total:0,summary:[],groups:{}});
const plain=s=>s.replace(/<[^>]*>/g,'').trim();
const table=h=>h.html().match(/<section[^>]*id="df-platforms-charge"[\s\S]*?<\/section>/)?.[0]||'';
const rows=h=>[...(table(h).match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'').matchAll(/<tr(?: [^>]*)?>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c=>plain(c[1])));
async function render(platforms,results){const h=await ready({platforms,reports:true});Object.assign(h.L,{queryPlatforms:platforms,queryFailures:[],results,country:'印度',direction:'charge',currency:'INR',dirty:false,loading:false,overviewQueried:true,feeLookupRows:[],feeLookupLoading:false,comparisonStatus:'idle'});h.c.render();return h;}

test('retained raw RAJA data suppresses the confirmed alias empty row without mutating totals or source keys',async()=>{
 const results=[completeAggregate(raw,10,8),noData(alias)],before=JSON.stringify(results),h=await render([raw,alias],results);
 assert.equal(rows(h).length,1);assert.equal(rows(h)[0][0],'RAJA');assert.equal(rows(h)[0][4],'8');assert.doesNotMatch(table(h),/RAJALOTTERY|本期未收到订单数据/);assert.equal(JSON.stringify(results),before);
});
test('two confirmed alias empty responses retain one truthful empty row',async()=>{
 const h=await render([alias,raw],[noData(alias),noData(raw)]);assert.equal(rows(h).length,1);assert.match(rows(h)[0][0],/^RAJA本期未收到订单数据$/);assert.equal(rows(h)[0][1],'—');
});
test('same spelling in a different backend, country or team remains separate',async()=>{
 const other=[{...alias,id:'other-source',source:'newar'},{...alias,id:'other-country',country:'巴基斯坦',scopeGroup:'PK'},{...alias,id:'other-team',team:'Other team'}];
 const h=await render([raw,alias,...other],[completeAggregate(raw,10,8),noData(alias),...other.map(noData)]);assert.equal(rows(h).length,4);assert.equal(rows(h).filter(r=>r[0].includes('本期未收到订单数据')).length,3);
});
