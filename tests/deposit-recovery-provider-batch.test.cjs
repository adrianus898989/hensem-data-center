const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const{PGlite}=require('@electric-sql/pglite');
const BASE=path.resolve(__dirname,'..'),FIX=path.join(__dirname,'fixtures');
const NEW='1o0nhJfztjVX9gNwH43uPWg5BUuhBxDMZ-_WUWdRd588',OLD='1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE';
const dir=path.resolve(__dirname,'..');let seq=0;
const dynamic=fs.readFileSync(path.join(dir,'supabase/migrations/'+'20261014100354_deposit_recovery_batch_provider_parameters.sql'),'utf8');
function inverse(){
 const bh=dynamic.match(/old_hash text:='([^']+)'/)[1],ah=dynamic.match(/new_hash text:='([^']+)'/)[1];
 const before=dynamic.split('$before_metadata$')[1],after=dynamic.split('$after_metadata$')[1];
 const parts=dynamic.split('$dynamic_recovery_patches$');parts[1]=JSON.stringify(JSON.parse(parts[1]).reverse().map(p=>({old:p.new,new:p.old,count:p.count})));
 return parts.join('$dynamic_recovery_patches$').replace("old_hash text:='"+bh+"';new_hash text:='"+ah+"'","old_hash text:='"+ah+"';new_hash text:='"+bh+"'").replace('$before_metadata$'+before+'$before_metadata$','$before_metadata$'+after+'$before_metadata$').replace('$after_metadata$'+after+'$after_metadata$','$after_metadata$'+before+'$after_metadata$');
}
const rollback=inverse();
const patches=JSON.parse(dynamic.split('$dynamic_recovery_patches$')[1]);
const dictionary=patches[0].new;
let comparisons=0;
const migration=fs.readFileSync(path.join(dir,'supabase/migrations/20261014083301_deposit_recovery_source_provider_numeric_equality.sql'),'utf8');
function object(file){const m=fs.readFileSync(BASE+'/supabase/migrations/20261014054828_deposit_recovery_statistics.sql','utf8');const x=m.split('-- BEGIN RECOVERY OBJECT '+file+'\n')[1].split('-- END RECOVERY OBJECT '+file+'\n')[0];return x.slice(x.indexOf('$object$')+8,x.lastIndexOf('$object$'));}
async function fixture(){const db=new PGlite();await db.exec(fs.readFileSync(FIX+'/deposit-recovery-source-fixture.sql','utf8'));await db.exec(fs.readFileSync(FIX+'/deposit-recovery-native-fixture.sql','utf8'));await db.exec(fs.readFileSync(FIX+'/deposit-recovery-provider-adapters.sql','utf8'));await db.exec(fs.readFileSync(FIX+'/deposit-recovery-provider-canonical.sql','utf8'));await db.exec('revoke all on function private.dashboard_admin_live_provider_canonical(text,text,text)from public,anon,authenticated,service_role;');
 for(const f of['recovery-cases.sql','recovery-metrics.sql','recovery-workorders.sql','recovery-query.sql'])await db.exec(object(f));await db.exec(object('recovery-cases.sql').replace('private.dashboard_admin_deposit_recovery_cases','private.synthetic_original_cases'));await db.exec('revoke all on function private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb),private.dashboard_admin_deposit_recovery_metrics(jsonb),private.dashboard_admin_deposit_recovery_workorders(jsonb,jsonb),private.dashboard_admin_deposit_recovery_statistics(jsonb)from public,anon,authenticated,service_role;');await db.exec(migration);
 const current=(await db.query("select pg_get_functiondef('private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)'::regprocedure)d")).rows[0].d;
 await db.exec(current.replace('private.dashboard_admin_deposit_recovery_cases','private.synthetic_bound_baseline_cases'));
 const stats=(await db.query("select pg_get_functiondef('private.dashboard_admin_deposit_recovery_statistics(jsonb)'::regprocedure)d")).rows[0].d;
 await db.exec(stats.replace('private.dashboard_admin_deposit_recovery_statistics','private.synthetic_bound_baseline_statistics').replaceAll('private.dashboard_admin_deposit_recovery_cases','private.synthetic_bound_baseline_cases'));
 let bound=current;for(const patch of patches)bound=bound.replace(patch.old,()=>patch.new);await db.exec(bound);
 const add=async(table,x)=>{const k=Object.keys(x);await db.query(`insert into public.${table}(${k})values(${k.map((_,i)=>'$'+(i+1))})`,k.map(n=>x[n]));};
 const sheet=(ref,p='UPI-QR2',amount='100',extra={})=>add('admin_deposit_followup_rows',{id:'SYNTH-S-'+(++seq),country:'印度',platform:'RAJA',order_number:ref,amount,provider:p,source_kind:'sheet',source_sheet:NEW,source_tab:'SYNTH',source_row:seq,followup_status:'Success',updated_at:'2026-10-14T01:00:00Z',...extra});
 const issue=(ref,p='UPI-QR2',amount='100.00',extra={})=>add('admin_deposit_issue_rows',{id:'SYNTH-I-'+(++seq),country:'印度',platform:'RAJA',order_number:ref,amount,provider:p,canonical_provider:'UPI',source_sheet:'SYNTH-ISSUE',source_tab:'SYNTH',source_row:seq,confirmation_status:'已入款',updated_at:'2026-10-14T02:00:00Z',...extra});
 const portal=(ref,p='UPI-QR2',extra={})=>sheet(ref,p,'100.00',{source_kind:'portal',source_sheet:'PORTAL',portal_payload:{entry:{outcome:'success',recoveryKind:'manual',recoveryAmount:'7.05',completedAt:'2026-10-13'}},...extra});
 const cases=async(old=false,scope={mode:'all'},filter={})=>(await db.query('select * from private.'+(old?'synthetic_original_cases':'dashboard_admin_deposit_recovery_cases')+'($1,true,$2)order by payment_id',[JSON.stringify(scope),JSON.stringify(filter)])).rows;
 const query=async(req={})=>(await db.query('select private.dashboard_admin_deposit_recovery_statistics($1)d',[JSON.stringify({section:'recovery',...req})])).rows[0].d;
 return{db,add,sheet,issue,portal,cases,query};}
