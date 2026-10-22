// Native SQL engine behavior against synthetic orders; no production access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');let db,native,f;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const migration=read('supabase/migrations/20261015141000_exact_prepared_aggregates.sql');
const part=name=>migration.split('-- BEGIN '+name+'\n')[1].split('-- END '+name)[0];
before(async()=>{
 const filename=path.join(__dirname,'fee-channel-category.test.cjs');let setup;
 const c=vm.createContext({require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:createRequire(filename)(n),__dirname,process,console,structuredClone});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.h={get db(){return db},get native(){return native},get f(){return f}};',c,{filename});await setup();({db,native,f}=c.h);
 await db.exec('alter table ar_collected_orders add column money_format_version smallint,add column amount_local numeric,add column currency_local text,add column money_issue_code text;create table private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active boolean);alter table newar_detail_records add column source_updated_at timestamptz;');
 await db.exec(read('tests/fixtures/admin-live-ar-amount-inline-production.sql'));
 await db.exec(part('helpers'));await db.exec(part('kernel'));
 for(const name of ['prepared_aggregate_request_reason','prepared_aggregate_secondary_reason','prepared_aggregate_canonical_request','prepared_aggregate_raw_kernel'])await db.exec(read('supabase/created-cohort/'+name+'.sql')); 
 // Decoration is independent from native cohort SQL and is identity in this
 // clock-only fixture. Provider/result suites exercise the real wrapper.
 await db.exec(`create or replace function private.dashboard_admin_order_business_result(j jsonb,text,text,text,uuid)returns jsonb language sql immutable as $$select j$$;`);
});
after(()=>db?.close());
const target=async(source)=>scalar('select to_jsonb(p)from private.dashboard_admin_live_platforms()p where p.id=$1',[native.request(source).platformId]);
const query=async(source,extra={})=>scalar('select private.prepared_aggregate_raw_kernel($1,$2)',[JSON.stringify(native.request(source,{view:'providers',...extra})),JSON.stringify([await target(source)])]);
function normalized(x){const y=structuredClone(x);for(const k of ['successStartAt','successEndAt','successBasis','asOf'])delete y[k];return y;}

for(const source of ['ar','newar','lg','game66'])for(const view of ['providers','full'])test(source+'/'+view+' creation status cohort includes late-paid and unknown-clock amounts, excludes prior creations',async()=>{
 await db.exec('begin');try{
 const table={ar:'ar_collected_orders',newar:'newar_detail_records',lg:'lg_orders',game66:'game66_charge_orders'}[source];
 await db.exec('delete from '+table);
 await native.add(source,'charge','CREATED_LATE',100.25,{created:'2026-09-19 02:00',success:'2026-09-21 01:00'});
 await native.add(source,'charge','OLD_CREATED',200.75,{created:'2026-09-17 02:00',success:'2026-09-19 02:00'});
 await native.add(source,'charge','CREATED_MISSING_CLOCK',300.50,{created:'2026-09-19 03:00',success:'2026-09-19 04:00'});
 const nullSQL={ar:"update ar_collected_orders set completed_at=null where order_no='CREATED_MISSING_CLOCK'",newar:"update newar_detail_records set success_at=null where order_number='CREATED_MISSING_CLOCK'",lg:"update lg_orders set paid_at=null where order_no='CREATED_MISSING_CLOCK'",game66:"update game66_charge_orders set pay_time=null where order_num='CREATED_MISSING_CLOCK'"}[source];await db.exec(nullSQL);
 const r=await query(source,{view,direction:'charge',successBasis:'created'}),s=r.summary.find(x=>x.direction==='charge');
 assert.equal(s.all_count,2);assert.equal(s.success_count,2);assert.equal(Number(s.all_amount),400.75);assert.equal(Number(s.success_amount),400.75);assert.equal(Number(s.created_success_amount),400.75);assert.equal(s.created_success_count,2);
 assert.equal(r.successBasis,'created');assert.equal(Object.hasOwn(r,'successStartAt'),false);assert.equal(Object.hasOwn(r,'successEndAt'),false);assert.equal(r.capabilities.successCohort,'created_at_current_stored_status');assert.equal(r.capabilities.independentSuccessWindow,false);
 assert.equal(r.groups.provider.reduce((v,x)=>v+Number(x.success_amount),0),400.75);assert.equal(r.groups.provider.reduce((v,x)=>v+x.success_count,0),2);
 if(view==='full'){for(const name of ['daily','hourly','amount','matrix']){assert.equal(r.groups[name].reduce((v,x)=>v+Number(x.success_amount),0),400.75,name);assert.equal(r.groups[name].reduce((v,x)=>v+x.success_count,0),2,name);}assert.equal(r.latencySummary[0].valid_count,1);assert.equal(r.latencySummary[0].mean_ms,169200000);}
 const manual=await query(source,{view,direction:'charge',successStartAt:'2026-09-19T00:00:00+05:30',successEndAt:'2026-09-20T00:00:00+05:30',successBasis:'success'});assert.equal(manual.summary[0].success_count,1);assert.equal(Number(manual.summary[0].success_amount),200.75);
 }finally{await db.exec('rollback');}
});
test('created canonical keeps no hidden secondary clock and differs from manual same dates',async()=>{
 const t=await target('ar'),q=native.request('ar',{view:'providers',successBasis:'created'});
 const canonical=async x=>scalar('select private.prepared_aggregate_canonical_request($1,$2)',[JSON.stringify(x),JSON.stringify(t)]);
 const c=await canonical(q);assert.equal(c.successBasis,'created');assert.equal(Object.hasOwn(c,'successStartAt'),false);assert.notDeepEqual(c,await canonical({...q,successBasis:'success',successStartAt:q.startAt,successEndAt:q.endAt}));
 assert.equal(await scalar('select private.prepared_aggregate_request_reason($1,$2)',[JSON.stringify(q),JSON.stringify(t)]),null);
 assert.equal(await scalar('select private.prepared_aggregate_request_reason($1,$2)',[JSON.stringify({...q,successStartAt:q.startAt,successEndAt:q.endAt}),JSON.stringify(t)]),'invalid_success_clock');
});
