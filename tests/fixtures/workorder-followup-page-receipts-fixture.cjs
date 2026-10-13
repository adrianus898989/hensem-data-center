const fs=require('node:fs');const path=require('node:path');const{PGlite}=require('@electric-sql/pglite');
async function fixture(){const db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'workorder-followup-page-receipts-production.sql'),'utf8'));
 const acct={auth_user_id:'10000000-0000-0000-0000-000000000001',role:'agent',active:true,team:'M8',platforms:['PLATFORM-A','82LOTTERY']};
 await db.query(`insert into public.admin_deposit_followup_rows(id,source_kind,source_sheet,source_tab,source_row,country,platform,order_number,followup_date,provider,amount,followup_status,first_actor,last_actor,portal_owner_id,portal_team,portal_payload,upi_id,kyc_upi_id,staff_code,utr_match,kyc_correct,work_order_number,utr,provider_reply)
 select 'SYNTHETIC-'||g,case when g%3=0 then 'portal' else 'sheet' end,'synthetic-sheet','synthetic-tab',g,case when g%17=0 then '尼日利亚' else '印度' end,
 case when g%13=0 then 'UNAUTHORIZED' when g%7=0 then 'INDIA82' else 'PLATFORM-A' end,
 case g%5 when 0 then 'NOT-A-RECEIPT' when 1 then 'RC20260230BAD' when 2 then 'RC20991231FUTURE' else 'RC20261010SYNTHETIC'||g end,
 case when g%11=0 then null else date '2026-10-07'+(g%7)end,
 'Pay-'||(g%4),'100.50'::numeric+g,case g%4 when 0 then 'Success' when 1 then 'Not Yet Received' when 2 then 'Success To Other Order' else 'REFUND' end,
 'Creator-'||(g%3),'Follower-'||(g%2),case when g%10=0 then '10000000-0000-0000-0000-000000000002'::uuid else $1::uuid end,
 case when g%14=0 then 'M9' else 'M8' end,jsonb_build_object('created_at','2026-10-06T18:30:00Z','last_follow_at',case when g%9=0 then '' else '2026-10-12T18:30:00Z' end,'entry',jsonb_build_object('outcome',case when g%4=0 then 'success' else 'other_order' end,'kycCheck','yes','utrMatch','no'),'status',case when g%19=0 then 'closed' else 'waiting' end),
 'synthetic'||g||'@bank','***@bank','Staff-'||(g%2),'yes','no','WORK-'||g,'000'||g,'synthetic reply'
 from generate_series(1,80)g`,[acct.auth_user_id]);
 await db.exec("update public.admin_deposit_followup_rows set stale_at=now()where id='SYNTHETIC-31';");
 const call=async(filters={},account=acct,offset=0,limit=20)=>(await db.query('select public.workorder_followup_list($1,$2,$3,$4)d',[JSON.stringify(account),JSON.stringify(filters),offset,limit])).rows[0].d;
 return{db,call,acct};}
module.exports={fixture};