test('same-source and cross-source numeric equal scales are compatible; NULL/nonfinite/actual differences remain conflicts',async()=>{const h=await fixture();try{
 await h.db.exec('alter table public.admin_deposit_issue_rows alter column amount type numeric;alter table public.admin_deposit_followup_rows alter column amount type numeric');
 await h.sheet('RC2026101001','Same','100');await h.sheet('RC2026101001','Same','100.00');
 await h.sheet('RC2026101002','Same','100');await h.issue('RC2026101002','Same','100.00',{canonical_provider:'Same'});
 for(const [id,a,b]of[['03','100','100.01'],['04','100',null],['05',null,null],['06','NaN','NaN'],['07','Infinity','Infinity'],['08','-Infinity','-Infinity'],['09','9999999999999999999999.90','9999999999999999999999.9']]){await h.sheet('RC20261010'+id,'Same',a);await h.issue('RC20261010'+id,'Same',b,{canonical_provider:'Same'});}
 const old=await h.cases(true),now=await h.cases();assert.equal(old.find(x=>x.payment_id==='RC2026101001').conflict,true);for(const id of['01','02','09'])assert.equal(now.find(x=>x.payment_id==='RC20261010'+id).conflict,false);
 for(const id of['03','04','06','07','08'])assert.equal(now.find(x=>x.payment_id==='RC20261010'+id).conflict,true);
 assert.equal(now.find(x=>x.payment_id==='RC2026101005').conflict,false);assert.equal(now.find(x=>x.payment_id==='RC2026101005').original_amount,null);assert.equal(now[0].duplicate_source_rows,1);assert.deepEqual(now[0].sources.map(x=>x.originalAmount),['100','100.00']);
 }finally{await h.db.close();}});

