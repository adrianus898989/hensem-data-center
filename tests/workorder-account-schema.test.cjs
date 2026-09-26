const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const owner='11111111-1111-4111-8111-111111111111',worker='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333';
const sql=fs.readFileSync(path.join(__dirname,'../supabase/workorder-portal-accounts.sql'),'utf8');
test('workorder schema enforces separate identities, owner mutations, RLS and transactional audit',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema auth; create schema private; create role anon; create role authenticated; create role service_role bypassrls;
   create table auth.users(id uuid primary key,email text);
   create table public.dashboard_profiles(auth_user_id uuid primary key,role text,active boolean);
   insert into auth.users values('${owner}','owner@hensem.local'),('${worker}','worker1@workorder.hensem.local'),('${viewer}','viewer@hensem.local');
   insert into public.dashboard_profiles values('${owner}','owner',true),('${viewer}','viewer',true);`);
  await db.exec(sql);
  const insert=(id,name,actor=owner)=>db.query(`insert into public.workorder_portal_accounts(auth_user_id,username,display_name,role,team,platforms,created_by,updated_by)
   values($1,$2,'Worker','agent','M8',array['91CLUB'],$3,$3) returning updated_at`,[id,name,actor]);
  await assert.rejects(insert(viewer,'viewer'),/must not be backend/);
  await assert.rejects(insert(worker,'wrong-alias'),/identity mismatch/);
  await assert.rejects(insert(worker,'worker1',viewer),/Active backend owner/);
  await insert(worker,'worker1');
  assert.equal((await db.query('select count(*)::int n from workorder_portal_account_audit')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from dashboard_profiles')).rows[0].n,2);
  await assert.rejects(db.query("update workorder_portal_accounts set username='different' where auth_user_id=$1",[worker]),/identity mismatch|immutable/);
  await assert.rejects(db.query("update workorder_portal_accounts set role='owner' where auth_user_id=$1",[worker]),/check constraint/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from workorder_portal_accounts'),/permission denied/);
  await assert.rejects(db.query('select * from workorder_portal_account_audit'),/permission denied/);
  await assert.rejects(db.query("insert into workorder_portal_accounts(auth_user_id) values($1)",[worker]),/permission denied/);
  await db.exec('reset role; set role service_role');
  const row=(await db.query('select updated_at from workorder_portal_accounts where auth_user_id=$1',[worker])).rows[0];
  await db.query('update workorder_portal_accounts set active=false,updated_by=$1 where auth_user_id=$2 and updated_at=$3',[owner,worker,row.updated_at]);
  assert.equal((await db.query('select active from workorder_portal_accounts')).rows[0].active,false);
  assert.equal((await db.query('select count(*)::int n from workorder_portal_account_audit')).rows[0].n,2);
  await db.exec('reset role');
  await db.query('update dashboard_profiles set active=false where auth_user_id=$1',[owner]);
  await assert.rejects(db.query('update workorder_portal_accounts set active=true where auth_user_id=$1',[worker]),/Active backend owner/);
  await assert.rejects(db.query('delete from auth.users where id=$1',[worker]),/foreign key constraint/);
 }finally{await db.close();}
});
