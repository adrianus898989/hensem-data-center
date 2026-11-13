const fs=require('node:fs'),path=require('node:path');
const legacy=require('./wg-provider-options-harness.cjs');
const baseline=fs.readFileSync(path.join(__dirname,'provider-options-current-channels-before.sql'),'utf8');
const id=legacy.ids.ar,other='10000000-0000-0000-0000-000000000099';
const snapshot='20000000-0000-0000-0000-000000000001';
async function setup(){
 const d=await legacy.setup();await d.exec(legacy.migration);
 await d.exec(`create function private.dashboard_admin_live_confirmed_provider(text,text,text) returns text language sql stable as $$select null::text$$;
 create table private.yash_orders(supplier text,source_site text,order_type text);
 create table private.yash_channels(provider text,order_type text,channel_name text);
 create function private.dashboard_admin_yash_provider(text) returns text language sql immutable as $$select $1$$;
 create function private.dashboard_admin_panda_provider_names(text,text) returns table(provider text) language sql stable as $$select null::text where false$$;
 create table private.duoli_order_details(provider_code text,country text,system_name text,platform text,business text);
 create function private.dashboard_admin_duoli_provider(text) returns text language sql immutable as $$select $1$$;
 create table private.ar_middle_channel_platforms(source_origin text,source_tenant_id text,dashboard_platform_id uuid,country_code text,native_platform text,enabled boolean);
 create table private.ar_middle_channels(source_origin text,source_tenant_id text,order_type text,channel_data jsonb,is_present boolean,snapshot_id uuid,observed_at timestamptz);
 create table private.ar_middle_channel_sync_state(source_origin text,source_tenant_id text,order_type text,snapshot_id uuid,observed_at timestamptz);
 insert into private.test_platforms values('${other}','ar','印度','OTHER','OTHER','IN');
 insert into private.ar_middle_channel_platforms values('https://fixture.invalid','AR','${id}','IN','ARTEST',true),('https://other.invalid','OTHER','${other}','IN','OTHER',true);
 insert into private.ar_middle_channel_sync_state values('https://fixture.invalid','AR','deposit','${snapshot}','2026-10-26T00:00:00Z'),('https://fixture.invalid','AR','withdrawal','${snapshot}','2026-10-26T00:00:00Z'),('https://other.invalid','OTHER','deposit','${snapshot}','2026-10-26T00:00:00Z');
 create or replace function private.dashboard_admin_live_provider_canonical(c text,p text,n text) returns text language sql stable as $$
 select case when c='印度' and p='ARTEST' and n in ('RAPay-QR','RAPay','PAYTM- RAPay') then 'RAPay' else coalesce((select o.canonical_provider from private.dashboard_admin_provider_overrides o where o.country=c and o.platform=p and o.raw_provider=n),case when c='越南' and n in ('YesPay(VND)','YesPay(VND)(已删除:731329)') then 'YesPay' else n end) end$$;`);
 const rows=[['deposit','RAPay-QR',true],['deposit','PAYTM- RAPay',true],['deposit','RAPay2INR',true],['withdrawal','RAPay',true],['withdrawal','WithdrawalOnly',true],['deposit','RetiredOnly',false],['deposit','',true]];
 for(const [direction,name,present]of rows)await d.query('insert into private.ar_middle_channels values($1,$2,$3,$4::jsonb,$5,$6,$7)',['https://fixture.invalid','AR',direction,JSON.stringify({channel_name:name,provider:'MustNotGuessProvider',source_channel_name:'MustNotGuessSource'}),present,snapshot,'2026-10-26T00:00:00Z']);
 await d.exec(`insert into private.ar_middle_channels values('https://other.invalid','OTHER','deposit','{"channel_name":"UnauthorizedOnly"}',true,'${snapshot}','2026-10-26T00:00:00Z'),('https://fixture.invalid','AR','deposit','{"channel_name":"OldSnapshot"}',true,'20000000-0000-0000-0000-000000000002','2026-10-26T00:00:00Z'),('https://fixture.invalid','AR','deposit','{"channel_name":"OldObservation"}',true,'${snapshot}','2026-10-25T00:00:00Z');`);
 await d.exec(baseline);return d;
}
module.exports={setup,id,other,snapshot};