test('all three sources use the same official raw provider mapping while preserving original provenance',async()=>{const h=await fixture();try{
 await h.sheet('RC2026101001');await h.issue('RC2026101001');await h.portal('RC2026101001');
 await h.sheet('RC2026101002','Phonepe_QR');await h.issue('RC2026101002','Phonepe_QR','100',{canonical_provider:'Phonepe'});
 await h.sheet('RC2026101003','Super-QR');await h.issue('RC2026101003','PAYTM-Super','100',{canonical_provider:'Super'});
 const old=await h.cases(true);assert(old.every(x=>x.conflict));const now=await h.cases();assert(now.every(x=>!x.conflict));assert.deepEqual(now.map(x=>x.provider),['ATPay','UPI-QR','SUPER']);assert(now[0].sources.every(x=>x.provider==='UPI-QR2'));
 const r=await h.query({view:'details',limit:100});assert.equal(r.total,3);assert.equal(r.summary.manualRecoveredCount,1);assert.equal(r.summary.manualRecoveredAmount,'7.05');assert.equal(r.summary.receivedUnknownCount,2);assert.equal(r.summary.differenceAmount,null);assert.equal(r.summary.conflictCount,0);assert.equal(r.daily.reduce((n,x)=>n+x.registeredOrders,0),3);assert.equal(r.providers.reduce((n,x)=>n+x.registeredOrders,0),3);const exp=await h.query({export:true});assert.equal(exp.rows.length,exp.total);assert.equal(exp.exportComplete,true);assert.deepEqual(exp.summary,r.summary);
 }finally{await h.db.close();}});
test('true provider/state/current-issue contradictions and missing identity are retained; same-source alias-only conflict remains conservative',async()=>{const h=await fixture();try{
 await h.sheet('RC2026101001','Truly Other');await h.issue('RC2026101001');await h.issue('RC2026101002');await h.issue('RC2026101002','UPI-QR2','100',{confirmation_status:'已确认'});await h.portal('RC2026101002');
 await h.issue('RC2026101003','PAYTM-Super');await h.issue('RC2026101003','Super-QR');await h.sheet(null);
 const now=await h.cases();assert(now.every(x=>x.conflict));assert.equal(now.find(x=>x.payment_id==='RC2026101003').provider,'SUPER');assert.equal(now.find(x=>x.payment_id==='RC2026101002').recovery_kind,'unknown');
 }finally{await h.db.close();}});
test('country/raw-platform scoped registry/override/WG/YASH rules and blank-provider fallback retain exact context',async()=>{const h=await fixture();try{
 await h.db.exec("insert into private.dashboard_admin_provider_registry values('印度','RAJA','UPI-QR2',array['Registry']);insert into private.dashboard_admin_provider_overrides values('印度','RAJA','UPI-QR2','Override');insert into private.synthetic_wg_aliases values('IN','印度','RAJA','WGRAW','WGCanonical');");
 await h.sheet('RC2026101001');await h.issue('RC2026101001');await h.sheet('RC2026101002','WGRAW');await h.issue('RC2026101002','WGRAW');await h.issue('RC2026101003',null,'100',{canonical_provider:'ATPay'});await h.sheet('RC2026101003','UPI-QR2');await h.sheet('RC2026101004','WinPay','100',{platform:'YASH.BET'});await h.issue('RC2026101004','WinPay','100',{platform:'YASH.BET'});await h.sheet('RC2026101005','UPI-QR2','100',{platform:'HIDDEN'});await h.sheet('RC2026101006','UPI-QR2','100',{country:'巴基斯坦'});
 const scoped=await h.cases(false,{mode:'platforms',platforms:['RAJA']});assert.equal(scoped.length,3);assert.equal(scoped[0].provider,'Override');assert.equal(scoped[1].provider,'WGCanonical');assert.equal(scoped[2].conflict,true);const all=await h.cases();assert.equal(all.find(x=>x.payment_id==='RC2026101004').provider,'NewWinPay');assert(!all.some(x=>x.payment_id==='RC2026101006'));
 await h.db.exec("update private.dashboard_admin_provider_overrides set canonical_provider='NewOverride'");assert.equal((await h.cases(false,{mode:'platforms',platforms:['RAJA']},{orderNumber:'1001'}))[0].provider,'NewOverride');
 }finally{await h.db.close();}});

