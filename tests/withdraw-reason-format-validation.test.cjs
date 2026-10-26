// Portable offline tests. All runtime records and measurements are synthetic.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sql=phase=>read('supabase/maintenance/withdraw-reason-format-validation.'+phase+'.sql');
const install=sql('install'),rollback=sql('rollback'),specs=JSON.parse(install.match(/\$specs\$([\s\S]*?)\$specs\$/)[1]);
const defs=source=>[...source.matchAll(/EXECUTE \$definition\$([\s\S]*?)\$definition\$;/g)].map(x=>x[1]),beforeDefs=defs(rollback),afterDefs=defs(install);
const oldFile=path.join(__dirname,'fixtures/withdraw-reason-atomic-rules/tests/install.test.cjs'),oldModule={exports:{}},oldRequire=require('node:module').createRequire(oldFile);
new Function('require','__dirname','module',fs.readFileSync(oldFile,'utf8'))(name=>name==='node:test'?{test:()=>{}}:oldRequire(name),path.dirname(oldFile),oldModule);
const old=oldModule.exports,scalar=async(db,q,args=[])=>(await db.query(q,args)).rows[0].v;
async function setup(){const db=await old.setup();try{
 await db.exec(old.sql('install'));
 // Real native dependency functions over synthetic tables; PANDA is outside
 // the pack's India AR/NEWAR targets, but its signature must resolve at parse time.
 await db.exec("create schema if not exists panda_private;create function panda_private.prepared_window(text,text,timestamptz,timestamptz)returns jsonb language sql stable as $$select '{}'::jsonb$$");
 await db.exec(read('supabase/migrations/20261015141000_exact_prepared_aggregates.sql').match(/create function private\.prepared_aggregate_dependency\(p_target jsonb\)[\s\S]*?\$fn\$;/)[0]);
 await db.exec(read('supabase/migrations/20261017074658_prepared_panda_verified_prefix.sql').match(/CREATE OR REPLACE FUNCTION private\.prepared_aggregate_dependency\(p_target jsonb, p_common text\)[\s\S]*?\$function\$;/)[0]);
 await db.exec('revoke all on function private.prepared_aggregate_dependency(jsonb),private.prepared_aggregate_dependency(jsonb,text)from public,anon,authenticated,service_role');return db;
 }catch(e){await db.close();throw e;}}
