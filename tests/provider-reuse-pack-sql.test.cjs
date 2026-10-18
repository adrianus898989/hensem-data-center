// Existing SQL projection is the financial oracle; only synthetic facts are used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{PGlite}=require('@electric-sql/pglite');let db;
const q=(patch={})=>({action:'aggregate',view:'providers',platformId:'10000000-0000-4000-8000-000000000001',startAt:'2026-10-10T18:30:00Z',endAt:'2026-10-17T18:30:00Z',successStartAt:'2026-10-10T18:30:00Z',successEndAt:'2026-10-17T18:30:00Z',successBasis:'success',direction:'all',status:'all',currency:'INR',offset:0,limit:20,...patch});
const P={id:q().platformId,source:'ar',sourceName:'SYNTHETIC',country:'印度',timezone:'Asia/Kolkata',currency:'INR'};
const row=(provider,direction='charge',patch={})=>({provider,direction,currency:'INR',all_count:2,success_count:1,pending_count:1,failed_count:0,rejected_count:0,unknown_count:0,missing_amount_count:0,negative_amount_count:0,created_success_count:1,all_amount:'9007199254740993.0000000000001',success_amount:null,pending_amount:'0.0000000000009',failed_amount:'0',rejected_amount:'0',unknown_amount:'0',created_success_amount:'3.25',unique_member_count:7,fee_items:[{amount:null,provider}],provider_names:[provider],...patch});
const payload=()=>({version:1,platform:P,basis:'mixed_created_success',asOf:'2026-10-18T00:00:00Z',startAt:q().startAt,endAt:q().endAt,successStartAt:q().successStartAt,successEndAt:q().successEndAt,successBasis:'success',total:33,summary:[row(null)],groups:{provider:[row('native-A'),row('BrandB'),row('TukPay'),row('TukPay','withdraw'),row('NewWinPay')].filter(r=>typeof r.direction==='string')},rows:[],latencySummary:[],pendingSummary:[],coverage:{complete:false,sourceComplete:false},capabilities:{success:true}});
const publication={kind:'daily_provider_rollup',calculationComplete:true,sourceComplete:false,freshness:'refresh_due'};
async function pack(p=payload(),request=q({direction:'charge',providers:['native-A']}),pub=publication){return(await db.query('select private.daily_provider_base_reuse_pack($1,$2,$3,$4,$5) p',[JSON.stringify(p),JSON.stringify(q()),JSON.stringify(request),JSON.stringify(P),JSON.stringify(pub)])).rows[0].p;}
async function original(p,request){return(await db.query('select private.prepared_aggregate_echo(private.dashboard_prepared_provider_projection($1,$2,$3),$3,$4) r',[JSON.stringify(p),JSON.stringify(q()),JSON.stringify(request),JSON.stringify(P)])).rows[0].r;}
function materialize(p,names){const indexes=names.length?[...new Set(names.map(n=>new Map(p.names).get(n)))]:[p.all];assert.equal(indexes.length,1);const e=p.entries[indexes[0]];return{...p.base,...e.result,groups:{provider:e.indices.map(i=>p.providers[i])}};}
test.before(async()=>{db=new PGlite();await db.exec('create schema private;create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/admin-live-provider-aliases.sql'),'utf8'));await db.exec(`create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create table private.fixture_wg(country_code text,country text,platform text,raw_provider text,canonical_provider text);
 create function private.dashboard_admin_wg_provider_aliases()returns setof private.fixture_wg language sql stable as $$select *from private.fixture_wg$$;
 create function private.dashboard_admin_live_confirmed_provider(country text,platform text,raw text)returns text language sql stable as $$select case when raw='ConfirmedRaw'then'ConfirmedPay'end$$;
 create function private.dashboard_admin_live_provider_alias_values(country text,vals text[])returns text[]language sql stable as $$select array_agg(distinct private.dashboard_admin_live_provider_alias(country,x))from unnest(vals)x$$;
 insert into private.dashboard_admin_provider_registry values('印度','SYNTHETIC','native-A',array['native-A']),('印度','SYNTHETIC','BrandB',array['BrandB']),('印度','SYNTHETIC','ShadowPay',array['ShadowPay']);
 insert into private.dashboard_admin_provider_overrides values('印度','SYNTHETIC','native-A','BrandB'),('印度','SYNTHETIC','BrandB','BrandC'),('印度','SYNTHETIC','ShadowPay','BrandC');`);await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/provider-canonical-current.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/admin-prepared-provider-projection.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/provider-echo-current.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/maintenance/daily-provider-reuse-pack.sql'),'utf8').split('-- BEGIN compact projection helper\n')[1].split('-- END compact projection helper')[0]);});
