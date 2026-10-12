const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../..');
const migrations=["20261012151428_maan_submission_typed_facts.sql", "20261012151516_maan_submission_hourly_proofs.sql", "20261012151538_maan_submission_proven_chart_reader.sql"];
const stage=n=>fs.readFileSync(path.join(repo,'supabase/migrations',migrations[n-1]),'utf8');
const baseline=fs.readFileSync(path.join(__dirname,'maan-submission-reader-production.sql'),'utf8');
const anchor=' execute v_sql into v_result using ';
const replacement=stage(3).match(/definition:=replace\(definition,\$anchor\$[^$]+\$anchor\$,\$replacement\$([\s\S]*?)\$replacement\$\);/)[1];
if(!replacement.endsWith(anchor))throw Error('reader replacement anchor drift');
const block=replacement.slice(0,-anchor.length),candidate=baseline.replace(anchor,replacement);
const dayScript=day=>"begin isolation level repeatable read;set local statement_timeout='3s';set local lock_timeout='1s';select set_config('m8.maan.proof_receipt','',false);select private.begin_maan_submission_day(date'"+day+"');\n"+Array.from({length:24},(_,h)=>"select private.verify_maan_submission_hour(date'"+day+"',"+h+");").join('\n')+"\nselect set_config('m8.maan.proof_receipt',private.approve_maan_submission_day(date'"+day+"')::text,false);commit;select current_setting('m8.maan.proof_receipt')::jsonb as receipt;";
const futureScript=day=>"begin isolation level repeatable read;set local statement_timeout='3s';set local lock_timeout='1s';select private.approve_maan_submission_future(date'"+day+"');commit;";
function readArtifact(n){if(n==='stage1-install.sql'||n==='backfill-core.sql')return stage(1);if(n==='stage2-install.sql')return stage(2);if(n==='stage3-install.sql')return stage(3);if(n==='reader-baseline.sql')return baseline;if(n==='reader-candidate.sql')return candidate;if(n==='reader-block.sql')return block;if(n==='reader-fingerprints.json')return JSON.stringify({after:'cd7a262ccf7398acd43d5c18d43e627a'});if(n==='proof-objects.sql')return stage(2).split('execute $objects$')[1].split('$objects$;')[0];if(n==='approve-day.template.sql')return dayScript('__DAY__');if(n==='approve-future.template.sql')return futureScript('__FROM__');throw Error('unknown artifact '+n);}
const{PGlite}=require('@electric-sql/pglite');
async function fixture(options={}){
 const db=new PGlite(),meta=JSON.parse(fs.readFileSync(path.join(__dirname,'maan-submission-source-contract.json'),'utf8'))[0].source_contract;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;revoke all on schema private from public;
 create table public.newar_detail_platforms(platform text primary key,timezone text not null,currency text not null,launch_at timestamptz);
 insert into public.newar_detail_platforms values('MAANWIN','Asia/Kolkata','INR',null),('DhaniWin','Asia/Kolkata','INR',null);
 create table public.newar_detail_records(${meta.columns.map(c=>c.name+' '+c.type+(c.notNull?' not null':'')+(c.default?' default '+c.default:'')).join(',')},actual_amount numeric(24,8),fee numeric(24,8),processed_at timestamptz,followup_count integer);
 ${meta.constraints.map(c=>'alter table public.newar_detail_records add constraint '+c.name+' '+c.definition+';').join('\n')}
 alter table public.newar_detail_records enable row level security;
 alter table public.newar_detail_platforms enable row level security;
 revoke all on public.newar_detail_records,public.newar_detail_platforms from public,anon,authenticated;
 grant all on public.newar_detail_records,public.newar_detail_platforms to service_role;
 create index newar_detail_created_idx on public.newar_detail_records(platform,dataset,created_at desc,id desc);
 create index newar_detail_success_idx on public.newar_detail_records(platform,dataset,success_at desc,id desc)where status_group='success'and success_at is not null;
 create table public.fixture_withdraw_calls(n integer);insert into public.fixture_withdraw_calls values(0);
 create function private.fixture_withdraw_sync()returns trigger language plpgsql security definer set search_path=''as $$begin if NEW.dataset='withdraw'then update public.fixture_withdraw_calls set n=n+1;end if;return NEW;end;$$;
 create trigger fixture_withdraw after insert or update on public.newar_detail_records for each row execute function private.fixture_withdraw_sync();`);
 const before=(await db.query("select md5(prosrc)h from pg_proc where oid='private.fixture_withdraw_sync()'::regprocedure")).rows[0].h;
 if(options.install!==false)await db.exec(stage(1));
 const rows=sql=>db.query(sql),scalar=async sql=>Object.values((await rows(sql)).rows[0])[0];
 async function insert(source,opts={}){return(await db.query(`insert into public.newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,channel_type,currency,amount,status_group,created_at,success_at,raw,captured_at)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11::timestamptz,$12::timestamptz,$13::jsonb,$14::timestamptz)returning id`,[
 opts.platform||'MAANWIN',opts.dataset||'charge',source,opts.member??'0001',Object.hasOwn(opts,'order')?opts.order:source,
 Object.hasOwn(opts,'provider')?opts.provider:'route-a',opts.channel??null,opts.currency??'INR',opts.amount??'123.45678901',
 opts.status||'pending',opts.created||'2026-10-12T00:00:01+05:30',opts.success||null,JSON.stringify(opts.raw||{memberLevel:'LV0',rechargeCount:0}),'2026-10-12T10:00:00Z'
 ])).rows[0].id;}
 const fact=async id=>(await db.query('select * from private.maan_submission_facts where record_id=$1',[id])).rows[0];
 const receipt=()=>db.exec("insert into private.maan_submission_ready values('2026-10-12',repeat('a',32),0,now())on conflict do nothing;insert into private.maan_submission_future_ready values(true,'2026-10-13',repeat('a',32),now())on conflict do nothing");
 return{db,meta,insert,fact,receipt,scalar,before,close:()=>db.close()};
}
module.exports={fixture,stage,readArtifact,baseline,candidate,block,dayScript,futureScript};
