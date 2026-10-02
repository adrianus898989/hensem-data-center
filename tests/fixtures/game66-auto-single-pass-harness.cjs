// Offline synthetic fixtures only: no real credentials, orders or network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../..');
const {PGlite}=require(path.join(repo,'node_modules/@electric-sql/pglite'));
const baseline=fs.readFileSync(path.join(__dirname,'game66-auto-single-pass-baseline.sql'),'utf8');
const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261002140700_admin_game66_auto_withdraw_single_pass.sql'),'utf8');
const candidate=migration.split('execute $candidate$\n')[1].split('\n $candidate$;')[0]+'\n';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const signature='private.dashboard_admin_live_game66_withdraw(date,date,text,text[])';
const read=async(db,country='香港',platforms=null,start='2026-10-01',end='2026-10-02')=>(await db.query(`select ${signature.split('(')[0]}($1,$2,$3,$4) result`,[start,end,country,platforms])).rows[0].result;
const meta=async db=>(await db.query('select to_jsonb(p)-\'prosrc\' metadata,md5(prosrc) md5 from pg_proc p where oid=$1::regprocedure',[signature])).rows[0];
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table public.game66_platforms(id uuid primary key,team_code text,team_name text,platform_name text,platform_code text);
 create table public.game66_withdraw_orders(platform_id uuid,create_time timestamptz,status_code text,auto_commit text,audit_admin text,lock_admin text,lock_user_admin text,update_time timestamptz,submit_time timestamptz,last_seen_at timestamptz);
 alter table public.game66_platforms enable row level security;alter table public.game66_withdraw_orders enable row level security;
 create index game66_withdraw_orders_platform_time_idx on public.game66_withdraw_orders(platform_id,create_time desc);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable set search_path='' as $$begin
 if current_setting('test.denied',true)='yes' then raise exception using errcode='42501',message='synthetic_scope_denied';end if;
 return coalesce(nullif(current_setting('test.scope',true),''),'null')::jsonb;end$$;
 create function private.dashboard_scope_allows(scope jsonb,country text,platform text) returns boolean language sql immutable set search_path='' as $$select scope='null'::jsonb or scope @> jsonb_build_array(jsonb_build_object('country',country,'platform',platform))$$;
 `);
 const catalog=fs.readFileSync(path.join(repo,'supabase/admin-live-withdraw-pages.sql'),'utf8');
 const keyStart=catalog.search(/create\s+or\s+replace\s+function\s+private\.dashboard_admin_live_withdraw_key\s*\(/i);
 const readerStart=catalog.search(/create\s+or\s+replace\s+function\s+private\.dashboard_admin_live_game66_withdraw\s*\(/i);
 assert(keyStart>=0&&readerStart>keyStart,'canonical scope-key helper must have bounded extraction');
 await db.exec(catalog.slice(keyStart,readerStart));
 await db.exec(baseline+`revoke all on function ${signature} from public,anon,authenticated,service_role;`);
 return db;
}
async function seed(db){
 const platforms=[
  [1,'hong_kong','香港','SAME','A'],[2,'hong_kong','香港',' SAME ','B'],
  [3,'red_crab','红膏蟹','SAME','C'],[4,'hong_kong','香港','Dhani.Win','D'],
  [5,null,'香港','NO-CODE','E'],[6,'future','未来国',null,' Fallback '],
  [7,'future','未来国',' ',null],[8,'hong_kong',' ',' ','EMPTY'],
  [9,'red_crab','香港','SAME','OTHER-SCOPE']
 ];
 for(const [n,...fields]of platforms)await db.query('insert into game66_platforms values($1,$2,$3,$4,$5)',[id(n),...fields]);
 const examples=[
  [1,'2026-09-30T18:30:00Z','1','2','ignored',null,null,'2026-09-30T18:30:10Z',null,'2026-10-04T00:00Z'],
  [1,'2026-10-01T02:00:00Z','3',null,' Alice ',null,null,'2026-10-01T02:00:01.000001Z',null,null],
  [2,'2026-10-01T02:01:00Z','-1','1',null,' Alice ',null,'2026-10-01T02:01:11Z',null,null],
  [2,'2026-10-01T02:02:00Z','2','x',' ',' ',null,'2026-10-01T02:01:00Z',null,null],
  [1,'2026-10-01T02:03:00Z','future',null,null,null,' Fallback ',null,'2026-10-01T02:03:02Z',null],
  [1,'2026-10-01T02:04:00Z',null,'2',null,null,null,null,null,'2026-10-01T02:04:03Z'],
  [1,'2026-10-01T02:05:00Z','3','',null,null,null,null,null,null],
  [1,'2026-10-01T02:06:00Z','1','manual','自动审核',null,null,null,null,null],
  [1,'2026-10-02T18:29:59.999999Z','3','2',null,null,null,'2026-10-02T18:30:30Z',null,null],
  [1,'2026-10-02T18:30:00Z','3','2',null,null,null,null,null,null],
  [1,'2026-09-30T18:29:59.999999Z','3','2',null,null,null,null,null,null],
  [1,null,'3','2',null,null,null,null,null,null],
  [3,'2026-10-01T02:00Z','3','2',null,null,null,null,null,null],
  [4,'2026-10-01T02:00Z','-1','2',null,null,null,null,null,null],
  [5,'2026-10-01T02:00Z','3','2',null,null,null,null,null,null],
  [6,'2026-10-01T02:00Z','1','manual',null,null,null,null,null,null],
  [7,'2026-10-01T02:00Z','2',null,null,null,null,null,null,null],
  [8,'2026-10-01T02:00Z','3',null,null,null,null,null,null,null],
  [9,'2026-10-01T02:00Z','3','2',null,null,null,null,null,null],
  [99,'2026-10-01T02:00Z','3','2',null,null,null,null,null,null]
 ];
 for(const [n,...fields]of examples)await db.query('insert into game66_withdraw_orders values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id(n),...fields]);
}

module.exports={fixture,seed,read,meta,id,signature,baseline,candidate,migration,repo};