test.after(async()=>{await db?.close();});
test('server compact entries reconstruct whole original financial DTO including non-idempotent native alias chains',async()=>{
 const p=payload(),r=await pack(p);assert(r);for(const names of [['native-A'],['BrandB'],['TukPay'],[]])assert.deepEqual(materialize(r,names),await original(p,q({direction:'charge',...(names.length?{providers:names}:{})})),names.join(','));
 assert.equal(materialize(r,['native-A']).summary[0].all_amount,'9007199254740993.0000000000001');assert.equal(materialize(r,['native-A']).summary[0].success_amount,null);assert.equal(materialize(r,['native-A']).summary[0].unique_member_count,undefined);
 assert.notDeepEqual(materialize(r,['native-A']).groups.provider,materialize(r,['BrandB']).groups.provider);
});
test('withdraw direction, aliases, null/missing contributors and fee evidence preserve SQL semantics',async()=>{
 const p=payload();p.groups.provider.push(row('TukPay-QR','withdraw',{success_count:null,all_amount:null,fee_items:[{rate:null}]}));const names=['TukPay','TukPay-QR'];const r=await pack(p,q({direction:'withdraw',providers:names}));assert(r);assert.deepEqual(materialize(r,names),await original(p,q({direction:'withdraw',providers:names})));assert.equal(materialize(r,names).summary[0].all_amount,null);
});
test('source collection uncertainty and current refresh-due clocks remain unchanged, last-complete/non-ready opt out',async()=>{
 const p=payload();assert.deepEqual(materialize(await pack(p),['TukPay']).coverage,p.coverage);for(const pub of [{...publication,servedLastComplete:true},{...publication,calculationComplete:false},{...publication,kind:'other'}])assert.equal(await pack(p,q({direction:'charge'}),pub),null);
});
test('hard row/name caps omit the entire optional package and never truncate the original payload',async()=>{
 const p=payload();p.groups.provider=Array.from({length:257},(_,i)=>row('Synthetic'+i));const before=JSON.stringify(p);assert.equal(await pack(p),null);assert.equal(JSON.stringify(p),before);
 const tooMany=payload();tooMany.groups.provider[0].provider_names=Array.from({length:201},(_,i)=>'Name'+i);assert.equal(await pack(tooMany),null);
});
test('a large evidence block omits optional bytes and an over-budget canonical pass omits the whole package',async()=>{
 const p=payload();p.sourceEvidence='x'.repeat(1100000);assert.equal(await pack(p),null);
 const before=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_provider_alias(text,text)'::regprocedure)d")).rows[0].d;
 await db.exec(`create or replace function private.dashboard_admin_live_provider_alias(p_country text,p_name text)returns text language plpgsql immutable as $$begin perform pg_sleep(0.27);return p_name;end$$;`);
 try{assert.equal(await pack(),null);}finally{await db.exec(before);}
});
test('custom order selectors and missing direction never enter the optional projection path',async()=>{assert.equal(await pack(payload(),q({direction:'charge',orderNumber:'SYNTHETIC'})),null);const request=q();delete request.direction;assert.equal(await pack(payload(),request),null);});

test('visible zero-order and native-override names are resolved on the server before any browser reuse',async()=>{
 const p=payload(),request=q({direction:'charge',providers:['native-A'],providerReuseNames:['AbsentPay','ShadowPay']});const result=await pack(p,request);assert(result);for(const name of ['AbsentPay','ShadowPay'])assert.deepEqual(materialize(result,[name]),await original(p,q({direction:'charge',providers:[name]})));assert.equal(materialize(result,['AbsentPay']).total,0);assert.equal(materialize(result,['ShadowPay']).groups.provider[0].provider,'BrandB');assert.equal(result.scope.providerReuseNames,undefined);
});

