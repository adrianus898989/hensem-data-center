// Synthetic PGlite only: no sessions, source credentials, production writes or network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{test}=require('node:test');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const parent=path.join(__dirname,'auto-withdraw-report-scope-once-sql.test.cjs'),ctx=vm.createContext({__dirname:path.dirname(parent),require:n=>n==='node:test'?{test(){}}:createRequire(parent)(n),structuredClone});vm.runInContext(fs.readFileSync(parent,'utf8').split(/\ntest\(/)[0]+';globalThis.h={fixture,call,scope};',ctx);const H=ctx.h;
const migration=read('supabase/migrations/20261012121046_duoli_native_withdraw_statistics.sql'),baseline=read('tests/fixtures/duoli-withdraw-production.sql');
assert.equal(migration,read('supabase/admin-live-duoli-withdraw.sql'),'reviewed standalone SQL and deployable migration must match');
const signature='private.dashboard_admin_live_auto_withdraw(jsonb)',helperSig='private.dashboard_admin_duoli_withdraw_days(jsonb,jsonb,date,date)';
const meta=async(db,sig)=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' meta,pg_get_functiondef(oid) definition from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
const call=(db,q={})=>H.call(db,{country:'印尼',startAt:'2026-10-11T00:00:00Z',endAt:'2026-10-11T23:59:59Z',...q});
const helper=(db,q={country:'印尼'},scope={mode:'all',countries:[]},from='2026-10-10',to='2026-10-11')=>db.query('select to_jsonb(x) r from private.dashboard_admin_duoli_withdraw_days($1,$2,$3::date,$4::date)x order by data_date,platform',[q,scope,from,to]).then(r=>r.rows.map(x=>x.r));
async function fixture(){const db=await H.fixture();try{
 await db.exec(`create table private.duoli_order_details(platform text,business text,source_order_id text primary key,country text,system_name text,created_at timestamptz,status_code text,operator text,audit_completed_at timestamptz,audit_duration_seconds bigint,observed_at timestamptz,received_at timestamptz);
 alter table private.duoli_order_details enable row level security;
 create index on private.duoli_order_details(platform,business,created_at);
 insert into synthetic_catalog values(md5('DUOLI UANG')::uuid,'UANG','M8','印尼','ID','duoli','Asia/Jakarta','IDR','UANG'),(md5('DUOLI FB168')::uuid,'FB168','M8','印尼','ID','duoli','Asia/Jakarta','IDR','FB168');`);
 const source=read('supabase/migrations/20261008050623_duoli_existing_orders.sql');const status=source.match(/create or replace function private.dashboard_admin_duoli_status\([\s\S]*?\$\$;/i)[0];await db.exec(status);await db.exec('revoke all on function private.dashboard_admin_duoli_status(text,text) from public,anon,authenticated,service_role');
 await db.exec(baseline);await db.exec('revoke all on function '+signature+' from public,anon,service_role;grant execute on function '+signature+' to authenticated');
 assert.equal((await meta(db,signature)).hash,'564e9a0b7d4b9585d7d254b973f7c67d');return db;
 }catch(e){await db.close();throw e}}
async function add(db,id,patch={}){const row={platform:'UANG',business:'withdraw',source_order_id:id,country:'ID',system_name:'DOLI',created_at:'2026-10-11T01:00:00+07:00',status_code:'6',operator:'Synthetic operator',audit_completed_at:'2026-10-11T01:01:00+07:00',audit_duration_seconds:60,observed_at:'2026-10-12T00:00:00+07:00',received_at:'2026-10-12T00:00:01+07:00',...patch};const keys=Object.keys(row);await db.query('insert into private.duoli_order_details('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row));}
async function install(db){await db.exec(migration)}
test('native DUOLI preserves exact created-date counts, source status and unknown classification with previous same-cohort data',async()=>{const db=await fixture();try{
 for(const s of['6','2','0','1','4','7','99'])await add(db,'current-'+s,{status_code:s});
 await add(db,'prior',{created_at:'2026-10-10T23:59:59+07:00',audit_completed_at:'2026-10-11T00:01:00+07:00',audit_duration_seconds:61});
 await add(db,'end',{created_at:'2026-10-12T00:00:00+07:00',audit_completed_at:'2026-10-12T00:00:00+07:00',audit_duration_seconds:0});
 await add(db,'charge',{business:'recharge'});await add(db,'foreign-country',{country:'PH'});await add(db,'foreign-system',{system_name:'OTHER'});
 await install(db);const r=await call(db),a=r.rows.find(x=>x.platform==='UANG');assert(a);assert.equal(a.total,7);assert.equal(a.success,2);assert.equal(a.rejected,2);assert.equal(a.autoCount,null);assert.equal(a.manualCount,null);assert.equal(a.unclassifiedCount,7);assert.equal(a.complete,false);assert.equal(a.reasonAvailable,false);assert.equal(a.comparisonComparable,false);assert.equal(a.previous.total,1);assert.equal(a.previous.unclassifiedCount,1);assert.equal(a.previous.source,'DUOLI');assert.equal(r.comparison.complete,false);assert.equal(r.totals.unclassifiedCount,7);assert.equal(r.totals.autoCount,null);assert.equal(r.totals.classificationPartial,false);
 const h=await helper(db);assert.equal(h.find(x=>x.platform==='UANG'&&x.data_date==='2026-10-11').pending_count,2);assert.equal(h.find(x=>x.platform==='UANG'&&x.data_date==='2026-10-11').unknown_count,1);assert.equal(h.find(x=>x.platform==='FB168').total,null,'missing facts do not create false zero day');
 }finally{await db.close()}});
