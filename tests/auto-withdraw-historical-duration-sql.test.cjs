// Full reader, synthetic source reports/native facts only; no production/session impersonation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),file=path.join(__dirname,'auto-withdraw-unselected-history-sql.test.cjs'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const c=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){}}:createRequire(file)(n),structuredClone});
vm.runInContext(fs.readFileSync(file,'utf8').split(/\ntest\(/)[0]+';globalThis.h=ctx.f2;',c);
const baseline=read('tests/fixtures/auto-withdraw-historical-duration-production.sql'),migration=read('supabase/migrations/20261011150414_auto_withdraw_preserve_historical_duration.sql'),sig='private.dashboard_admin_live_auto_withdraw(jsonb)';
const req=e=>({country:'印度',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z',limit:20,...e});
const call=(db,e={})=>db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb)r',[req(e)]).then(x=>x.rows[0].r);
async function fixture(){const db=await c.h.fixture();await db.exec(read('tests/fixtures/auto-withdraw-country-map-production.sql'));await db.exec(baseline);assert.equal((await c.h.meta(db,sig)).hash,'5969967b0e0e25511c43a5df5e25ec6f');return db;}
async function native(db,p,d,extra={}){return c.h.native(db,'newar',p,d,{total:10,success:8,rejected:1,auto_count:4,manual_count:5,unclassified_count:1,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null,complete:false,...extra},p==='MAAN.WIN'?'MAANWIN':p);}
async function report(db,p,d,count=7,seconds=210){await db.query("insert into newar_business_snapshots values('auto_withdraw_bundle','all','印度',$1,$2,$3::jsonb,$4,$4)",[p,d,JSON.stringify({rows:[{total_count:999,success_count:900,reject_count:99,auto_count:499,manual_count:500,handle_count:count,total_handle_seconds:seconds}],operator_rows:[{operator:'report-only',processed_count:700,reject_count:1,handle_count:count,total_handle_seconds:seconds}]}),'2026-10-11T00:00:00Z']);}
function noTime(v){const copy=structuredClone(v);const visit=x=>{if(!x||typeof x!=='object')return;for(const k of Object.keys(x))if(['avgSeconds','durationSampleCount','durationTotalSeconds','durationBasis','durationSource','durationCompletenessVerified'].includes(k))delete x[k];else visit(x[k]);};visit(copy);return copy;}
test('prior report time fills missing NEWAR time and leaves all counts/classification/coverage and current time unchanged',async()=>{const db=await fixture();try{
 for(const d of ['2026-10-09','2026-10-10'])await native(db,'MAAN.WIN',d);await report(db,'MAANWIN','2026-10-09');await report(db,'MAANWIN','2026-10-10',12,9999);
 const old=await call(db);await db.exec(migration);const now=await call(db),r=now.rows[0];assert.deepEqual(noTime(now),noTime(old));assert.equal(r.total,10);assert.equal(r.previous.total,10);assert.equal(r.avgSeconds,null);assert.equal(r.durationSampleCount,0);
 assert.equal(r.previous.avgSeconds,30);assert.equal(r.previous.durationSampleCount,7);assert.equal(r.previous.durationTotalSeconds,210);assert.equal(r.previous.durationBasis,'source_reported_processing');assert.equal(r.previous.durationSource,'historical_source_report');assert.equal(r.previous.durationCompletenessVerified,false);assert.equal(r.durationBasis,'source_submitted_to_handled');assert.equal(r.comparisonComparable,false);assert.equal(now.comparison.complete,false);assert.equal(now.previousTotals.avgSeconds,30);
 }finally{await db.close()}});
test('existing native prior time wins over conflicting reports; absent and zero-sample reports remain unknown while actual zero survives',async()=>{const db=await fixture();try{
 for(const p of ['NATIVE','ABSENT','EMPTY','ZERO'])for(const d of ['2026-10-09','2026-10-10'])await native(db,p,d,p==='NATIVE'?{avg_seconds:2,duration_sample_count:3,duration_total_seconds:6}:{});
 await report(db,'NATIVE','2026-10-09',99,99999);await report(db,'EMPTY','2026-10-09',0,999);await report(db,'ZERO','2026-10-09',3,0);await db.exec(migration);const rows=(await call(db)).rows;
 const n=rows.find(x=>x.platform==='NATIVE');assert.equal(n.previous.avgSeconds,2);assert.equal(n.previous.durationSampleCount,3);assert.equal(n.previous.durationBasis,'source_submitted_to_handled');assert.equal(n.previous.durationSource,undefined);
 for(const p of ['ABSENT','EMPTY'])assert.equal(rows.find(x=>x.platform===p).previous.avgSeconds,null);assert.equal(rows.find(x=>x.platform==='ZERO').previous.avgSeconds,0);
 }finally{await db.close()}});
test('multi-day prior time uses weighted report samples and mixed native/report basis stays explicit; operator view is identical',async()=>{const db=await fixture();try{
 for(const d of ['2026-10-08','2026-10-09','2026-10-10','2026-10-11'])await native(db,'MAAN.WIN',d,{operator_rows:[{account:'native-user',processed:4,rejected:1,success:3,avg_seconds:null,duration_sample_count:0,duration_total_seconds:null}]});
 await report(db,'MAANWIN','2026-10-08',2,20);await report(db,'MAANWIN','2026-10-09',8,400);
 const op=await call(db,{view:'operators',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-11T23:59:59Z'});await db.exec(migration);assert.deepEqual(await call(db,{view:'operators',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-11T23:59:59Z'}),op);
 const all=await call(db,{endAt:'2026-10-11T23:59:59Z'});assert.equal(all.rows[0].previous.avgSeconds,42);assert.equal(all.rows[0].previous.durationSampleCount,10);
 await db.exec("update private.synthetic_native_days set payload=jsonb_set(jsonb_set(jsonb_set(payload,'{avg_seconds}','2'),' {duration_sample_count}','3'),'{duration_total_seconds}','6') where data_date='2026-10-08'");
 const mixed=await call(db,{endAt:'2026-10-11T23:59:59Z'});assert.equal(mixed.rows[0].previous.durationBasis,'mixed_source_processing');assert.equal(mixed.rows[0].previous.avgSeconds,406/11);
 }finally{await db.close()}});
test('date/platform aliases, exact scope and denied session remain enforced, other sources full JSON stay identical',async()=>{const db=await fixture();try{
 for(const d of ['2026-10-09','2026-10-10']){await native(db,'MAAN.WIN',d);await report(db,'MAANWIN',d);await c.h.ar(db,'91CLUB',d);await c.h.native(db,'yash','YASH.BET',d,{});await c.h.legacy(db,'LEGACY',d);}
 const qs=[{platform:'91CLUB'},{platform:'YASH.BET'},{platform:'LEGACY'},{platform:'ABSENT'}],old=[];for(const q of qs)old.push(await call(db,q));await db.exec(migration);for(let i=0;i<qs.length;i++)assert.deepEqual(await call(db,qs[i]),old[i]);
 for(const q of [{platform:'MAAN.WIN'},{platform:'MAANWIN'},{scopeTargets:[{country:'印度',platforms:['MAAN.WIN']}]},{platforms:['MAANWIN']}])assert.equal((await call(db,q)).rows[0].previous.avgSeconds,30);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[['印度','91CLUB']]})]);assert.deepEqual((await call(db)).rows.map(x=>x.platform),['91CLUB']);await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({targets:[]})]);assert.deepEqual((await call(db)).rows,[]);await db.exec("set test.denied='yes'");await assert.rejects(()=>call(db),/synthetic_session_denied/);
 }finally{await db.close()}});