test('all 20 fields, full statistics DTO, defaults and null/filter binds remain exact',async()=>{const h=await fixture();try{
 await h.sheet('RC2026101001');await h.issue('RC2026101001');await h.portal('RC2026101001');
 await h.sheet('RC2026093002','Phonepe_QR',null,{platform:'YASH.BET',followup_status:'pending',source_sheet:OLD});
 await h.sheet('RC2026093002','Phonepe_QR',null,{platform:'YASH.BET',followup_status:'Success'});
 await h.sheet('RC2026139903','Truly Other','15.50');await h.issue('RC2026139903','Truly Other','15.50',{canonical_provider:'Same'});
 await h.issue(null,null,null,{platform:null,canonical_provider:null});
 await h.sheet('RC2026101005','PAYTM-Super');await h.sheet('RC2026101005','Super-QR');
 await h.portal('RC2026101006','Same',{portal_payload:{entry:{outcome:'success',recoveryKind:'unknown',recoveryAmount:'2.50',completedAt:'2026-10-12'}}});
 await h.portal('RC2026101007','Same',{portal_payload:{entry:{outcome:'success',recoveryKind:'manual',recoveryAmount:12,completedAt:'2026-10-12'}}});
 await h.sheet('RC2026101008','UPI-QR2','100',{platform:'HIDDEN'});
 await h.sheet('RC2026101009','UPI-QR2','100',{country:'巴基斯坦'});
 const all={mode:'all'},scoped={mode:'platforms',platforms:['RAJA']};
 const id=(await h.cases())[0].case_id;
 const filters=[{},null,{caseIds:[]},{caseIds:[id]},{caseIds:null},{platform:'RAJA'},{platform:'HIDDEN'},{orderNumber:'1001'},{orderNumber:"x' $business$; --"},{orderNumber:'%_'}];
 for(const mode of ['auto','force_generic_plan','force_custom_plan']){
  await h.db.exec('set plan_cache_mode='+mode);
  for(const details of [false,true,null])for(const filter of filters)for(const scope of [all,scoped,null]){
   const rows=(await h.db.query('select (select coalesce(jsonb_agg(to_jsonb(c)order by c.case_id),\'[]\'::jsonb)from private.synthetic_bound_baseline_cases($1,$2,$3)c)::text old,(select coalesce(jsonb_agg(to_jsonb(c)order by c.case_id),\'[]\'::jsonb)from private.dashboard_admin_deposit_recovery_cases($1,$2,$3)c)::text new',[scope===null?null:JSON.stringify(scope),details,filter===null?null:JSON.stringify(filter)])).rows[0];
   assert.equal(rows.new,rows.old);comparisons++;
  }
 }
 for(const args of ['$1','$1,$2']){
  const rows=(await h.db.query('select (select jsonb_agg(c order by c.case_id)from private.synthetic_bound_baseline_cases('+args+')c)::text old,(select jsonb_agg(c order by c.case_id)from private.dashboard_admin_deposit_recovery_cases('+args+')c)::text new',args==='$1'?[JSON.stringify(all)]:[JSON.stringify(all),true])).rows[0];assert.equal(rows.new,rows.old);comparisons++;
 }
 const requests=[{}, {view:'details',limit:20},{view:'details',limit:50,offset:2},{view:'details',provider:'ATPay',limit:100},{platform:'RAJA'},{orderNumber:'1001'},{recoveryState:'conflict'},{recoveryState:'received_unknown'},{dateMode:'range',startAt:'2026-09-01T00:00:00Z',endAt:'2026-10-14T23:59:59Z'},{export:true}];
 for(const scope of [all,scoped]){
  await h.db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scope)]);
  for(const request of requests){const p=JSON.stringify({section:'recovery',...request});const r=(await h.db.query('select private.synthetic_bound_baseline_statistics($1)::text old,private.dashboard_admin_deposit_recovery_statistics($1)::text new',[p])).rows[0];assert.equal(r.new,r.old);comparisons++;}
 }
 for(const request of [null,[],{section:'other'},{section:'recovery',limit:19},{section:'recovery',dateMode:'range',startAt:'BAD',endAt:'2026-10-14'}]){
  const values=[];for(const name of ['synthetic_bound_baseline_statistics','dashboard_admin_deposit_recovery_statistics']){try{await h.db.query('select private.'+name+'($1)',[JSON.stringify(request)]);values.push('success');}catch(e){values.push(e.code+':'+e.message);}}assert.equal(values[1],values[0]);comparisons++;
 }
 console.log(JSON.stringify({batchComparisons:comparisons}));
 }finally{await h.db.close();}});