test('operators retain known attribution and unknown account bucket; audit duration uses valid samples only',async()=>{const db=await fixture();try{
 await add(db,'success',{audit_duration_seconds:0,audit_completed_at:'2026-10-11T01:00:00+07:00'});await add(db,'rejected',{status_code:'4',audit_duration_seconds:120});
 await add(db,'missing',{operator:null,audit_completed_at:null,audit_duration_seconds:null,status_code:'99'});await add(db,'negative',{audit_duration_seconds:-1});await add(db,'future',{audit_completed_at:'2026-10-13T00:00:00+07:00'});await add(db,'before',{audit_completed_at:'2026-10-10T00:00:00+07:00'});
 await install(db);const r=await call(db,{view:'operators'}),known=r.rows.find(x=>x.account==='Synthetic operator'),unknown=r.rows.find(x=>x.account==='（未知操作人）');assert.equal(known.processed,5);assert.equal(known.success,4);assert.equal(known.rejected,1);assert.equal(known.durationSampleCount,2);assert.equal(known.durationTotalSeconds,120);assert.equal(known.avgSeconds,60);assert.equal(known.durationBasis,'source_reported_audit_duration');assert.equal(unknown.processed,1);assert.equal(unknown.success,0);assert.equal(unknown.avgSeconds,null);assert.equal(unknown.durationSampleCount,0);assert.equal((await call(db,{view:'operators',account:'Synthetic'})).total,1);
 }finally{await db.close()}});
test('source catalog, fresh scope and requested platform/country prevent cross-scope rows and duplicate legacy totals',async()=>{const db=await fixture();try{
 await add(db,'U');await add(db,'F',{platform:'FB168'});await db.exec("insert into auto_withdraw_daily values('2026-10-11','印尼','UANG',999,888,111,500,499,12,now(),now());insert into withdraw_operator_daily values('2026-10-11','印尼','UANG','Old operator',999,111,12,now(),now());");
 await install(db);assert.equal((await call(db)).totals.total,2);assert.equal((await call(db,{view:'operators'})).totals.processed,2);assert.equal((await call(db,{platform:'UANG'})).totals.total,1);assert.equal((await call(db,{platforms:['FB168']})).rows[0].platform,'FB168');assert.equal((await call(db,{scopeTargets:[{country:'印尼',platforms:['UANG']}]})).rows[0].platform,'UANG');
 await H.scope(db,{mode:'selected',countries:[],platforms:[{country:'ID',platform:'UANG'}]});assert.deepEqual((await call(db)).rows.map(x=>x.platform),['UANG']);assert.equal((await call(db,{platform:'FB168'})).rows.length,0);
 await H.scope(db,{mode:'selected',countries:[],platforms:[]});assert.equal((await call(db)).rows.length,0);
 assert.deepEqual(await helper(db,{country:'菲律宾'}),[]);assert.deepEqual(await helper(db,{country:'印尼'},{mode:'selected',countries:[],platforms:[]}),[]);
 }finally{await db.close()}});
test('non-DUOLI current DTO remains identical; mixed classifications preserve known partial totals and do not invent comparisons',async()=>{const db=await fixture();try{
 await db.exec("insert into auto_withdraw_daily values('2026-10-11','印尼','OTHER',10,8,2,7,3,12,now(),now());");const before=await call(db,{platform:'OTHER'});await add(db,'native');await install(db);assert.deepEqual(await call(db,{platform:'OTHER'}),before);const r=await call(db);assert.equal(r.totals.total,11);assert.equal(r.totals.autoCount,7);assert.equal(r.totals.manualCount,3);assert.equal(r.totals.unclassifiedCount,1);assert.equal(r.totals.classificationPartial,true);assert.equal(r.totals.classificationComparable,false);assert.equal(r.comparison.complete,false);
 }finally{await db.close()}});
