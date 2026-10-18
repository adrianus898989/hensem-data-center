// Independent synthetic-only projection review. Does not register/run the parent suite.
const{test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const here=__dirname,fixture=path.resolve(here,'daily-provider-base-cache.test.cjs'),realRequire=createRequire(fixture);let setup,reset,close;
const load=n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach:fn=>reset=fn,after:fn=>close=fn}:realRequire(n);
const prefix=fs.readFileSync(fixture,'utf8').split('for(const providers of ')[0];
const a=new Function('require','__dirname',prefix+';return {f,pair,flush,getdb:()=>db};')(load,path.dirname(fixture));
let db;before(async()=>{await setup();db=a.getdb();});beforeEach(()=>reset());after(()=>close());
const plain=x=>structuredClone(x);
async function exactBoth(items,q){let p=await a.pair(items,q);assert.equal(p.eq,true);assert.equal(p.text_eq,true);assert(p.actual.pending);await a.f.scalar("select private.dashboard_admin_daily_base_cache_flush(jsonb_build_array(private.dashboard_admin_daily_base_cache_prepare($1,$2,$3,'current',private.dashboard_admin_daily_base_cache_fence(),false)->'pending'))",[JSON.stringify(items),JSON.stringify(q),JSON.stringify(a.f.target(1))]);p=await a.pair(items,q);assert.equal(p.eq,true);assert.equal(p.text_eq,true);assert.equal(p.actual.pending,null);return p.actual.item;}
async function aliases(){await db.exec("insert into private.fixture_overrides values('PLATFORM-1','Raw-A','Brand'),('PLATFORM-1','Raw-B','Brand'),('PLATFORM-2','Raw-A','Other-Native')");}
const selections=[undefined,null,[],['Raw-A','Brand','Raw-B','Raw-A'],['Other'],['No-Match']];
test('historical daily providers: all alias selectors and directions are exact on miss and hit, with raw nested evidence retained',async()=>{
 await aliases();const items=await a.f.preparedDailyItems(a.f.q(),a.f.target(1),{rows:n=>[a.f.row('Raw-A','charge',{provider_names:['Raw-A','Opaque evidence'],fee_version_basis:'immutable_version',created_success_amount:n?'0.000000000000000001':'9007199254740993.123456789012345678',reviewed_pending_amount:n?null:'0.0000'}),a.f.row('Raw-B'),a.f.row('Other'),a.f.row('Raw-A','withdraw'),a.f.row('Other','withdraw')]});
 let cases=0;for(const providers of selections)for(const direction of ['charge','withdraw','all']){await db.exec('truncate private.daily_provider_base_cache');const q={...a.f.q(),direction,limit:50};if(providers===undefined)delete q.providers;else q.providers=providers;const item=await exactBoth(items,q);assert.equal(item.publication.sourceComplete,false);for(const r of item.result.groups.provider){assert.equal(r.member_count,null);assert.deepEqual(r.fee_items,r.items);}cases++;}
 assert.equal(cases,18);
});
test('full-v2 master-head projection: aliases, both directions, original date strings and chart-band echo remain byte exact',async()=>{
 await aliases();const local=await a.f.scalar("select(now()at time zone'Asia/Kolkata')::date::text"),end=new Date(local+'T00:00:00+05:30'),start=new Date(+end-2*86400000),q=a.f.q(1,start.toISOString(),end.toISOString());
 await a.f.prepare(q,a.f.target(1),{cutoff:new Date().toISOString(),rows:n=>[a.f.row('Raw-A','charge',{provider_names:['Raw-A','Opaque evidence'],fee_version_basis:'immutable_version'}),a.f.row('Raw-B'),a.f.row('Other','withdraw')]});
 await db.exec("update private.prepared_aggregate_artifacts set payload=payload||'{\"durationVersion\":2,\"capabilities\":{}}'::jsonb");
 const parts=(await db.query("select request from private.prepared_aggregate_jobs order by request->>'startAt'")).rows.map(x=>{const r={...x.request,view:'providers'};delete r.durationVersion;delete r.amountBands;return r;});
 const items=(await a.f.scalar("select private.prepared_aggregate_read('providers',$1)",[JSON.stringify({requests:parts,publicationVersion:2})])).items;
 assert(items.every(x=>x.status==='ready'));assert((await db.query("select request from private.prepared_aggregate_jobs")).rows.some(x=>x.request.durationVersion===2));
 for(const providers of selections)for(const direction of ['charge','withdraw','all']){await db.exec('truncate private.daily_provider_base_cache');const request={...q,direction,limit:100,amountBands:{charge:[0,1,2,3,4,5,6,7,8,9,10],withdraw:[0,1,2,3,4,5,6,7,8,9,10]}};if(providers===undefined)delete request.providers;else request.providers=providers;const item=await exactBoth(items,request);assert.deepEqual(item.result.amountBands,plain(request.amountBands));assert.deepEqual(item.publication.components,plain((await a.pair(items,request)).actual.item.publication.components));}
});
test('native alias context remains separate while sharing the same raw provider strings',async()=>{
 await aliases();const q1=a.f.q(),q2=a.f.q(2);const one=await a.f.preparedDailyItems(q1,a.f.target(1),{rows:()=>[a.f.row('Raw-A')]});const two=await a.f.preparedDailyItems(q2,a.f.target(2),{rows:()=>[a.f.row('Raw-A')]});
 let p=await a.pair(one,{...q1,providers:['Raw-A']},a.f.target(1));assert.equal(p.text_eq,true);await a.flush([p.actual.pending]);assert.equal(p.actual.item.result.groups.provider[0].provider,'Brand');
 p=await a.pair(two,{...q2,providers:['Raw-A']},a.f.target(2));assert.equal(p.text_eq,true);assert(p.actual.pending);await a.flush([p.actual.pending]);p=await a.pair(two,{...q2,providers:['Raw-A']},a.f.target(2));assert.equal(p.text_eq,true);assert.equal(p.actual.pending,null);assert.equal(p.actual.item.result.groups.provider[0].provider,'Other-Native');assert.equal(await a.f.scalar('select count(*)::integer from private.daily_provider_base_cache'),2);
});
test('non-idempotent unrelated aliases keep whole-fold fallback and cannot enter the base cache',async()=>{
 await db.exec("insert into private.fixture_overrides values('PLATFORM-1','Unused-A','Unused-B'),('PLATFORM-1','Unused-B','Unused-C')");const items=await a.f.preparedDailyItems(a.f.q(),a.f.target(1),{rows:()=>[a.f.row('Brand'),a.f.row('Unused-A')]});
 const p=await a.pair(items);assert.equal(p.actual.item,null);assert(!p.actual.pending);assert.equal(await a.f.scalar('select count(*)::integer from private.daily_provider_base_cache'),0);assert.equal(await a.f.scalar('select private.dashboard_admin_daily_provider_fold($1,$2,$3)',[JSON.stringify(items),JSON.stringify(a.f.q()),JSON.stringify(a.f.target(1))]),null);
});
test('large/scale/trailing-point optional metrics preserve PostgreSQL full-text equality and exact key/null shapes',async()=>{
 const items=await a.f.preparedDailyItems(a.f.q(),a.f.target(1),{rows:n=>[a.f.row('Brand','charge',{all_count:'9007199254740993',all_amount:'123.',success_amount:'1e-19',created_success_amount:n?'0.000000000000000001':'9007199254740993.123456789012345678',reviewed_pending_count:n?null:'9007199254740993',reviewed_pending_amount:n?'0.0000000':null,fee_exempt_count:n?0:undefined})]});
 const item=await exactBoth(items,a.f.q());const row=item.result.groups.provider[0];assert.equal(row.all_amount,'246');assert.equal(row.created_success_amount,'9007199254740993.123456789012345679');assert.equal(row.reviewed_pending_count,null);assert.equal(row.reviewed_pending_amount,null);assert.equal(row.fee_exempt_count,null);
});
