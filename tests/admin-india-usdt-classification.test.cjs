// All fixtures are synthetic. No production connection, member or bank data.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const sql=name=>fs.readFileSync(path.join(root,'supabase',name),'utf8');
const names=loadTs(path.join(root,'src/lib/thirdPartyNameMap.ts'));
const volume=loadTs(path.join(root,'src/lib/parseThirdPartyVolume.ts'));
const browser={};browser.window=browser;
vm.runInNewContext(fs.readFileSync(path.join(root,'admin-preview/live-provider-aliases.js'),'utf8'),browser);
vm.runInNewContext(fs.readFileSync(path.join(root,'admin-preview/live-provider-summary.js'),'utf8'),browser);
const pairs=[['USDT(TRC20)-3','TronPayUSDT'],['USDT(TRC20)-4','UniPayUSDT'],['USDT(TRC20)-5','Wallet66'],['USDT(BEP20)-5','Wallet66'],['Wallet66-USDT','Wallet66']];
const id='10000000-0000-0000-0000-000000000001',hidden='10000000-0000-0000-0000-000000000002';
let db;
const canonical=async(country,platform,raw)=>(await db.query('select private.dashboard_admin_live_provider_canonical($1,$2,$3) value',[country,platform,raw])).rows[0].value;
const expand=async providers=>(await db.query('select private.dashboard_admin_live_expand_provider_filter($1::jsonb) value',[JSON.stringify({platformId:id,providers})])).rows[0].value.providers;
const options=async()=>(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) value',[JSON.stringify({platformIds:[id]})])).rows[0].value.providers;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[] default array['代收'],charge_count bigint default 1,withdraw_count bigint default 0,matched_count bigint default 1,last_data_date date default '2026-09-26',updated_at timestamptz default now(),primary key(country,platform,raw_provider));
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version bigint default 1,updated_at timestamptz default now(),primary key(country,platform,raw_provider));
 create table public.lg_success_daily(country_code text,platform text,stat_date date,third_party text,raw_channel text,scope_type text,order_kind text);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if current_setting('test.denied',true)='yes' then raise exception 'preview_denied';end if;return '{"countries":["印度"],"platforms":["SYNTHETIC"]}'::jsonb;end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select s->'countries' ? c and s->'platforms' ? p$$;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,country text,name text,source_name text,source text,scope_group text) language plpgsql stable as $$begin perform private.dashboard_admin_live_scope();return query select '${id}'::uuid,'印度'::text,'SYNTHETIC'::text,'SYNTHETIC'::text,'ar'::text,'IN'::text;end$$;
 create function private.dashboard_admin_live_provider_alias_values(p_country text,p_names text[]) returns text[] language sql stable as $$select coalesce(array_agg(distinct n order by n),'{}'::text[]) from unnest(p_names)n$$;
 `);
 for(const raw of [...pairs.map(p=>p[0]),'USDT'])for(const [country,platform]of[['印度','SYNTHETIC'],['巴西','SYNTHETIC'],['印度','HIDDEN']])await db.query('insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values) values($1,$2,$3,array[\'USDT\'])',[country,platform,raw]);
 await db.exec(sql('admin-live-india-usdt-classification.sql').replace(/-- BEGIN USDT LIVE BASELINE GUARD[\s\S]*?-- END USDT LIVE BASELINE GUARD/,''));
 const c=sql('admin-live-configuration.sql');await db.exec(c.slice(c.indexOf('create or replace function private.dashboard_admin_live_provider_alias_values('),c.indexOf('create or replace function private.dashboard_admin_live_provider_rows(')));
 const q=sql('admin-live-configuration-query.sql');await db.exec(q.slice(q.indexOf('create or replace function private.dashboard_admin_live_remap_groups('),q.indexOf('create or replace function private.dashboard_admin_live_expand_provider_filter(')));
});
after(async()=>db?.close());

test('the five confirmed raw names agree in TypeScript, generated browser aliases and SQL only inside India',async()=>{
 for(const country of ['印度','IN','India','香港','红膏蟹'])for(const [raw,expected]of pairs){
  assert.equal(names.canonicalThirdPartyName(raw,country),expected);
  assert.equal(browser.HensemProviderNames.canonical(raw,country),expected);
  assert.equal((await db.query('select private.dashboard_admin_live_provider_alias($1,$2) value',[country,raw])).rows[0].value,expected);
 }
 for(const country of ['巴西','印尼','尼日利亚','巴基斯坦','IN-extra',''])for(const [raw]of pairs){
  assert.equal(names.confirmedIndiaThirdPartyAlias(raw,country),'');
  assert.equal(browser.HensemProviderNames.canonical(raw,country),raw);
  assert.equal((await db.query('select private.dashboard_admin_live_confirmed_usdt_provider($1,$2) value',[country,raw])).rows[0].value,null);
 }
 for(const raw of ['USDT','USDT(TRC20)-6','USDT(TRC20)-30','USDT(BEP20)-4','Wallet66-USDT2'])assert.equal(browser.HensemProviderNames.canonical(raw,'印度'),raw);
 assert.equal(names.canonicalThirdPartyName('USDT-5','印度'),'AYPayUSDT','a different previously-confirmed raw identity is untouched');
});

test('stale generic registry rows are corrected without refreshing or changing the stored source classification',async()=>{
 for(const [raw,expected]of pairs)assert.equal(await canonical('印度','SYNTHETIC',raw),expected);
 assert.equal(await canonical('印度','SYNTHETIC','USDT'),'USDT');
 assert.equal(await canonical('巴西','SYNTHETIC','USDT(TRC20)-3'),'USDT');
 const rows=(await db.query('select * from private.dashboard_admin_live_provider_rows()')).rows;
 assert.equal(rows.length,6);for(const [raw,expected]of pairs){const r=rows.find(r=>r.raw_provider===raw);assert.equal(r.canonical_provider,expected);assert.deepEqual(r.canonical_values,[expected]);assert.equal(r.manual,false)}
 assert((await db.query('select canonical_values from private.dashboard_admin_provider_registry')).rows.every(r=>r.canonical_values.length===1&&r.canonical_values[0]==='USDT'));
 assert.deepEqual(await options(),['TronPayUSDT','USDT','UniPayUSDT','Wallet66']);
});

test('each canonical filter expands just its confirmed raw channels; bare USDT excludes all five',async()=>{
 assert.deepEqual(await expand(['TronPayUSDT']),['TronPayUSDT','USDT(TRC20)-3']);
 assert.deepEqual(await expand(['UniPayUSDT']),['USDT(TRC20)-4','UniPayUSDT']);
 assert.deepEqual(await expand(['Wallet66']),['USDT(BEP20)-5','USDT(TRC20)-5','Wallet66','Wallet66-USDT']);
 assert.deepEqual(await expand(['USDT']),['USDT']);
 const q={platformId:hidden,providers:['Wallet66']};assert.deepEqual((await db.query('select private.dashboard_admin_live_expand_provider_filter($1::jsonb) value',[JSON.stringify(q)])).rows[0].value,q);
});

test('server aggregation conserves counts and amounts, while details retain raw provider and type',async()=>{
 const base={currency:'INR',direction:'charge',date:'2026-09-26',all_amount:'100',all_count:2,success_amount:'80',success_count:1,created_success_count:1,pending_amount:'20',pending_count:1,failed_amount:'0',failed_count:0,rejected_amount:'0',rejected_count:0,unknown_amount:'0',unknown_count:0,missing_amount_count:0,negative_amount_count:0};
 const input=[...pairs.map(([provider])=>({...base,provider})),{...base,provider:'USDT'}];
 const result=(await db.query('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true) rows',[JSON.stringify(input),'印度','SYNTHETIC'])).rows[0].rows;
 assert.equal(result.length,4);assert.equal(result.reduce((s,r)=>s+r.success_count,0),6);assert.equal(result.reduce((s,r)=>s+Number(r.success_amount),0),480);
 const wallet=result.find(r=>r.provider==='Wallet66');assert.equal(wallet.success_count,3);assert.equal(Number(wallet.success_amount),240);
 const detail=[{provider:'USDT(TRC20)-3',raw_provider:'USDT(TRC20)-3',channel_type:'USDT',order_number:'SYNTHETIC-001',amount:80}];
 const mapped=(await db.query('select private.dashboard_admin_live_remap_rows($1::jsonb,$2,$3) rows',[JSON.stringify(detail),'印度','SYNTHETIC'])).rows[0].rows;
 assert.deepEqual(mapped,[{...detail[0],provider:'TronPayUSDT'}]);
 const again=(await db.query('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true) rows',[JSON.stringify(result),'印度','SYNTHETIC'])).rows[0].rows;assert.deepEqual(again,result);
});

test('manual platform override still wins consistently in classification, options and filter expansion',async()=>{
 await db.exec("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values('印度','SYNTHETIC','USDT(TRC20)-3','ReviewedPay')");
 try{assert.equal(await canonical('印度','SYNTHETIC','USDT(TRC20)-3'),'ReviewedPay');assert((await options()).includes('ReviewedPay'));assert(!(await options()).includes('TronPayUSDT'));assert.deepEqual(await expand(['TronPayUSDT']),['TronPayUSDT']);assert.deepEqual(await expand(['ReviewedPay']),['ReviewedPay','USDT(TRC20)-3']);}
 finally{await db.exec("delete from private.dashboard_admin_provider_overrides where country='印度' and platform='SYNTHETIC'")}
});

test('live scope denial remains enforced, and no anonymous/private helper privilege is introduced',async()=>{
 await db.exec("select set_config('test.denied','yes',false)");try{await assert.rejects(()=>options(),/preview_denied/);await assert.rejects(()=>expand(['Wallet66']),/preview_denied/);await assert.rejects(()=>db.query('select * from private.dashboard_admin_live_provider_rows()'),/preview_denied/)}finally{await db.exec("select set_config('test.denied','no',false)")}
 for(const role of ['anon','authenticated'])for(const signature of ['private.dashboard_admin_live_confirmed_usdt_provider(text,text)','private.dashboard_admin_live_provider_canonical(text,text,text)','private.dashboard_admin_live_provider_rows()'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') value',[role,signature])).rows[0].value,false);
});

test('the standalone patch is repeatable and never writes source data, overrides, fees or permissions',async()=>{
 const before=(await db.query('select to_jsonb(r) row from private.dashboard_admin_provider_registry r order by country,platform,raw_provider')).rows;
 await db.exec(sql('admin-live-india-usdt-classification.sql'));
 const after=(await db.query('select to_jsonb(r) row from private.dashboard_admin_provider_registry r order by country,platform,raw_provider')).rows;assert.deepEqual(after,before);
 assert.equal(await canonical('印度','SYNTHETIC','USDT(TRC20)-5'),'Wallet66');
 assert.doesNotMatch(sql('admin-live-india-usdt-classification.sql'),/\b(?:insert\s+into|update\s+(?:public|private)\.|delete\s+from|refresh\s+materialized|drop\s+)\b/i);
});

test('fee candidates stay separate and TRX source fees are not interpreted as INR estimates',()=>{
 const api=browser.HensemProviderSummary,rates=[{provider:'TronPayUSDT',country:'印度',scopeType:'country',collectFee:'1%'},{provider:'UniPayUSDT',country:'印度',scopeType:'country',collectFee:'2%'},{provider:'Wallet66',country:'印度',scopeType:'country',collectFee:'3%'}];
 for(const [raw,expected]of pairs){const order={provider:raw,country:'印度',currency:'INR',direction:'charge',success_amount:100,success_count:1};const candidates=api.feeCandidates(order,rates,'印度');assert.deepEqual(Array.from(candidates,r=>r.provider),[expected]);assert.equal(api.estimate(order,rates,'印度'),null,'current source rates cannot price orders without effective-version evidence')}
 const trx=rates.map(r=>({...r,country:'USDT通道',collectFee:'3TRX'}));assert.equal(api.estimate({provider:'Wallet66',currency:'INR',direction:'charge',success_amount:100,success_count:1},trx,'印度'),null);
 assert.equal(api.estimate({provider:'USDT',currency:'INR',direction:'charge',success_amount:100,success_count:1},rates,'印度'),null);
});


test('deployment guard refuses a newer helper instead of silently overwriting it',async()=>{
 const original=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_provider_options(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(original.replace('v_ids uuid[];', 'v_ids uuid[]; /* independently revised implementation */'));
 try{await assert.rejects(()=>db.exec(sql('admin-live-india-usdt-classification.sql')),/India USDT baseline changed/);}
 finally{await db.exec('rollback');await db.exec(original);}
});


test('explicit trailing business-type labels use the same India raw identity in every layer',async()=>{
 const raw='USDT(TRC20)-3 跑分';await db.query("insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values) values('印度','SYNTHETIC',$1,array['USDT'])",[raw]);
 try{for(const input of [raw,'USDT(TRC20)-3【唤醒】']){assert.equal(names.canonicalThirdPartyName(input,'印度'),'TronPayUSDT');assert.equal(browser.HensemProviderNames.canonical(input,'印度'),'TronPayUSDT');assert.equal((await db.query('select private.dashboard_admin_live_confirmed_usdt_provider($1,$2) value',['印度',input])).rows[0].value,'TronPayUSDT')}
 assert.equal(await canonical('印度','SYNTHETIC',raw),'TronPayUSDT');assert((await expand(['TronPayUSDT'])).includes(raw));assert(!(await expand(['USDT'])).includes(raw));
 assert.equal((await db.query('select private.dashboard_admin_live_confirmed_usdt_provider($1,$2) value',['印度','USDT(TRC20)-3 跑分服务'])).rows[0].value,null);
 }finally{await db.query("delete from private.dashboard_admin_provider_registry where country='印度' and platform='SYNTHETIC' and raw_provider=$1",[raw])}
});

test('old generic volume snapshots split by confirmed raw identity with totals and source alias evidence retained',()=>{
 const rows=[...pairs.map(([rawChannel],i)=>({id:'synthetic-'+i,sheetName:'synthetic',sourceRow:i+2,date:'2026-09-26',country:'印度',platform:'SYNTHETIC',channel:'USDT',rawChannel,channelType:'USDT',direction:'代收',amount:100,count:2,successCount:1,failedCount:1,successRate:0.5,status:''}))];
 const input={meta:{year:'2026',month:'9',source:'synthetic',updatedAt:'2026-09-26',sheets:['synthetic']},rows,aliasMap:{},summary:{},anomalies:[]},before=structuredClone(input),result=volume.normalizeThirdPartyVolumePayload(input);
 assert.deepEqual(input,before);assert.deepEqual(new Set(result.rows.map(r=>r.channel)),new Set(['TronPayUSDT','UniPayUSDT','Wallet66']));
 assert.equal(result.rows.reduce((n,r)=>n+r.amount,0),500);assert.equal(result.rows.reduce((n,r)=>n+r.count,0),10);assert.equal(result.rows.find(r=>r.channel==='Wallet66').count,6);
 for(const [raw,canonical]of pairs)assert(result.aliasMap[canonical].includes(raw));
 assert.deepEqual(volume.normalizeThirdPartyVolumePayload(result).rows,result.rows);
});