test('batch lookup keeps unknown, null and whitespace raw identities distinct while matching the same original registry key',async()=>{
 await db.exec(`insert into private.dashboard_admin_provider_registry values('印度','SYNTHETIC','',array['BlankPay']),('印度','SYNTHETIC','MixedRaw',array['OnePay','TwoPay']),('印度','SYNTHETIC','EmptyRaw','{}');`);
 try{const p=payload();p.groups.provider=[row(null),row(''),row('未识别通道'),row(' MixedRaw '),row('EmptyRaw')];const r=await pack(p,q({direction:'charge',providers:['未识别通道'],providerReuseNames:['MixedRaw',' MixedRaw ','EmptyRaw']}));assert(r);for(const name of ['未识别通道','MixedRaw',' MixedRaw ','EmptyRaw']){const actual=materialize(r,[name]),expected=await original(p,q({direction:'charge',providers:[name]}));assert.deepEqual(actual,expected,name);assert.equal((await db.query('select $1::jsonb::text=$2::jsonb::text same',[JSON.stringify(actual),JSON.stringify(expected)])).rows[0].same,true,name);}}
 finally{await db.exec("delete from private.dashboard_admin_provider_registry where raw_provider in('','MixedRaw','EmptyRaw')");}
});

test('WG precedence and its exact country override agree with the original scalar despite an existing registry candidate',async()=>{
 await db.exec(`insert into private.fixture_wg values('VN','越南','WG-SYNTHETIC','WGRaw','WGPay');insert into private.dashboard_admin_provider_registry values('越南','WG-SYNTHETIC','WGRaw',array['RegistryPay']);`);
 try{const p=payload();p.platform={...p.platform,country:'VN',sourceName:'WG-SYNTHETIC'};p.groups.provider=[row('WGRaw')];let r=await pack(p,q({direction:'charge',providers:['WGRaw']}));assert(r);assert.deepEqual(materialize(r,['WGRaw']),await original(p,q({direction:'charge',providers:['WGRaw']})));
 await db.exec("insert into private.dashboard_admin_provider_overrides values('越南','WG-SYNTHETIC','WGRaw','ManualWGPay')");r=await pack(p,q({direction:'charge',providers:['WGRaw']}));assert(r);assert.deepEqual(materialize(r,['WGRaw']),await original(p,q({direction:'charge',providers:['WGRaw']})));
 }finally{await db.exec("delete from private.fixture_wg;delete from private.dashboard_admin_provider_registry where platform='WG-SYNTHETIC';delete from private.dashboard_admin_provider_overrides where platform='WG-SYNTHETIC'");}
});

test('YASH WinPay takes its original one-step special case and exact-country override before conflicting registry data',async()=>{
 await db.exec(`insert into private.dashboard_admin_provider_registry values('IN','YASH.BET','WinPay',array['WrongRegistryPay']);insert into private.dashboard_admin_provider_overrides values('印度','YASH.BET','WinPay','OtherCountryPay');`);
 try{const p=payload();p.platform={...p.platform,country:'IN',sourceName:'YASH.BET'};p.groups.provider=[row('WinPay'),row('NewWinPay')];let r=await pack(p,q({direction:'charge',providers:['WinPay']}));assert(r);assert.deepEqual(materialize(r,['WinPay']),await original(p,q({direction:'charge',providers:['WinPay']})));
 await db.exec("insert into private.dashboard_admin_provider_overrides values('IN','YASH.BET','WinPay','ManualYashPay')");r=await pack(p,q({direction:'charge',providers:['WinPay']}));assert(r);assert.deepEqual(materialize(r,['WinPay']),await original(p,q({direction:'charge',providers:['WinPay']})));
 }finally{await db.exec("delete from private.dashboard_admin_provider_registry where platform='YASH.BET';delete from private.dashboard_admin_provider_overrides where platform='YASH.BET'");}
});

test('an ambiguous WG scalar mapping still raises cardinality violation instead of choosing a winner',async()=>{
 await db.exec(`insert into private.fixture_wg values('VN','越南','WG-DUP','WGRaw','OnePay'),('VN','越南','WG-DUP','WGRaw','TwoPay');`);
 try{const p=payload();p.platform={...p.platform,country:'越南',sourceName:'WG-DUP'};p.groups.provider=[row('WGRaw')];await assert.rejects(pack(p,q({direction:'charge',providers:['WGRaw']})),e=>e.code==='21000');await assert.rejects(original(p,q({direction:'charge',providers:['WGRaw']})),e=>e.code==='21000');}
 finally{await db.exec('delete from private.fixture_wg');}
});

