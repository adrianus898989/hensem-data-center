// Synthetic local PostgreSQL only. No production orders, sessions, auth or network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{test}=require('node:test');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
function harness(name,expose){const file=path.join(repo,'tests',name),ctx=vm.createContext({__dirname:path.dirname(file),require:n=>n==='node:test'?{test(){}}:createRequire(file)(n),structuredClone});vm.runInContext(fs.readFileSync(file,'utf8').split(/\ntest\(/)[0]+';globalThis.audit='+expose,ctx);return ctx.audit;}
const h=harness('ar-rejected-unknown-operator-manual-sql.test.cjs','{fixture,core}'),helpers=harness('ar-withdraw-bounded-projection-sql.test.cjs','C.h');
const fixtureCode=read('tests/fixtures/auto-withdraw-selected-native-report-aliases-production.sql'),migration=read('supabase/migrations/20261012071007_auto_withdraw_selected_native_report_aliases.sql');
const baseline=fn(fixtureCode,'private.dashboard_admin_live_auto_withdraw');

const signature='private.dashboard_admin_live_auto_withdraw(jsonb)';
function fn(text,name){const re=new RegExp('CREATE(?: OR REPLACE)? FUNCTION '+name.replaceAll('.','\\.')+'\\([\\s\\S]*?AS (\\$[A-Za-z_0-9]*\\$)([\\s\\S]*?)\\1[;\\s]*','i');const m=text.match(re);assert(m,name);return m[0];}
async function installRealScope(db){await db.exec('drop function private.dashboard_scope_allows(jsonb,text,text)');await db.exec(fixtureCode);assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='private.dashboard_scope_allows(jsonb,text,text)'::regprocedure")).rows[0].hash,'87042edcedc3200c559a821250de831e');}
const call=(db,q={})=>db.query('select private.dashboard_admin_live_auto_withdraw($1::jsonb) r',[{country:'印度',startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-10T23:59:59Z',limit:20,...q}]).then(x=>x.rows[0].r);
const scope=(db,value)=>db.query("select set_config('test.scope',$1,false)",[JSON.stringify(value)]);
const all={mode:'all',countries:[]};
async function fixture(){const db=await h.fixture();try{await db.exec(read('supabase/migrations/20261012045328_ar_rejected_unknown_operator_manual.sql'));await db.exec(read('supabase/migrations/20261012055629_ar_withdraw_parameterized_partition_reads.sql'));await db.exec(baseline);await installRealScope(db);await scope(db,all);return db;}catch(e){await db.close();throw e;}}
async function main(){const db=await fixture();try{
 for(const day of ['2026-10-09','2026-10-10','2026-10-11']){
  for(const [country,p]of [['印度','LEGACY'],['印度','RAJA'],['印度','RAJALOTTERY'],['印度','OPERATOR-ONLY'],['巴西','BR-ONLY'],['BR','559K'],['胖虎巴西','559K'],['IN','ALIASED-COUNTRY'],['香港','HK-ONLY'],['红膏蟹','RED-ONLY'],['巴基斯坦','RAJA'],['巴基斯坦','92.GAME'],['UNKNOWN','UNMAPPED'],['印度',''],['印度',null]]){
   if(p!=='OPERATOR-ONLY')await helpers.legacy(db,p,day,20,5,15,country);
   await db.query('insert into withdraw_operator_daily values($1,$2,$3,$4,8,2,12,$5,$5)',[day,country,p,'Synthetic account','2026-10-12T00:00:00Z']);
  }
  await db.query("insert into newar_business_snapshots values('auto_withdraw_bundle','all','印度','DIRECT',$1,$2::jsonb,$3,$3)",[day,JSON.stringify({rows:[{total_count:4,success_count:3,reject_count:1,auto_count:1,manual_count:3,handle_count:2,total_handle_seconds:20}],operator_rows:[{operator:'Synthetic direct',processed_count:3,reject_count:1,handle_count:2,total_handle_seconds:20}]}),'2026-10-12T00:00:00Z']);
 }
 for(const [country,p]of [['印度','LEGACY'],['BR','559K'],['胖虎巴西','559K'],['香港','HK-ONLY']])await db.query('insert into auto_withdraw_notes values($1,$2,$3,$4,$5)',['2026-10-10',country,p,'Synthetic public note','2026-10-12T00:00:00Z']);
 const cases=[];for(const view of ['auto','operators'])for(const daily of [false,true])for(const sort of ['country','platform','account','total','processed','success','rejected','autoCount','manualCount','avgSeconds','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange'])cases.push({q:{view,daily,sort},s:all});
 const extras=[{}, {platforms:[]},{platform:'LEGACY'},{platform:'OPERATOR-ONLY'},{platforms:['91CLUB','LEGACY']},{platform:'DIRECT'},{view:'operators',account:'Synthetic'},{view:'operators',account:'ABSENT'},{offset:20},{ascending:true},{endAt:'2026-10-11T23:59:59Z'},{country:'巴西'},{country:'胖虎巴西'},{country:'巴基斯坦'},{country:'印度',scopeTargets:[{country:'印度',platforms:['LEGACY','RAJA']},{country:'香港',platforms:['HK-ONLY']},{country:'红膏蟹',platforms:['RED-ONLY']}]}];for(const q of extras)cases.push({q,s:all});
 const scopes=[{mode:'selected',countries:['IN']},{mode:'selected',countries:[],platforms:[]},{mode:'selected',countries:[],platforms:[{country:'IN',platform:'LEGACY'}]},{mode:'selected',countries:['IN'],platforms:[{country:'IN',platform:'RAJALOTTERY'}]},{mode:'selected',countries:[],platforms:[{country:'BR_PANGHU',platform:'559K'}]},{mode:'selected',countries:[],platforms:[{country:'HK_TEAM',platform:'HK-ONLY'}]},{mode:'selected',countries:['IN'],platforms:[{country:'PK',platform:'RAJA'}]},null,{}, {mode:'all',countries:[],platforms:[]}];
 for(const s of scopes)for(const q of [{},{view:'operators'},{country:'巴西'},{country:'胖虎巴西'},{country:'印度',scopeTargets:[{country:'香港',platforms:['HK-ONLY']}]}])cases.push({q,s});
 const beforeMeta=(await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid=$1::regprocedure",[signature])).rows[0].m,old=[];for(const {q,s}of cases){await scope(db,s);old.push(await call(db,q));}
 assert(old[0].platforms.includes('OPERATOR-ONLY'));await db.exec(migration);
 for(let i=0;i<cases.length;i++){await scope(db,cases[i].s);assert.deepEqual(await call(db,cases[i].q),old[i],'full DTO '+i+' '+JSON.stringify(cases[i]));}
 assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' m from pg_proc p where oid=$1::regprocedure",[signature])).rows[0].m,beforeMeta);
 await scope(db,{mode:'selected',countries:[],platforms:[{country:'IN',platform:'LEGACY'}]});const restricted=await call(db);assert.deepEqual(restricted.rows.map(r=>r.platform),['LEGACY']);assert(restricted.notes.every(n=>n.platform==='LEGACY'));
 await scope(db,{mode:'selected',countries:[],platforms:[]});assert.deepEqual((await call(db)).rows,[]);
 await db.exec("set test.denied='yes'");await assert.rejects(()=>call(db),/synthetic_session_denied|preview_denied/);await db.exec("set test.denied='no'");
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(()=>call(db),/permission denied/);await db.exec('reset role')}
 return {fullDTOComparisons:cases.length,differences:0,realScopeAllowsHash:'87042edcedc3200c559a821250de831e',metadataAndPermissionsPreserved:true,notesUseOriginalRawCountry:true,syntheticOnly:true};
 }finally{await db.close();}}

const metadata=async db=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' m,pg_get_functiondef(oid) d from pg_proc p where oid=$1::regprocedure",[signature])).rows[0];
const stored=async db=>(await db.query("select jsonb_build_object('source',(select jsonb_agg(to_jsonb(a)order by source_system,country_code,platform,order_kind,order_no)from ar_collected_orders a),'reports',(select jsonb_agg(to_jsonb(a)order by country,platform,data_date)from auto_withdraw_daily a),'facts',(select jsonb_agg(to_jsonb(f)order by country_code,platform,order_no)from private.ar_withdraw_facts f),'ready',(select jsonb_agg(to_jsonb(r)order by platform,data_date)from private.ar_withdraw_fact_ready r))r")).rows[0].r;
async function lottery(db){
 await db.exec("insert into synthetic_catalog values(md5('synthetic-lottery')::uuid,'LOTTERY77','M8','印度','IN','ar','Asia/Kolkata','INR','LOTTERY7')");
 for(const day of ['2026-10-10','2026-10-11'])for(const [i,status,op]of [[1,'已通过','SYSTEM'],[2,'未通过','Same account']])await db.query("insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,status,operator,applied_at,completed_at,observed_at,updated_at)values('AR','IN','LOTTERY7','withdraw',$1,$2,$3,$4::timestamp,$5::timestamp,'2026-10-12','2026-10-12')",['SYNTHETIC-LOTTERY-'+day+'-'+i,status,op,day+' 10:00',day+' 10:01']);
 await helpers.legacy(db,'LOTTERY7','2026-10-09',100,33,67,'印度');
 await db.query("insert into withdraw_operator_daily values('2026-10-09','印度','LOTTERY7','Same account',67,17,12,'2026-10-12','2026-10-12')");
}
test('all-scope and other sources retain 129 complete production-main JSON responses and native authorization',async()=>{assert.deepEqual(await main(),{fullDTOComparisons:129,differences:0,realScopeAllowsHash:'87042edcedc3200c559a821250de831e',metadataAndPermissionsPreserved:true,notesUseOriginalRawCountry:true,syntheticOnly:true})});
test('selected LOTTERY77 and native LOTTERY7 retain the same historical counts, times, operators and scoped pagination',async()=>{const db=await fixture();try{
 await lottery(db);for(const name of ['EXTRA-A','EXTRA-B','EXTRA-C','EXTRA-D','EXTRA-E','EXTRA-F','EXTRA-G','EXTRA-H','EXTRA-I'])for(const day of ['2026-10-09','2026-10-10'])await helpers.legacy(db,name,day,20,5,15,'印度');
 const before=await call(db,{limit:500}),beforeStored=await stored(db);assert.equal(before.rows.length,18,'representative complete 18-platform page');
 const missing=await call(db,{platforms:['LOTTERY77']});assert.equal(missing.rows.length,1);assert.equal(missing.rows[0].previous,null,'exact prepatch selected77 failure');
 const other=[];for(const q of [{platform:'MAAN.WIN'},{platform:'YASH.BET'},{platforms:['MAANWIN','LEGACY']},{view:'operators',account:'Same'},{offset:20,limit:20}])other.push([q,await call(db,q)]);
 await db.exec(migration);assert.deepEqual(await call(db,{limit:500}),before,'all18 entire DTO unchanged');assert.deepEqual(await stored(db),beforeStored);
 for(const [q,r]of other)assert.deepEqual(await call(db,q),r,'other source/filter unchanged');
 const native=await call(db,{platforms:['LOTTERY7']}),display=await call(db,{platforms:['LOTTERY77']});assert.deepEqual(display,native,'full selected display/native DTO');
 assert.equal(display.rows.length,1);assert.equal(display.rows[0].platform,'LOTTERY77');assert.equal(display.rows[0].total,2);assert.equal(display.rows[0].previous.total,100);assert.equal(display.rows[0].previous.autoCount,33);assert.equal(display.rows[0].previous.manualCount,67);assert.equal(display.previousTotals.total,100);assert.equal(display.totals.total,2);
 for(const q of [{platform:'LOTTERY77'},{platforms:['LOTTERY77'],scopeTargets:[{country:'印度',platforms:['LOTTERY77']}]},{platforms:['LOTTERY77'],daily:true}]){const r=await call(db,q);assert.equal(r.rows[0].previous.total,100)}
 const opNative=await call(db,{platforms:['LOTTERY7'],view:'operators'}),opDisplay=await call(db,{platforms:['LOTTERY77'],view:'operators'});assert.deepEqual(opDisplay,opNative);assert.equal(opDisplay.rows.find(x=>x.account==='Same account').previous.processed,67);
 assert.deepEqual(await call(db,{platforms:['LOTTERY77'],offset:20}),{...display,rows:[],offset:20},'server pagination preserves filtered totals');
 }finally{await db.close()}});
test('country, exact native grants, malformed/empty scopes and AR alias collisions never expand authorization',async()=>{const db=await fixture();try{
 await lottery(db);await helpers.legacy(db,'LOTTERY7','2026-10-09',999,900,99,'巴基斯坦');await helpers.legacy(db,'LOTTERY77','2026-10-10',777,700,77,'巴基斯坦');
 const foreignBefore=await call(db,{country:'巴基斯坦',platforms:['LOTTERY77']});await db.exec(migration);assert.deepEqual(await call(db,{country:'巴基斯坦',platforms:['LOTTERY77']}),foreignBefore);assert.equal((await call(db,{platforms:['LOTTERY77']})).previousTotals.total,100,'foreign same-name report excluded');
 for(const s of [{mode:'selected',countries:[],platforms:[]},{mode:'selected',countries:[],platforms:[{country:'PK',platform:'LOTTERY7'}]},{},{mode:'broken',countries:['IN']}]){await scope(db,s);assert.deepEqual((await call(db,{platforms:['LOTTERY77']})).rows,[])}
 // A selected name is a filter, never a grant: display-only grants do not unlock raw native7 reports.
 await scope(db,{mode:'selected',countries:[],platforms:[{country:'IN',platform:'LOTTERY77'}]});const displayOnly=await call(db,{platforms:['LOTTERY77']});assert.equal(displayOnly.rows[0].previous,null);
 await scope(db,all);await db.exec("insert into synthetic_catalog values(md5('synthetic-collision')::uuid,'LOTTERY77','M8','印度','IN','ar','Asia/Kolkata','INR','OKWIN')");const collision=await call(db,{platforms:['LOTTERY77']});assert(collision.rows.every(r=>r.previous===null),'another native AR identity disables report alias expansion');
 await db.exec("set test.denied='yes'");await assert.rejects(()=>call(db),/synthetic_session_denied/);await db.exec("set test.denied='no'");
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(()=>call(db),/permission denied/);await db.exec('reset role')}
 }finally{await db.close()}});
test('guarded apply/replay keeps function identity, source/facts, ACLs and metadata; main/mapping/AR drift fails closed',async()=>{const db=await fixture();try{
 const before=await metadata(db),source=await stored(db);assert.equal(before.hash,'a967a7ef42a61789e09b9ea3b11223bb');await db.exec(migration);const after=await metadata(db);assert.equal(after.hash,'5965cb8899f0717678aaf7da6195c1c1');assert.deepEqual(after.m,before.m);await db.exec(migration);assert.deepEqual(await metadata(db),after);assert.deepEqual(await stored(db),source);
 const block=migration.slice(migration.indexOf('do $selected_report_aliases$'),migration.lastIndexOf('commit;'));
 for(const installed of [false,true]){await db.exec(installed?after.d:before.d);const expected=await metadata(db);for(const drift of [expected.d.replace('declare\n','declare\n -- synthetic drift\n'),`alter function ${signature} strict`,`alter function ${signature} security invoker`,`grant execute on function ${signature} to anon`,"alter function private.dashboard_scope_allows(jsonb,text,text) strict","alter function private.dashboard_data_scope_valid(jsonb) stable","alter function private.dashboard_admin_live_withdraw_key(text) strict","alter function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)security definer","grant execute on function private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)to authenticated"]){await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(block),/WITHDRAW_REPORT_ALIAS_.*DRIFT/);await db.exec('rollback');assert.deepEqual(await metadata(db),expected)}}
 assert.deepEqual(await stored(db),source);assert.deepEqual((await db.query("select has_function_privilege('anon',$1,'execute')anon,has_function_privilege('service_role',$1,'execute')service,has_function_privilege('authenticated',$1,'execute')auth",[signature])).rows[0],{anon:false,service:false,auth:true});
 }finally{await db.close()}});
