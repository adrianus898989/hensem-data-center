// Synthetic-only 39,005-order benchmark. Uses real SQL helpers; no network or credentials.
// Run with node scripts/benchmark-withdraw-reason-normalization.cjs.
// Includes ANALYZE so the synthetic database has realistic cardinality estimates.
const fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const dir=require('node:path').resolve(__dirname,'..'),read=p=>fs.readFileSync(dir+'/'+p,'utf8');
const baseline=read('supabase/migrations/20261001071746_withdraw_manual_empty_reason_category.sql'), patch=read('supabase/migrations/20261001074329_withdraw_reason_normalize_once.sql');
const extract=s=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_reasons'),s.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_withdraw_reasons'));
(async()=>{
 const db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $2='印度' and $3='AR-A'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,source_name text,country text,scope_group text,source text) language sql stable as $$values ('AR-A','AR-A','印度','IN','ar')$$;
 create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) returns jsonb language sql stable as $$select null::jsonb$$;
 create function private.dashboard_admin_live_rejection_category(text,text) returns text language sql immutable as $$select coalesce($2,'源备注为空')$$;
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz default now());
 create table auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view withdraw_reasons_daily_grouped as select * from withdraw_reasons_daily;
 insert into ar_collected_orders select 'AR','IN','AR-A','withdraw','PERF-'||n,100,case when n%9=0 then '未通过' else '已通过' end,case when n<=16135 then 'system' when n=16136 then null else 'agent-a' end,'2026-09-30 12:00'::timestamp+n*interval '1 second',null,
 case when n<=16135 then '系统说明实际值：'||(n%16134)::text when n<=16170 then null else '充提差负盈利金额小于500.00,当前充提差负盈利金额：-'||(((n-16171)%3757)/100.0)::text||',不能自动出款,(用户充值总额：1000.00,历史提现总额:500.00,待处理金额:100.00,用户余额:400.00)' end,
 case when n%9=0 then '[Resubmit order]Check bank detail' else null end,'','2026-10-01T00:00Z' from generate_series(1,39005)n;
 insert into auto_withdraw_daily values('印度','2026-09-30','AR-A',39005,'2026-10-01T00:00Z');`);
 const norm=read('supabase/admin-live-withdraw-note-normalization.sql');await db.exec(norm.slice(norm.indexOf('create or replace function'),norm.indexOf('-- Only complete, observed')));await db.exec(read('supabase/migrations/20260928151000_admin_live_withdraw_red_packet_grouping.sql'));
 await db.exec(extract(baseline));
 const call=async()=>{const t=performance.now();const x=(await db.query(`select private.dashboard_admin_live_withdraw_reasons('{"country":"印度","platform":"AR-A","date":"2026-09-30","kind":"blocking"}') value`)).rows[0].value;return{ms:performance.now()-t,value:x}};
 await db.exec('analyze ar_collected_orders');
 const pre=[];for(let n=0;n<2;n++){pre.push(await call());console.log('before',n,pre[n].ms,pre[n].value.noteCount,pre[n].value.total)}
 await db.exec(patch);
 const post=[];for(let n=0;n<2;n++){post.push(await call());console.log('after',n,post[n].ms,post[n].value.noteCount,post[n].value.total)}
 const assert=require('node:assert/strict');assert.deepEqual(post[0].value,pre[0].value);assert.deepEqual(post[1].value,pre[1].value);
 console.log('equal JSON, before/after milliseconds',JSON.stringify({before:pre.map(x=>x.ms),after:post.map(x=>x.ms)}));
 const helperPatch=read('supabase/migrations/20261001074259_withdraw_blocking_diagnostic_templates.sql');await db.exec(helperPatch);
 const combined=[];for(let n=0;n<2;n++){combined.push(await call());console.log('combined helper/RPC',n,combined[n].ms,combined[n].value.noteCount,combined[n].value.total)}
 for(const x of combined){assert.deepEqual(x.value.summary.operatorCounts,post[0].value.summary.operatorCounts);assert.equal(x.value.total,2);assert.equal(x.value.rows.reduce((n,r)=>n+r.count,0),22869);assert.equal(x.value.rows.find(r=>r.reason!=='检测没备注').sourceVariantCount,3757);}
 console.log('verified coverage',JSON.stringify(post[0].value.summary.operatorCounts));
 await db.exec(read('supabase/migrations/20261001080037_withdraw_reason_compact_evaluation.sql'));
 for(let n=0;n<2;n++){const x=await call();console.log('compact + cleaned parser',n,x.ms,x.value.noteCount,x.value.total);assert.deepEqual(x.value,combined[n].value)}
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