test('empty-leaf projection without a sentinel is whole JSON and text equal to the original sentinel projection',async()=>{
 const p=payload();p.groups.provider=[];for(const direction of ['charge','withdraw']){const plain=await original(p,q({direction})),sentinel=await original(p,q({direction,providers:['__provider_reuse_empty__']}));assert.deepEqual(plain,sentinel);assert.equal(JSON.stringify(plain),JSON.stringify(sentinel));const r=await pack(p,q({direction,providers:['AbsentPay'],providerReuseNames:['AbsentPay']}));assert(r);assert.deepEqual(materialize(r,['AbsentPay']),sentinel);}
});

test('changed native overrides affect the next bounded package immediately and runtime resolver source drift omits the optional package',async()=>{
 const p=payload();const before=await pack(p);await db.exec("update private.dashboard_admin_provider_overrides set canonical_provider='ChangedPay'where raw_provider='native-A'");
 try{const after=await pack(p);assert(after);assert.notDeepEqual(after.names,before.names);assert.deepEqual(materialize(after,['native-A']),await original(p,q({direction:'charge',providers:['native-A']})));}finally{await db.exec("update private.dashboard_admin_provider_overrides set canonical_provider='BrandB'where raw_provider='native-A'");}
 const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure)d")).rows[0].d;
 try{await db.exec(definition.replace(' select case',' -- deliberate source drift\n select case'));assert.equal(await pack(),null);}finally{await db.exec(definition);}
});

// Compare inside PostgreSQL before JSON numbers pass through JavaScript. Counts
// beyond Number.MAX_SAFE_INTEGER and NUMERIC string scales stay exact here.
async function exactSqlEntries(p,names=['native-A','BrandB','TukPay','AbsentPay',null],direction='charge'){
 const request=q({direction,providers:['native-A'],providerReuseNames:names.filter(n=>n!==null)});
 const answer=(await db.query(`with pack as materialized(select private.daily_provider_base_reuse_pack($1,$2,$3,$4,$5)p),
 targets as materialized(select name,case when name is null then($3::jsonb-array['providers','providerReuseNames'])else($3::jsonb-'providerReuseNames')||jsonb_build_object('providers',jsonb_build_array(name))end q from jsonb_array_elements_text($6::jsonb)n(name)),
 located as materialized(select p,t.name,t.q,case when t.name is null then(p->>'all')::integer else(select(m->>1)::integer from jsonb_array_elements(p->'names')m where m->>0=t.name)end idx from pack cross join targets t),
 reconstructed as materialized(select name,q,(p->'base')||(p->'entries'->idx->'result')||jsonb_build_object('groups',jsonb_build_object('provider',(select coalesce(jsonb_agg(p->'providers'->(i.value::text)::integer order by i.n),'[]')from jsonb_array_elements(p->'entries'->idx->'indices')with ordinality i(value,n))))v from located),
 oracle as materialized(select r.name,r.v,private.prepared_aggregate_echo(private.dashboard_prepared_provider_projection($1,$2,r.q),r.q,$4)o from reconstructed r)
 select(select p is not null from pack)pack_present,bool_and(v=o and v::text=o::text)all_exact,count(*)::integer comparisons from oracle`,[JSON.stringify(p),JSON.stringify(q()),JSON.stringify(request),JSON.stringify(P),JSON.stringify(publication),JSON.stringify(names)])).rows[0];
 assert.equal(answer.pack_present,true);assert.equal(answer.comparisons,names.length);assert.equal(answer.all_exact,true);
}

test('batch count field presence and invalid contributors match all original SQL summaries including huge integer totals',async()=>{
 const keys=['all_count','success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','negative_amount_count','created_success_count','reviewed_pending_count'];
 for(const key of keys)for(const value of [null,'00003','2.0','900719925474099312345678901234567890']){const p=payload();p.groups.provider[0][key]=value;await exactSqlEntries(p);}
 const p=payload();for(const r of p.groups.provider){delete r.all_count;delete r.reviewed_pending_count;}p.summary=[{all_count:null,reviewed_pending_count:99}];await exactSqlEntries(p);
});

