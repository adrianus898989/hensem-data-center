/* Full scoped work-order cohorts: synthetic Postgres only. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const alpha='11111111-1111-4111-8111-111111111111',beta='22222222-2222-4222-8222-222222222222';
const req={country:'印度',startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-02T23:59:59Z',limit:20};
const call=async extra=>(await db.query('select private.dashboard_admin_live_workorders($1::jsonb) value',[JSON.stringify({...req,...extra})])).rows[0].value;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb)$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or $1->'platforms' ? $3,false)$$;
 create table catalog(id uuid,name text,source_name text,country text,scope_group text,source text);
 create function private.dashboard_admin_live_platforms() returns setof public.catalog language sql stable as $$select * from public.catalog where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),country,source_name)$$;
 create function private.dashboard_admin_live_workorder_provider(text,text,text,text) returns text language sql stable as $$select case when $3='Example-QR' then 'Example' else $3 end$$;
 create table workorder_deposit_daily(stat_date date,country_code text,country text,platform text,third_party text,channel_type text,source_system text,submitted_count bigint,submitted_amount numeric,success_count bigint,success_amount numeric,withdraw_not_received_count bigint,withdraw_not_received_amount numeric,withdraw_success_count bigint,withdraw_success_amount numeric,source_updated_at timestamptz default now(),updated_at timestamptz default now());
 insert into catalog values('${alpha}','Alpha','RawAlpha','印度','IN','ar'),('${beta}','Beta','RawBeta','印度','IN','newar');
 insert into workorder_deposit_daily select '2026-09-01','IN','印度','RawAlpha','Example-QR','CHANNEL-'||i,'AR_WORKORDER',2,100,1,40,3,150,1,50,now(),now() from generate_series(1,25)i;
 insert into workorder_deposit_daily values('2026-09-02','IN','印度','RawAlpha','Example','OTHER','AR_WORKORDER',4,200,2,100,5,250,3,150,now(),now()),('2026-09-02','IN','印度','RawBeta','Example','OTHER','AR_WORKORDER',6,300,3,150,8,400,4,200,now(),now()),('2026-09-02','MY','马来','Private','Example','OTHER','AR_WORKORDER',999,99999,999,99999,999,99999,999,99999,now(),now());`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/admin-live-workorder-platform-breakdown.sql'),'utf8'));
});
after(async()=>{await db?.close()});

test('full platform-provider amounts are independent of page offsets and preserve existing totals',async()=>{
 const first=await call(),second=await call({offset:20});assert.equal(first.rows.length,20);assert.equal(first.total,54);
 assert.deepEqual(first.byPlatformProvider,second.byPlatformProvider);assert.deepEqual(first.byProvider,second.byProvider);assert.deepEqual(first.summary,second.summary);
 assert.equal(first.byPlatformProvider.length,4);
 for(const direction of ['charge','withdraw']){const children=first.byPlatformProvider.filter(r=>r.direction===direction),parent=first.byProvider.find(r=>r.direction===direction);for(const key of ['submittedAmount','submittedCount','successAmount','successCount','notReceivedAmount','notReceivedCount'])assert.equal(children.reduce((n,r)=>n+Number(r[key]),0),Number(parent[key]),direction+'/'+key)}
 const charge=first.byPlatformProvider.find(r=>r.platformId===alpha&&r.direction==='charge');assert.equal(charge.platform,'Alpha');assert.equal(charge.sourcePlatform,'RawAlpha');assert.equal(charge.source,'ar');assert.equal(charge.submittedAmount,2700);assert.equal(charge.submittedCount,54);assert.equal(charge.successAmount,1100);
 assert.equal(first.coverage.platforms.find(r=>r.platform==='Alpha').platformId,alpha);
});

test('scope, direction, provider and platform filters apply before full aggregation',async()=>{
 const filtered=await call({platforms:['RawBeta'],providers:['Example'],direction:'withdraw'});assert.equal(filtered.byPlatformProvider.length,1);assert.equal(filtered.byPlatformProvider[0].platformId,beta);assert.equal(filtered.byPlatformProvider[0].submittedAmount,400);assert.equal(filtered.byPlatformProvider[0].notReceivedAmount,200);
 assert.equal((await call({providers:['Other']})).byPlatformProvider.length,0);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({platforms:['RawAlpha']})]);try{const restricted=await call({country:null});assert.equal(restricted.byPlatformProvider.length,2);assert(restricted.byPlatformProvider.every(r=>r.platformId===alpha));assert(!JSON.stringify(restricted).includes('99999'))}finally{await db.exec("set test.scope=''")}
});

test('ambiguous same-name catalog entries do not duplicate issue amounts or invent one source identity',async()=>{
 await db.exec('begin');try{await db.query("insert into catalog values('33333333-3333-4333-8333-333333333333','Beta','RawBeta','印度','IN','ar')");const result=await call({platforms:['RawBeta'],direction:'charge'});assert.equal(result.byPlatformProvider.length,1);const row=result.byPlatformProvider[0];assert.equal(row.submittedAmount,300);assert.equal(row.platformId,null);assert.equal(row.source,null);assert.equal(result.coverage.platforms[0].platformId,null)}finally{await db.exec('rollback')}
});

test('only the existing authenticated workorder RPC access is retained',async()=>{
 for(const role of ['anon','authenticated']){const allowed=(await db.query('select has_function_privilege($1,$2,\'execute\') value',[role,'private.dashboard_admin_live_workorders(jsonb)'])).rows[0].value;assert.equal(allowed,role==='authenticated')}
 assert.equal((await call({offset:1000})).rows.length,0);assert.equal((await call({offset:1000})).byPlatformProvider.length,4);
});