test('metadata/ACL are exact and migration is replayable; body/config/security/permission drift fails closed',async()=>{const db=await fixture();try{
 const old=await c.h.meta(db,sig);await db.exec(migration);const next=await c.h.meta(db,sig);assert.equal(next.hash,'5dfb74e25b5702bd6dc9212c2be9f1c3');assert.deepEqual(next.metadata,old.metadata);await db.exec(migration);assert.deepEqual(await c.h.meta(db,sig),next);
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(()=>call(db),/permission denied/);await db.exec('reset role');}
 const block=migration.slice(migration.indexOf('do $patch$'),migration.lastIndexOf('commit;'));
 for(const drift of [baseline.replace('declare\n','declare\n -- drift\n'),'alter function '+sig+' security invoker','alter function '+sig+' set search_path=public','grant execute on function '+sig+' to anon']){await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(block),/WITHDRAW_HISTORICAL_DURATION_(BODY|METADATA)_MISMATCH/);await db.exec('rollback');}
 }finally{await db.close()}});

test('same canonical key with missing and valid native-name rows only fills the missing row time',async()=>{const db=await fixture();try{
 for(const d of ['2026-10-09','2026-10-10']){await native(db,'MAAN.WIN',d,{avg_seconds:2,duration_sample_count:3,duration_total_seconds:6});await native(db,'MAANWIN',d);}
 await report(db,'MAANWIN','2026-10-09',7,210);const old=await call(db);await db.exec(migration);const next=await call(db);assert.deepEqual(noTime(next),noTime(old));const r=next.rows[0];assert.equal(r.previous.durationSampleCount,10);assert.equal(r.previous.durationTotalSeconds,216);assert.equal(r.previous.avgSeconds,21.6);assert.equal(r.previous.durationBasis,'mixed_source_processing');assert.equal(r.avgSeconds,2);
 }finally{await db.close()}});