test('batch money fields preserve decimal text scale, exponents, nulls, malformed unknowns and optional presence per original SQL',async()=>{
 const keys=['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','created_success_amount','reviewed_pending_amount'];
 for(const key of keys)for(const value of [null,'-0.0000000000000000000000001','+001.230000','123.','3e-19',{malformed:true}]){const p=payload();p.groups.provider[0][key]=value;p.groups.provider[1][key]='9007199254740993.00000000000000000019';await exactSqlEntries(p);}
});

test('batch evidence presence and JSON null semantics match original SQL for every retained label',async()=>{
 const keys=['success_time_available','success_time_basis','success_available','success_unavailable_reason','fee_available','fee_unavailable_reason','pending_count_available'];
 for(const key of keys)for(const value of [null,false,'known',{proof:'same'}]){const p=payload();p.groups.provider[0][key]=value;p.groups.provider[1][key]=value;await exactSqlEntries(p);p.groups.provider[1][key]='different';await exactSqlEntries(p);delete p.groups.provider[1][key];await exactSqlEntries(p);}
});

test('batch currency buckets distinguish missing SQL NULL from JSON null and preserve original provider leaf order',async()=>{
 const p=payload();p.groups.provider=[row('TukPay','charge',{currency:'USD'}),row('TukPay','charge',{currency:null}),row('TukPay','charge'),row('TukPay','charge')];delete p.groups.provider[3].currency;await exactSqlEntries(p,['TukPay',null]);p.groups.provider.reverse();await exactSqlEntries(p,['TukPay',null]);
});

test('batch latest timestamp keeps exact original text and omits ambiguous equal-instant spellings',async()=>{
 const p=payload();p.groups.provider=[row('TukPay','charge',{latest_synced_at:'2026-10-10T00:00:00Z'}),row('TukPay','charge',{latest_synced_at:'2026-10-10T00:00:00Z'}),row('TukPay','charge',{latest_synced_at:null}),row('TukPay','withdraw',{latest_synced_at:'2026-10-11T00:00:00Z'})];await exactSqlEntries(p,['TukPay',null]);p.groups.provider.reverse();await exactSqlEntries(p,['TukPay',null]);await exactSqlEntries(p,['TukPay',null],'withdraw');
 p.groups.provider.find(r=>r.direction==='charge'&&r.latest_synced_at).latest_synced_at='2026-10-10T05:30:00+05:30';assert.equal(await pack(p),null);
 // Ambiguity below the latest instant cannot affect the selected source text.
 p.groups.provider.push(row('TukPay','charge',{latest_synced_at:'2026-10-12T00:00:00Z'}));await exactSqlEntries(p,['TukPay',null]);
});

test('batch hasMore preserves original projection field/cast contract and final echo override',async()=>{
 const variants=[{}, {hasMore:false}, {hasMore:null,offset:null,limit:null}, {hasMore:true,offset:'4',limit:'1'}, {hasMore:true,offset:'9223372036854775780',limit:'20'}, {hasMore:false,offset:'9223372036854775807',limit:'0'}, {hasMore:false,offset:'-9223372036854775808',limit:'0'}];
 for(const extra of variants){const p=payload();Object.assign(p,extra);await exactSqlEntries(p);}
 for(const extra of [{offset:'not-an-integer',limit:'1'},{offset:'9223372036854775808',limit:'1'},{offset:'9223372036854775807',limit:'1'},{offset:'0',limit:'1.5'}]){
  const p=payload();Object.assign(p,{hasMore:false,...extra});let code;try{await original(p,q({direction:'charge',providers:['native-A']}));}catch(e){code=e.code;}assert(code);await assert.rejects(pack(p),e=>e.code===code);
  // Without the original hasMore key the intermediate bigint casts never run;
  // final echo uses the valid request integer fields instead.
  delete p.hasMore;await exactSqlEntries(p);
 }
});

test('batch original projection validation and selected timestamp errors retain original SQLSTATE instead of producing statistics',async()=>{
 for(const change of [p=>{p.groups.provider[0].direction='bad'},p=>{p.startAt='not-a-date'},p=>{p.summary={}},p=>{p.partial=false},p=>{p.groups.provider[0].latest_synced_at='not-a-date'}]){const p=payload();change(p);let expected;try{await original(p,q({direction:'charge'}));}catch(e){expected=e.code;}assert(expected);await assert.rejects(pack(p),e=>e.code===expected);}
});
