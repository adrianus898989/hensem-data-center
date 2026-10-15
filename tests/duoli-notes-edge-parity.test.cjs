const {loadEdge}=require('./load-edge-typescript.cjs');
const assert=require('node:assert/strict');
const { test }=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const { createHandler }=loadEdge(require('node:path').join(__dirname,'../supabase/functions/duoli-detail-ingest/handler.ts'));
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const here=__dirname;
const fixture=path.join(here,'fixtures/duoli-notes/fixture.sql');
const migration=path.join(here,'../supabase/migrations/20261015063100_duoli_source_business_notes.sql');
const f=(state='present',text='synthetic flow',redacted=false,truncated=false)=>({state,text,redacted,truncated});
const n=()=>({version:1,fields:{condition:f(),remark:f('missing',null)}});
test('actual SQL optional evidence validator and real Edge agree on states/empty/Unicode512',async()=>{
  const d=new PGlite({extensions:{pgcrypto}});
  try{
    await d.exec(fs.readFileSync(fixture,'utf8'));
    await d.exec(fs.readFileSync(migration,'utf8'));
    const values=[null,[],{},n(),{...n(),version:2},{...n(),fields:null},{...n(),fields:{...n().fields,extra:f()}}];
    for(const v of [f('missing',null),f('empty',null),f('invalid',null),f('withheld',null,true),f('present','😀'.repeat(512)),
      f('present','😀'.repeat(513)),f('present','\u00a0'),f('present','\t'),f('present','  '),f('present','bad\u007f'),
      f('present','bad\u0001'),f('present',''),f('missing','not null'),f('withheld',null,false),f('empty',null,true),
      f('present','synthetic',true,true),f('present',3),{...f(),extra:true}]) values.push({version:1,fields:{condition:v,remark:f('missing',null)}});
    for(const value of values){
      const valid=(await d.query('select private.duoli_business_notes_valid($1::jsonb) valid',[JSON.stringify(value)])).rows[0].valid;
      const body={schema_version:2,action:'batch',window_id:'00000000-0000-4000-8000-000000000001',batch_id:'00000000-0000-4000-8000-000000000002',
        platform:'UANG',business:'withdraw',stream:'updated',start_at:'2026-10-04T01:00:00Z',end_exclusive:'2026-10-04T01:10:00Z',observed_at:'2026-10-04T01:10:00Z',
        rows:[{order_id:'synthetic-order',source_order_id:'synthetic-id',platform:'UANG',business_type:'withdraw',order_no:null,member_id:null,
          created_at:'2026-10-04T01:00:00Z',created_day:'2026-10-04',updated_at:'2026-10-04T01:00:00Z',status_code:'3',status_text:'synthetic',currency:null,
          operator:null,provider:null,provider_code:null,channel:null,amount_raw:'10',amount_source:'amount',amount_unit:'source_unverified',
          amount_fields_raw:{amount:'10'},raw:{amount:10},audit_completed_at:null,audit_duration_seconds:null,source_notes:value}]};
      let calls=0;
      const handler=createHandler({env:name=>({SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_server_only_key_1234567890'})[name],fetch:async()=>{
        calls++;return new Response(JSON.stringify({ok:true,schema_version:2,action:'batch',window_id:body.window_id,batch_id:body.batch_id,platform:body.platform,
          business:body.business,stream:body.stream,start_at:body.start_at,end_exclusive:body.end_exclusive,received:1,written:1,replayed:false,
          status_coverage:'requested_all_unverified',query_mode:'source_time_stream'}));
      }});
      const response=await handler(new Request('https://receiver.example',{method:'POST',headers:{'content-type':'application/json','x-api-key':'synthetic-custom-key-for-unit-tests'},body:JSON.stringify(body)}));
      assert.equal(response.status,valid?200:400);
      assert.equal(calls,valid?1:0);
    }
  }finally{await d.close();}
});
