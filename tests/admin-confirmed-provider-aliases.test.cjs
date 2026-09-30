// Synthetic database only. These fixtures never connect to production.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const sql=name=>fs.readFileSync(path.join(root,'supabase',name),'utf8');
const migration=sql('migrations/20260930223000_india_confirmed_provider_aliases.sql');
const names=loadTs(path.join(root,'src/lib/thirdPartyNameMap.ts'));
const volume=loadTs(path.join(root,'src/lib/parseThirdPartyVolume.ts'));
const browser={};browser.window=browser;
for(const file of ['live-provider-aliases.js','live-provider-summary.js'])vm.runInNewContext(fs.readFileSync(path.join(root,'admin-preview',file),'utf8'),browser);
const id='10000000-0000-0000-0000-000000000001',hidden='10000000-0000-0000-0000-000000000002';
const pairs=[['Wallet66','Wallet66','USDT'],['Wallet66-BSC','Wallet66','USDT'],['RushPay','RushPay','RushPay'],['Rushpay-Bank','RushPay','LegacyBank'],['BasePay-QR','FFPay','BasePay'],['FFPay','FFPay','FFPay']];
const part=(s,start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)+start.length));
const fn=(s,name)=>{const start=s.indexOf('create or replace function private.'+name+'('),rest=s.slice(start),tag=rest.match(/\bas\s+(\$[a-z_]*\$)/i)[1],end=rest.indexOf(tag+';',rest.indexOf(tag)+tag.length);assert(start>=0&&end>=0,name);return rest.slice(0,end+tag.length+1)};
let db,sourceBefore;
const canonical=async(country,platform,raw)=>(await db.query('select private.dashboard_admin_live_provider_canonical($1,$2,$3) value',[country,platform,raw])).rows[0].value;
const expand=async(providers,platformId=id)=>(await db.query('select private.dashboard_admin_live_expand_provider_filter($1::jsonb) value',[JSON.stringify({platformId,providers})])).rows[0].value;
const options=async direction=>(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) value',[JSON.stringify({platformIds:[id],direction})])).rows[0].value.providers;
const snapshot=async()=>(await db.query('select to_jsonb(r) value from private.dashboard_admin_provider_registry r order by country,platform,raw_provider')).rows;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[] default array['代收','代付'],charge_count bigint default 1,withdraw_count bigint default 1,matched_count bigint default 2,last_data_date date default '2026-09-29',updated_at timestamptz default now(),primary key(country,platform,raw_provider));
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version bigint default 1,updated_at timestamptz default now(),primary key(country,platform,raw_provider));
 create table public.lg_success_daily(country_code text,platform text,stat_date date,third_party text,raw_channel text,scope_type text,order_kind text);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if current_setting('test.denied',true)='yes' then raise exception 'preview_denied';end if;return '{"countries":["印度"],"platforms":["SYNTHETIC"]}'::jsonb;end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select s->'countries' ? c and s->'platforms' ? p$$;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,country text,name text,source_name text,source text,scope_group text) language plpgsql stable as $$begin perform private.dashboard_admin_live_scope();return query select '${id}'::uuid,'印度'::text,'SYNTHETIC'::text,'SYNTHETIC'::text,'ar'::text,'IN'::text;end$$;
 create function private.dashboard_admin_live_provider_alias_values(p_country text,p_names text[]) returns text[] language sql stable as $$select coalesce(array_agg(distinct n order by n),'{}'::text[]) from unnest(p_names)n$$;`);
 for(const [raw,,stale]of pairs)for(const [country,platform]of[['印度','SYNTHETIC'],['印尼','SYNTHETIC'],['印度','HIDDEN']])await db.query('insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values) values($1,$2,$3,array[$4])',[country,platform,raw,stale]);
 // Restore the historical production definitions before applying the new patch.
 await db.exec(sql('admin-live-india-usdt-classification.sql').replace(/-- BEGIN USDT LIVE BASELINE GUARD[\s\S]*?-- END USDT LIVE BASELINE GUARD/,''));
 const history=sql('migrations/20260928073754_workorder_arbpay_and_yayapay_identity.sql');await db.exec(fn(history,'dashboard_admin_live_provider_alias'));
 await db.exec(fn(history,'dashboard_admin_live_workorder_provider'));
 const config=sql('admin-live-configuration.sql');await db.exec(part(config,'create or replace function private.dashboard_admin_live_provider_alias_values(','create or replace function private.dashboard_admin_live_provider_rows('));
 await db.exec(sql('admin-live-provider-filter-performance.sql'));
 const query=sql('admin-live-configuration-query.sql');await db.exec(part(query,'create or replace function private.dashboard_admin_live_remap_groups(','create or replace function private.dashboard_admin_live_expand_provider_filter('));
 await db.exec(fn(sql('admin-live-workorder-provider-batch.sql'),'dashboard_admin_live_workorder_provider_batch'));
 assert.equal(await canonical('印度','SYNTHETIC','BasePay-QR'),'BasePay');
 assert.equal(await canonical('印度','SYNTHETIC','Wallet66-BSC'),'USDT');
 sourceBefore=await snapshot();await db.exec(migration);
});
after(()=>db?.close());

test('confirmed exact identities agree in TypeScript, generated browser and installed SQL in India only',async()=>{
 for(const country of ['印度','IN','India','印度线下','香港','红膏蟹'])for(const [raw,expected]of pairs)for(const input of [raw,` ${raw.toUpperCase()} `,`${raw} (唤醒)`,raw.replace('-',' — ')]){
  assert.equal(names.canonicalThirdPartyName(input,country),expected);
  assert.equal(browser.HensemProviderNames.canonical(input,country),expected);
  assert.equal((await db.query('select private.dashboard_admin_live_provider_alias($1,$2) value',[country,input])).rows[0].value,expected);
 }
 for(const country of ['印尼','马来','巴西','IN-extra',''])for(const raw of ['Wallet66-BSC','Rushpay-Bank','BasePay-QR']){
  assert.equal(names.confirmedIndiaThirdPartyAlias(raw,country),'');
  assert.equal(browser.HensemProviderNames.canonical(raw,country),raw);
  assert.equal((await db.query('select private.dashboard_admin_live_provider_alias($1,$2) value',[country,raw])).rows[0].value,raw);
 }
 for(const raw of ['Wallet66-BSC2','Wallet66_BSC','Rushpay-Bank2','RushpayBank','BasePay-QR2','BasePay','BSC','Bank','QR'])assert.equal(names.confirmedIndiaThirdPartyAlias(raw,'印度'),'');
 for(const country of ['印尼','马来'])assert.equal(names.canonicalThirdPartyName('BasePay',country),'BasePay');
});

test('stale automatic registry labels agree across canonical, source configuration, options and exact filter expansion',async()=>{
 for(const [raw,expected]of pairs)assert.equal(await canonical('印度','SYNTHETIC',raw),expected);
 const rows=(await db.query('select * from private.dashboard_admin_live_provider_rows()')).rows;
 assert.equal(rows.length,pairs.length);
 for(const [raw,expected]of pairs){const row=rows.find(r=>r.raw_provider===raw);assert.equal(row.canonical_provider,expected);assert.deepEqual(row.canonical_values,[expected]);assert.equal(row.manual,false);assert.equal(row.status,'assigned')}
 for(const direction of ['charge','withdraw','all'])assert.deepEqual(await options(direction),['FFPay','RushPay','Wallet66']);
 assert.deepEqual((await expand(['Wallet66'])).providers,['Wallet66','Wallet66-BSC']);
 assert.deepEqual((await expand(['RushPay'])).providers,['RushPay','Rushpay-Bank']);
 assert.deepEqual((await expand(['FFPay'])).providers,['BasePay-QR','FFPay']);
 assert.deepEqual((await expand(['USDT','LegacyBank','BasePay'])).providers,['BasePay','LegacyBank','USDT']);
 assert.deepEqual(await snapshot(),sourceBefore,'no source classification is rewritten');
 assert.equal(await canonical('印尼','SYNTHETIC','BasePay-QR'),'BasePay','other countries retain their stored classification');
});

test('workorder scalar and batch resolve the exact same confirmed raw providers with historical registry rows',async()=>{
 const inputs=pairs.map(([raw_provider])=>({country:'印度',platform:'SYNTHETIC',raw_provider,channel_type:'UNKNOWN'}));
 const rows=(await db.query('select b.*,private.dashboard_admin_live_workorder_provider(country,platform,raw_provider,channel_type) scalar from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)b',[JSON.stringify(inputs)])).rows;
 for(const [raw,expected]of pairs){const row=rows.find(r=>r.raw_provider===raw);assert.equal(row.provider,expected);assert.equal(row.scalar,expected)}
});

test('server grouping merges each pair once but preserves direction/date/currency, every amount, and raw details',async()=>{
 const base={currency:'INR',direction:'withdraw',date:'2026-09-29',all_amount:'100',all_count:2,success_amount:'80',success_count:1,created_success_count:1,pending_amount:'20',pending_count:1,failed_amount:'0',failed_count:0,rejected_amount:'0',rejected_count:0,unknown_amount:'0',unknown_count:0,missing_amount_count:0,negative_amount_count:0};
 const input=pairs.map(([provider])=>({...base,provider}));
 input.push({...base,provider:'Rushpay-Bank',direction:'charge'},{...base,provider:'Rushpay-Bank',date:'2026-09-28'},{...base,provider:'Wallet66-BSC',currency:'USDT'});
 const result=(await db.query('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true) rows',[JSON.stringify(input),'印度','SYNTHETIC'])).rows[0].rows;
 assert.equal(result.length,6);assert.equal(result.reduce((n,r)=>n+r.all_count,0),18);assert.equal(result.reduce((n,r)=>n+Number(r.all_amount),0),900);
 for(const provider of ['Wallet66','RushPay','FFPay']){const row=result.find(r=>r.provider===provider&&r.currency==='INR'&&r.direction==='withdraw'&&r.date==='2026-09-29');assert.equal(row.all_count,4);assert.equal(Number(row.all_amount),200)}
 const again=(await db.query('select private.dashboard_admin_live_remap_groups($1::jsonb,$2,$3,true) rows',[JSON.stringify(result),'印度','SYNTHETIC'])).rows[0].rows;assert.deepEqual(again,result);
 const detail=[{provider:'BasePay-QR',raw_provider:'BasePay-QR',channel_type:'QR',order_number:'SYNTHETIC-1',amount:100}];
 const mapped=(await db.query('select private.dashboard_admin_live_remap_rows($1::jsonb,$2,$3) rows',[JSON.stringify(detail),'印度','SYNTHETIC'])).rows[0].rows;assert.deepEqual(mapped,[{...detail[0],provider:'FFPay'}]);
});

test('manual configuration remains explicit and fresh in every read path, with no implicit cross-platform grant',async()=>{
 await db.exec("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values('印度','SYNTHETIC','BasePay-QR','ReviewedPay')");
 try{
  assert.equal(await canonical('印度','SYNTHETIC','BasePay-QR'),'ReviewedPay');
  assert((await options('all')).includes('ReviewedPay'));
  assert.deepEqual((await expand(['FFPay'])).providers,['FFPay']);assert.deepEqual((await expand(['ReviewedPay'])).providers,['BasePay-QR','ReviewedPay']);
  const rows=(await db.query('select * from private.dashboard_admin_live_provider_rows()')).rows;assert.equal(rows.find(r=>r.raw_provider==='BasePay-QR').canonical_provider,'ReviewedPay');
  await db.exec(migration);assert.equal(await canonical('印度','SYNTHETIC','BasePay-QR'),'ReviewedPay','deployment does not silently rewrite an existing manual override');
 }finally{await db.exec("delete from private.dashboard_admin_provider_overrides where country='印度' and platform='SYNTHETIC'")}
 const request={platformId:hidden,providers:['FFPay']};assert.deepEqual(await expand(['FFPay'],hidden),request);
 await db.exec("select set_config('test.denied','yes',false)");try{await assert.rejects(()=>options('all'),/preview_denied/);await assert.rejects(()=>expand(['FFPay']),/preview_denied/)}finally{await db.exec("select set_config('test.denied','no',false)")}
});

test('migration reapplication preserves privileges and source rows and matches freshly generated definitions',async()=>{
 await db.exec(migration);assert.deepEqual(await snapshot(),sourceBefore);
 for(const role of ['anon','authenticated'])for(const name of ['dashboard_admin_live_provider_alias','dashboard_admin_live_confirmed_usdt_provider'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') value',[role,`private.${name}(text,text)`])).rows[0].value,false);
 const actual=(await db.query("select private.dashboard_admin_live_provider_alias('印度',raw) alias,private.dashboard_admin_live_confirmed_usdt_provider('印度',raw) confirmed from unnest($1::text[]) raw",[pairs.map(p=>p[0])])).rows;
 await db.exec(sql('admin-live-provider-aliases.sql'));
 const generated=(await db.query("select private.dashboard_admin_live_provider_alias('印度',raw) alias,private.dashboard_admin_live_confirmed_usdt_provider('印度',raw) confirmed from unnest($1::text[]) raw",[pairs.map(p=>p[0])])).rows;assert.deepEqual(generated,actual);
 assert.doesNotMatch(migration,/\b(?:insert\s+into|update\s+(?:public|private)\.|delete\s+from|refresh\s+materialized|drop\s+|grant\s+)\b/i);
});

test('unknown dictionary structures stop atomically without overwriting newer production logic',async()=>{
 const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_provider_alias(text,text)'::regprocedure) value")).rows[0].value;
 await db.exec("create or replace function private.dashboard_admin_live_provider_alias(p_country text,p_name text) returns text language sql immutable set search_path='' as $$select p_name$$");
 try{await assert.rejects(()=>db.exec(migration),/Provider alias dictionary baseline changed/);await db.exec('rollback');assert.equal((await db.query("select private.dashboard_admin_live_provider_alias('印度','BasePay-QR') value")).rows[0].value,'BasePay-QR')}
 finally{await db.exec(definition)}
});

test('old volume snapshots and fee matching use the same canonical identity without changing direction, type, or totals',()=>{
 const rows=pairs.map(([rawChannel,,channel],i)=>({id:'synthetic-'+i,sheetName:'synthetic',sourceRow:i+2,date:'2026-09-29',country:'印度',platform:'SYNTHETIC',channel,rawChannel,channelType:'SOURCE-TYPE',direction:'代付',amount:100,count:2,successCount:1,failedCount:1,successRate:0.5,status:''}));
 const input={meta:{year:'2026',month:'9',source:'synthetic',updatedAt:'2026-09-29',sheets:['synthetic']},rows,aliasMap:{},summary:{},anomalies:[]},before=structuredClone(input),result=volume.normalizeThirdPartyVolumePayload(input);
 assert.deepEqual(input,before);assert.deepEqual(new Set(result.rows.map(r=>r.channel)),new Set(['Wallet66','RushPay','FFPay']));
 assert.equal(result.rows.reduce((n,r)=>n+r.amount,0),600);assert.equal(result.rows.reduce((n,r)=>n+r.count,0),12);
 assert(result.rows.every(r=>r.direction==='代付'&&r.channelType==='SOURCE-TYPE'));
 assert.deepEqual(volume.normalizeThirdPartyVolumePayload(result).rows,result.rows);
 const rates=['Wallet66','RushPay','FFPay'].map((provider,i)=>({provider,country:'印度',scopeType:'country',payoutFee:`${i+1}%`}));
 for(const [raw,expected]of pairs){const order={provider:raw,country:'印度',currency:'INR',direction:'withdraw',success_amount:100,success_count:1};assert.deepEqual(Array.from(browser.HensemProviderSummary.feeCandidates(order,rates,'印度'),r=>r.provider),[expected])}
});