test('batch exactly preserves registry/WG/YASH precedence, NULL arrays, short circuits and scalar errors',async()=>{const h=await fixture();try{
 await h.db.exec(`create table private.synthetic_confirmed(country text,platform text,raw text,value text,primary key(country,platform,raw));
 create or replace function private.dashboard_admin_live_confirmed_provider(p_country text,p_platform text,p_raw text)returns text language plpgsql immutable as $$begin if p_raw='BOMB'then raise exception using errcode='22023',message='SYNTHETIC_CONFIRMED_ERROR';end if;return(select value from private.synthetic_confirmed where country=p_country and platform=p_platform and raw=p_raw);end;$$;
 create or replace function private.dashboard_admin_live_provider_alias_values(p_country text,p_names text[])returns text[]language sql immutable set search_path=''as $$select coalesce(array_agg(distinct name order by name),'{}'::text[])from(select private.dashboard_admin_live_provider_alias(p_country,n)name from unnest(p_names)n)names;$$;`);
 const specs=[['NO_REG',undefined,undefined,undefined],['NULL_NAMES',null,undefined,undefined],['EMPTY',[],undefined,undefined],['NULL_ELEM',[null],undefined,undefined],['MULTI',['A','B'],undefined,undefined],['DUP_ALIAS',['PAYTM-Super','Super-QR'],undefined,undefined],['MIX_NULL',[null,'A'],undefined,undefined],['OVERRIDE',['A'],'WIN',undefined],['EMPTY_OVERRIDE',['A'],'',undefined],['CONFIRMED',['A'],undefined,'CONFIRMED'],['EMPTY_CONFIRMED',['A'],undefined,''],['OVERRIDES_CONFIRM',['A'],'OVERRIDE','CONFIRMED']];
 let seqId=40;for(const [raw,names,override,confirmed]of specs){if(names!==undefined)await h.db.query('insert into private.dashboard_admin_provider_registry values($1,$2,$3,$4)',['印度','RAJA',raw,names]);if(override!==undefined)await h.db.query('insert into private.dashboard_admin_provider_overrides values($1,$2,$3,$4)',['印度','RAJA',raw,override]);if(confirmed!==undefined)await h.db.query('insert into private.synthetic_confirmed values($1,$2,$3,$4)',['印度','RAJA',raw,confirmed]);await h.sheet('RC20261010'+seqId++,raw);}
 await h.db.exec("insert into private.dashboard_admin_provider_registry values('印度','RAJA','BOMB',array['REGISTRY']);insert into private.dashboard_admin_provider_overrides values('印度','RAJA','BOMB','SAFE');insert into private.synthetic_wg_aliases values('IN','印度','RAJA','WGBOMB','WG'),('IN','印度','RAJA','WGNULL',null),('IN','印度','YASH.BET','WinPay','BAD-A'),('IN','印度','YASH.BET','WinPay','BAD-B');insert into private.dashboard_admin_provider_registry values('印度','RAJA','WGNULL',array['REGISTRY']),('印度','RAJA','',array['UNRECOGNIZED']);insert into private.dashboard_admin_provider_overrides values('印度','RAJA','WGONLY','DO_NOT_USE');");
 for(const raw of ['BOMB','WGBOMB','WGNULL','WGONLY','未识别通道',null,'','Unicode😀'])await h.sheet('RC20261010'+seqId++,raw);
 await h.sheet('RC20261010'+seqId++,'WinPay','100',{platform:'YASH.BET'});
 const compare=async()=>{for(const details of [false,true,null]){const rows=(await h.db.query("select(select jsonb_agg(to_jsonb(c)order by case_id)from private.synthetic_bound_baseline_cases($1,$2,$3)c)::text old,(select jsonb_agg(to_jsonb(c)order by case_id)from private.dashboard_admin_deposit_recovery_cases($1,$2,$3)c)::text new",[JSON.stringify({mode:'all'}),details,'{}'])).rows[0];assert.equal(rows.new,rows.old);comparisons++;}};
 await compare();
 for(const raw of ['WG_DUP','WG_DUP_NULL']){
  await h.db.query('insert into private.synthetic_wg_aliases values($1,$2,$3,$4,$5),($1,$2,$3,$4,$6)',['IN','印度','RAJA',raw,raw==='WG_DUP_NULL'?null:'A',raw==='WG_DUP_NULL'?null:'B']);await h.sheet('RC20261010'+seqId++,raw);
  const errors=[];for(const name of ['synthetic_bound_baseline_cases','dashboard_admin_deposit_recovery_cases'])try{await h.db.query('select *from private.'+name+'($1,false,$2)',[JSON.stringify({mode:'all'}),'{}']);errors.push('success');}catch(e){errors.push({code:e.code,message:e.message});}assert.deepEqual(errors[1],errors[0]);assert.equal(errors[0].code,'21000');
  await h.db.query('delete from private.synthetic_wg_aliases where raw_provider=$1',[raw]);await compare();
 }
 await h.db.exec("delete from private.dashboard_admin_provider_overrides where raw_provider='BOMB'");
 const errors=[];for(const name of ['synthetic_bound_baseline_cases','dashboard_admin_deposit_recovery_cases'])try{await h.db.query('select *from private.'+name+'($1,false,$2)',[JSON.stringify({mode:'all'}),'{}']);errors.push('success');}catch(e){errors.push({code:e.code,message:e.message});}assert.deepEqual(errors[1],errors[0]);assert.equal(errors[0].message,'SYNTHETIC_CONFIRMED_ERROR');
 }finally{await h.db.close();}});