const metadata=async db=>(await db.query('select oid::regprocedure::text signature,to_jsonb(p) metadata from pg_proc p where oid=any($1::regprocedure[])order by 1',[specs.map(s=>s.signature)])).rows;
const tokens=db=>scalar(db,"select jsonb_build_object('reason',private.withdraw_reason_dependency(),'withdraw',private.withdraw_prepared_dependency(),'common',private.prepared_aggregate_dependency_common('IN'),'native',(select jsonb_object_agg(n.id,private.prepared_aggregate_dependency(to_jsonb(n)))from private.prepared_aggregate_native_catalog()n where n.country='印度'and n.source in('ar','newar')))v");
const sourceSnapshot=db=>scalar(db,"select jsonb_build_object('ar',(select jsonb_agg(to_jsonb(x)order by to_jsonb(x)::text)from public.ar_collected_orders x),'newar',(select jsonb_agg(to_jsonb(x)order by to_jsonb(x)::text)from public.newar_detail_records x),'jobs',(select jsonb_agg(to_jsonb(x)order by to_jsonb(x)::text)from private.withdraw_prepared_jobs x),'artifacts',(select jsonb_agg(to_jsonb(x)order by to_jsonb(x)::text)from private.withdraw_prepared_artifacts x),'heads',(select jsonb_agg(to_jsonb(x)order by to_jsonb(x)::text)from private.withdraw_prepared_heads x))v");
test('whole pack installs, repeats and rolls back with exact metadata and unchanged source/financial/queue state',async()=>{
 const db=await setup();try{const before=await metadata(db),source=await sourceSnapshot(db),prior=await tokens(db);assert.equal(beforeDefs.length,2);assert.equal(afterDefs.length,2);
 for(const row of(await db.query(sql('preflight'))).rows){assert.equal(row.state,'before');assert.equal(row.metadata_matches,true);}
 await db.exec(install);const installed=await metadata(db),next=await tokens(db);assert.notEqual(next.reason,prior.reason);assert.deepEqual({...next,reason:null},{...prior,reason:null});
 for(let i=0;i<before.length;i++)assert.deepEqual({...installed[i].metadata,prosrc:null},{...before[i].metadata,prosrc:null});
 for(const row of(await db.query(sql('postflight'))).rows){assert.equal(row.state,'installed');assert.equal(row.metadata_matches,true);}
 await db.exec(install);assert.deepEqual(await metadata(db),installed);assert.deepEqual(await sourceSnapshot(db),source);
 for(const spec of specs)for(const role of['anon','authenticated','service_role'])assert.equal(await scalar(db,"select has_function_privilege($1,$2,'execute')v",[role,spec.signature]),false);
 await db.exec(rollback);assert.deepEqual(await metadata(db),before);assert.deepEqual(await tokens(db),prior);assert.deepEqual(await sourceSnapshot(db),source);await db.exec(rollback);assert.deepEqual(await metadata(db),before);
 }finally{await db.close();}
});
test('partial install and partial rollback refuse mixed definitions without any change',async()=>{
 for(const index of[0,1]){const db=await setup();try{await db.exec(afterDefs[index]);const mixed=await metadata(db);for(const action of[install,rollback]){await assert.rejects(db.exec(action),/reason_format_definition_drift/);await db.exec('rollback');assert.deepEqual(await metadata(db),mixed);}}finally{await db.close();}}
});
test('ACL, security, cost and body drift refuse install without changing either helper',async()=>{
 for(const [index,drift]of[[0,'acl'],[1,'cost'],[0,'security'],[1,'body']]){const db=await setup();try{const sig=specs[index].signature;
 if(drift==='acl')await db.exec('grant execute on function '+sig+'to anon');else if(drift==='cost')await db.exec('alter function '+sig+'cost 101');else if(drift==='security')await db.exec('alter function '+sig+'security definer');else await db.exec(beforeDefs[index].replace('AS $function$','AS $function$\n -- synthetic drift'));
 const before=await metadata(db);await assert.rejects(db.exec(install),/reason_format_(metadata|definition)_drift/);await db.exec('rollback');assert.deepEqual(await metadata(db),before);
 }finally{await db.close();}}
});
test('installed drift blocks rollback and non-owner cannot install',async()=>{
 for(const kind of['metadata','body']){const db=await setup();try{await db.exec(install);if(kind==='metadata')await db.exec('alter function '+specs[1].signature+'cost 101');else await db.exec(afterDefs[0].replace('AS $function$','AS $function$\n -- synthetic drift'));const before=await metadata(db);await assert.rejects(db.exec(rollback),/reason_format_(metadata|definition)_drift/);await db.exec('rollback');assert.deepEqual(await metadata(db),before);}finally{await db.close();}}
 const db=await setup();try{const before=await metadata(db);await db.exec('create role synthetic_operator;set role synthetic_operator');await assert.rejects(db.exec(install),/reason_format_owner_only/);await db.exec('rollback;reset role');assert.deepEqual(await metadata(db),before);}finally{await db.close();}
});
test('mid-pack failure and unexpected financial dependency changes atomically roll back both replacements',async()=>{
 for(const mode of['midpack','financial']){const db=await setup();try{const before=await metadata(db),prior=await tokens(db);let changed;
 if(mode==='midpack'){const first=install.indexOf(' EXECUTE $definition$'),second=install.indexOf(' EXECUTE $definition$',first+1);changed=install.slice(0,second)+" RAISE EXCEPTION 'synthetic_midpack_failure';\n"+install.slice(second);}
 else changed=install.replace(' IF finance_before IS DISTINCT FROM '," EXECUTE 'create function private.dashboard_admin_wg_synthetic()returns int language sql as ''select 1''';\n IF finance_before IS DISTINCT FROM ");
 await assert.rejects(db.exec(changed),mode==='midpack'?/synthetic_midpack_failure/:/reason_format_financial_dependency_changed/);await db.exec('rollback');assert.deepEqual(await metadata(db),before);assert.deepEqual(await tokens(db),prior);assert.equal(await scalar(db,"select to_regprocedure('private.dashboard_admin_wg_synthetic()')v"),null);
 }finally{await db.close();}}
});
test('variable measurements retain rule identities while combinations and unknown text stay distinct',async()=>{
 const db=await setup();try{await db.exec(install);const members=n=>scalar(db,"select private.dashboard_admin_live_blocking_members(private.dashboard_admin_live_blocking_core($1),'newar','present')v",[n]);
 const prefix='16.没有可用提现通道,本单出款金额',a=await members(prefix+'17.25'),b=await members(prefix+'42');assert.equal(a.length,1);assert.equal(a[0].reasonKey,b[0].reasonKey);assert.equal(a[0].reason,'没有可用提现通道');assert.equal(a[0].details.actualValue,'17.25');assert.equal(a[0].details.actualField,'本单出款金额');assert.equal((await members(prefix+'17.25U'))[0].details.actualField,'本单出款金额（U）');
 const combo='8.累计提款次数0小于配置2次;12.总打码倍数1.25(有效投注125/总充值100)小于配置3;'+prefix+'17.25',m=await members(combo);assert.equal(m.length,3);assert(m.every(x=>!x.reason.includes(';')));assert.equal((await members(prefix+'17.25;'+prefix+'42')).length,1);
 assert.equal((await members('2.配置不允许非法定货币自动出款,本单U数量7.5;14.USDT-BEP20 无可用适配通道')).length,2);
 const profits=await members('22.当日盈利[已移除号码]大于配置19;11.总盈利[已移除号码]大于等于配置23');assert.equal(profits.length,2);assert.notEqual(profits[0].reasonKey,profits[1].reasonKey);assert(profits.every(x=>x.details.actualValue===null));
 for(const note of[prefix+'-17',prefix+'17INR',prefix+'17,unknown rule 42','14.USDT-BEP21 无可用适配通道'])assert((await members(note)).some(x=>x.reason===note));
 }finally{await db.close();}
});
test('new core index is valid; resealing malformed structure, member keys or count totals cannot make them valid',async()=>{
 const db=await setup();try{await db.exec(install);await db.exec(beforeDefs[1].replace('private.withdraw_reason_newar_index_valid(','private.synthetic_baseline_index_valid('));
 const p=await scalar(db,`with m as(select private.dashboard_admin_live_blocking_members(private.dashboard_admin_live_blocking_core('8.累计提款次数0小于配置2次;16.没有可用提现通道,本单出款金额17.25'),'newar','present')v),i as(select jsonb_build_array(jsonb_build_array('Synthetic label','Synthetic label','present',v,'{}'::jsonb,1,1,0,0))v from m),g as(select jsonb_agg(jsonb_build_object('reason',x->>'reason','reasonKey',x->>'reasonKey','noteState','present','count',1,'success',1,'rejected',0,'other',0))v from m cross join lateral jsonb_array_elements(v)x)select jsonb_build_object('available',true,'reasonGrouping','atomic_rules_v1','noteCount',1,'rows',g.v,'summary',jsonb_build_object('ruleMembership',jsonb_build_object('unit','distinct_order_per_rule','overlapping',true,'hitCount',2)),'_newarLabelIndex',jsonb_build_object('format','newar-label-index-v2','rows',i.v,'integrity',md5(jsonb_build_array('newar-label-index-v2',i.v)::text)))v from i,g`);
 const check=async p=>(await db.query('select private.synthetic_baseline_index_valid($1) old,private.withdraw_reason_newar_index_valid($1) new',[p])).rows[0];assert.deepEqual(await check(p),{old:true,new:true});
 for(const change of[x=>x._newarLabelIndex.rows[0]=null,x=>x._newarLabelIndex.rows[0].pop(),x=>x._newarLabelIndex.rows[0][3]={},x=>x._newarLabelIndex.rows[0][3][0]=null,x=>x._newarLabelIndex.rows[0][3][0].details=[],x=>x._newarLabelIndex.rows[0][3][0].reasonKey='bad',x=>x._newarLabelIndex.rows[0][3].push(x._newarLabelIndex.rows[0][3][0]),x=>x._newarLabelIndex.rows[0][5]='1',x=>x._newarLabelIndex.rows[0][5]=2,x=>x.rows[0].count=2,x=>x.summary.ruleMembership.hitCount=3]){let x=structuredClone(p);change(x);x=await scalar(db,"select jsonb_set($1::jsonb,'{_newarLabelIndex,integrity}',to_jsonb(md5(jsonb_build_array('newar-label-index-v2',$1::jsonb->'_newarLabelIndex'->'rows')::text)))v",[x]);assert.deepEqual(await check(x),{old:false,new:false});}
 }finally{await db.close();}
});