test('migration is atomic, repeatable and preserves source rows plus caller metadata; helper execution stays private',async()=>{const db=await fixture();try{
 await add(db,'native');const old=await meta(db,signature),source=(await db.query('select jsonb_agg(to_jsonb(d))d from private.duoli_order_details d')).rows;
 await install(db);const first=await meta(db,signature);assert.deepEqual(first.meta,old.meta);await install(db);assert.deepEqual(await meta(db,signature),first);assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(d))d from private.duoli_order_details d')).rows,source);
 for(const role of['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>helper(db),/permission denied/);await db.exec('reset role')}
 }finally{await db.close()}});
test('unexpected main/status/helper body or security metadata fail closed without replacing the caller',async()=>{const db=await fixture();try{
 const block=migration.slice(migration.indexOf('DO $guard$'),migration.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_withdraw_days'));
 for(const installed of[false,true]){if(installed)await install(db);const before=await meta(db,signature);
 const mutations=[before.definition.replace('declare\n','declare\n -- synthetic drift\n'),'alter function '+signature+'security invoker','grant execute on function '+signature+'to service_role','alter function private.dashboard_admin_duoli_status(text,text) volatile'];if(installed)mutations.push('alter function '+helperSig+'security definer','grant execute on function '+helperSig+'to authenticated');
 for(const change of mutations){await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(block),/DUOLI_WITHDRAW_(MAIN|STATUS|HELPER)_DRIFT/);await db.exec('rollback');assert.deepEqual(await meta(db,signature),before)}
 }
 }finally{await db.close()}});
test('server sorting, pagination and per-day previous values use full native groups',async()=>{const db=await fixture();try{
 for(let n=0;n<25;n++)await add(db,'operator-'+n,{operator:'Synthetic '+String(n).padStart(2,'0'),audit_duration_seconds:n,status_code:n===0?'4':'6'});
 await add(db,'previous',{operator:'Synthetic 00',created_at:'2026-10-10T00:00:00+07:00',audit_completed_at:'2026-10-10T00:00:01+07:00',audit_duration_seconds:1});
 await install(db);const first=await call(db,{view:'operators',sort:'account',ascending:true,limit:20}),second=await call(db,{view:'operators',sort:'account',ascending:true,limit:20,offset:20});assert.equal(first.total,25);assert.equal(first.rows.length,20);assert.equal(second.rows.length,5);assert.equal(new Set([...first.rows,...second.rows].map(x=>x.account)).size,25);assert.equal(first.totals.processed,25);assert.equal(second.totals.processed,25);assert.equal(first.rows[0].previous.processed,1);assert.equal(first.rows[0].previous.durationBasis,'source_reported_audit_duration');
 const daily=await call(db,{view:'auto',daily:true});assert.equal(daily.rows[0].dataDate,'2026-10-11');assert.equal(daily.rows[0].previous.total,1);assert.equal(daily.rows[0].autoCount,null);
 }finally{await db.close()}});
test('an unobserved selected date exposes coverage unknown without fabricated zero platform or operator rows',async()=>{const db=await fixture();try{
 await install(db);for(const view of['auto','operators']){const r=await call(db,{view});assert.deepEqual(r.rows,[]);assert.equal(r.total,0);assert.equal(r.totals.total,undefined);assert.equal(r.totals.processed,undefined);assert.equal(r.duoliCoverage.complete,false);assert(r.duoliCoverage.days.every(x=>x.collected===null&&x.state==='no_received_facts'));assert.equal(r.comparison.complete,false)}
 }finally{await db.close()}});
test('actual Game66 rows expose received-note capabilities without changing auto/manual counts or unrelated rows',async()=>{const db=await fixture();try{
 await db.exec(`insert into game66_platforms(team_code,team_name,platform_name)values('hong_kong','香港','SYNTHETIC66');
 create or replace function private.dashboard_admin_live_game66_withdraw(date,date,text,text[]) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object(
 'rows',jsonb_build_array(jsonb_build_object('data_date','2026-10-11','country','香港','platform','SYNTHETIC66','total',10,'success',8,'rejected',2,'auto_count',7,'manual_count',3,'avg_seconds',12)),
 'operatorRows',jsonb_build_array(jsonb_build_object('data_date','2026-10-11','country','香港','platform','SYNTHETIC66','account','Synthetic game operator','processed',3,'rejected',2,'avg_seconds',12)))$$;
 insert into auto_withdraw_daily values('2026-10-11','香港','LEGACYHK',20,15,5,8,12,12,now(),now());`);
 const before={};for(const view of['auto','operators'])before[view]=await call(db,{country:'香港',view});await install(db);
 for(const view of['auto','operators']){const current=await call(db,{country:'香港',view}),note=current.rows.find(x=>x.platform==='SYNTHETIC66');assert(note);assert.equal(note.reasonAvailable,true);assert.equal(note.sourceNotesAvailable,true);assert.equal(note.sourceNoteFormat,'game66_withdraw_notes_v1');
 const stripped=structuredClone(current);for(const row of stripped.rows)if(row.platform==='SYNTHETIC66'){delete row.reasonAvailable;delete row.sourceNotesAvailable;delete row.sourceNoteFormat}assert.deepEqual(stripped,before[view]);}
 }finally{await db.close()}});