test('batch reuses one WG set and one alias call per final input without changing provider output',async()=>{const h=await fixture();try{
 await h.db.exec('create sequence private.synthetic_alias_calls;create sequence private.synthetic_wg_calls');
 await h.db.exec("alter function private.dashboard_admin_live_provider_alias(text,text)rename to synthetic_real_alias;create function private.dashboard_admin_live_provider_alias(p_country text,p_name text)returns text language plpgsql immutable as $$begin perform nextval('private.synthetic_alias_calls');return private.synthetic_real_alias(p_country,p_name);end;$$;");
 await h.db.exec("create or replace function private.dashboard_admin_wg_provider_aliases()returns table(country_code text,country text,platform text,raw_provider text,canonical_provider text)language plpgsql stable as $$begin perform nextval('private.synthetic_wg_calls');return query select a.country_code,a.country,a.platform,a.raw_provider,a.canonical_provider from private.synthetic_wg_aliases a;end;$$;");
 for(const platform of ['RAJA','YASH.BET','SYNTHETIC'])for(const raw of ['P1','P2','P3'])for(let n=0;n<3;n++)await h.sheet('RC2026101060'+n,raw,'100',{platform});
 const receipts=[];for(const name of ['synthetic_bound_baseline_cases','dashboard_admin_deposit_recovery_cases']){
  await h.db.exec('alter sequence private.synthetic_alias_calls restart with 1;alter sequence private.synthetic_wg_calls restart with 1');
  const rows=(await h.db.query('select jsonb_agg(to_jsonb(c)order by c.case_id)::text d from private.'+name+'($1,false,$2)c',[JSON.stringify({mode:'all'}),'{}'])).rows[0].d;
  const counts=(await h.db.query('select(select last_value::int from private.synthetic_alias_calls)aliases,(select last_value::int from private.synthetic_wg_calls)wg')).rows[0];receipts.push({rows,...counts});
 }
 assert.equal(receipts[1].rows,receipts[0].rows);assert.equal(receipts[0].aliases,9);assert.equal(receipts[1].aliases,3);assert.equal(receipts[0].wg,9);assert.equal(receipts[1].wg,1);console.log(JSON.stringify({originalAliasCalls:9,batchAliasCalls:3,originalWgCalls:9,batchWgCalls:1}));
 }finally{await h.db.close();}});

async function installerFixture(){const db=new PGlite();await db.exec(fs.readFileSync(FIX+'/deposit-recovery-source-fixture.sql','utf8'));await db.exec(fs.readFileSync(FIX+'/deposit-recovery-native-fixture.sql','utf8'));await db.exec(fs.readFileSync(FIX+'/deposit-recovery-provider-batch-dependencies.sql','utf8'));
 for(const f of ['recovery-cases.sql','recovery-metrics.sql','recovery-workorders.sql','recovery-query.sql'])await db.exec(object(f));
 await db.exec('revoke all on function private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb),private.dashboard_admin_deposit_recovery_metrics(jsonb),private.dashboard_admin_deposit_recovery_workorders(jsonb,jsonb),private.dashboard_admin_deposit_recovery_statistics(jsonb)from public,anon,authenticated,service_role');await db.exec(migration);return db;}
const metadataSql="select p.oid::regprocedure::text signature,md5(p.prosrc)body,pg_get_userbyid(p.proowner)owner,p.proacl::text acl,p.proconfig config,l.lanname language,p.provolatile volatile,p.prosecdef secdef,p.proisstrict strict,p.proparallel parallel,p.proleakproof leakproof,p.procost cost,p.prorows rows,p.pronargdefaults defaults,p.provariadic::text variadic,p.prokind kind,p.proretset setret,pg_get_function_arguments(p.oid)args,pg_get_function_result(p.oid)result from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='private'and p.proname in('dashboard_admin_deposit_recovery_cases','dashboard_admin_deposit_recovery_statistics','dashboard_admin_deposit_recovery_workorders','dashboard_admin_deposit_recovery_metrics','dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider','dashboard_admin_live_provider_alias')order by p.proname";
test('metadata-faithful MV/helpers guarded installation, replay and exact rollback preserve scope/ACL/other functions/session settings',async()=>{const db=await installerFixture();try{
 const snapshot=async()=>(await db.query(metadataSql)).rows;const source=async()=>(await db.query('select(select jsonb_agg(r)from public.admin_deposit_followup_rows r)f,(select jsonb_agg(r)from public.admin_deposit_issue_rows r)i')).rows;
 const baseline=(await db.query("select pg_get_functiondef('private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)'::regprocedure)d")).rows[0].d,before=await snapshot(),data=await source();
 const settings=async()=>(await db.query("select current_setting('plan_cache_mode')p,current_setting('statement_timeout')s,current_setting('lock_timeout')l")).rows;const settingsBefore=await settings();
 await db.exec(dynamic);const after=await snapshot(),target=after.find(x=>x.signature==='private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)');assert.equal(target.body,'29bfa5d6705555e50838e52d40fc431d');assert.equal(target.language,'plpgsql');
 assert.deepEqual(before.map(x=>x.signature.includes('_cases(')?{...x,body:null,language:null}:x),after.map(x=>x.signature.includes('_cases(')?{...x,body:null,language:null}:x));
 await db.exec(dynamic);assert.deepEqual(await snapshot(),after);assert.deepEqual(await settings(),settingsBefore);assert.deepEqual(await source(),data);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)','EXECUTE')v",[role])).rows[0].v,false);
 await db.exec(rollback);assert.equal((await db.query("select pg_get_functiondef('private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)'::regprocedure)d")).rows[0].d,baseline);assert.deepEqual(await snapshot(),before);await db.exec(rollback);await db.exec(dynamic);assert.deepEqual(await snapshot(),after);assert.deepEqual(await source(),data);assert.deepEqual(await settings(),settingsBefore);
 }finally{await db.close();}});

test('function/helper/schema/index/ACL/inheritance drift fails closed before replacement',async()=>{
 const drifts=["alter function private.dashboard_admin_deposit_recovery_cases(jsonb,boolean,jsonb)set search_path='public'","alter function private.dashboard_admin_live_provider_alias(text,text)cost 101","grant select on private.dashboard_admin_provider_overrides to authenticated","drop index private.dashboard_admin_provider_registry_key;create index dashboard_admin_provider_registry_key on private.dashboard_admin_provider_registry(country,platform,raw_provider)","create table private.synthetic_override_child()inherits(private.dashboard_admin_provider_overrides)"];
 for(const drift of drifts){const db=await installerFixture();try{await db.exec(drift);const before=(await db.query(metadataSql)).rows;await assert.rejects(db.exec(dynamic),e=>e.message.includes('_drift'));await db.exec('rollback');assert.deepEqual((await db.query(metadataSql)).rows,before);}finally{await db.close();}}
});
