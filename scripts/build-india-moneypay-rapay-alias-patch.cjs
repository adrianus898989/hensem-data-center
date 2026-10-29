'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const md5=s=>crypto.createHash('md5').update(s).digest('hex'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const body=s=>{const m=s.match(/\bAS (\$[a-zA-Z0-9_]*\$)([\s\S]*?)\1/i);assert(m,'function body');return m[2]};
const expected={
 'private.dashboard_admin_live_provider_alias(text,text)':'016e7206225e117f316e289c55c083e3',
 'private.dashboard_admin_live_confirmed_usdt_provider(text,text)':'1f7ef2b8fa4b2beab20e10cc385c1f9f',
 'private.team_provider_canonical_resolution(jsonb,text,text)':'571193ccfcd421245aa001b0a457d44c'
};
function build(rows){
 assert.equal(rows.length,3);assert.deepEqual(new Set(rows.map(x=>x.signature)),new Set(Object.keys(expected)));
 const updates={'moneypay':'MoneyPay','moneypay-qr':'MoneyPay','rapay':'RAPay','rapay2inr':'RAPay'};
 let manifest,oldManifest;
 const changes=rows.map(row=>{
  assert.equal(row.body_hash,expected[row.signature]);assert.equal(md5(body(row.definition)),row.body_hash);
  assert.equal(row.metadata.prosecdef,false);assert.equal(row.metadata.provolatile,'i');
  assert.deepEqual(row.metadata.proacl,['postgres=X/postgres']);assert.deepEqual(row.metadata.proconfig,['search_path=""']);
  const key=row.signature.includes('canonical_resolution')?'manifest':row.signature.includes('confirmed_usdt')?'confirmed':'aliases',marker='$'+key+'$';
  assert.equal(row.definition.split(marker).length,3);const oldLiteral=row.definition.split(marker)[1],data=JSON.parse(oldLiteral);
  if(key==='manifest'){
   oldManifest=structuredClone(data);assert.equal(data.rules.length,290);assert.equal(data.version,'21fe8f4ff365a529c8b6f213efd1a954f62df5263ea493618f72c185600df645');
   assert.equal(sha(JSON.stringify({contract:data.contract,countryAliases:data.countryAliases,rules:data.rules})),data.version);
   const r=data.rules.find(r=>r.id==='approved-ae7f569839a9');
   assert.deepEqual(r,{id:'approved-ae7f569839a9',match:{country:'印度',currency:'INR'},canonical:'RAPay',aliases:['rapay']});r.aliases.push('rapay2inr');
   const add={id:'confirmed-moneypay-qr-oct29',match:{country:'印度',currency:'INR'},canonical:'MoneyPay',aliases:['moneypay-qr','moneypay']};
   assert(!data.rules.some(r=>r.id===add.id));data.rules.push(add);
   // Retain historical specific overrides and their priority; only new aliases are checked.
   for(const a of [{...r,aliases:['rapay2inr']},add])for(const b of oldManifest.rules){
    const overlap=Object.keys({...a.match,...b.match}).every(k=>a.match[k]===undefined||b.match[k]===undefined||a.match[k]===b.match[k]);
    assert(!(overlap&&a.canonical!==b.canonical&&a.aliases.some(x=>b.aliases.includes(x))),'new alias conflict '+a.id+':'+b.id);
   }
   data.version=sha(JSON.stringify({contract:data.contract,countryAliases:data.countryAliases,rules:data.rules}));
   assert.equal(data.version,'d4caf1bfe525fdcb00a06da09e9a71b4c8bee3336fcc63d74b5b745de1aa2338');
   const restored=structuredClone(data);restored.rules.pop();restored.rules.find(r=>r.id==='approved-ae7f569839a9').aliases=['rapay'];restored.version=oldManifest.version;assert.deepEqual(restored,oldManifest);manifest=data;
  }else{
   const scope=key==='aliases'?data['印度']:data;assert(scope&&typeof scope==='object'&&!Array.isArray(scope));
   for(const [k,v]of Object.entries(updates)){assert(scope[k]===undefined||scope[k]===v,'unexpected baseline '+k);scope[k]=v;}
  }
  const literal=JSON.stringify(data),definition=row.definition.replace(marker+oldLiteral+marker,marker+literal+marker),hash=md5(body(definition));
  return {...row,marker,literal,desired_hash:hash,desired_definition:definition};
 });
 const quote=s=>"'"+s.replace(/'/g,"''")+"'";
 const entries=changes.map(c=>'('+[c.signature,c.marker,c.body_hash,c.desired_hash].map(quote).join(',')+',$alias_payload$'+c.literal+'$alias_payload$)').join(',\n');
 const sql='-- Exact user-confirmed India provider aliases, 2026-10-29. Static constants only.\n'+
'begin;\nset local lock_timeout=\'3s\';set local statement_timeout=\'20s\';\n'+
'do $patch$\ndeclare item record;p pg_proc%rowtype;metadata jsonb;definition text;original text;\nbegin\n'+
' for item in select * from (values\n'+entries+'\n ) v(signature,marker,baseline_hash,desired_hash,replacement) loop\n'+
'  select * into p from pg_proc where oid=to_regprocedure(item.signature);\n'+
'  if not found or p.proowner<>\'postgres\'::regrole or p.proacl::text is distinct from \'{postgres=X/postgres}\' or p.prosecdef or p.provolatile<>\'i\' or p.proconfig is distinct from array[\'search_path=""\']::text[] then raise exception \'india_provider_alias_metadata_or_acl_drift: %\',item.signature;end if;\n'+
'  if md5(p.prosrc)=item.desired_hash then continue;end if;\n'+
'  if md5(p.prosrc)<>item.baseline_hash then raise exception \'india_provider_alias_baseline_drift: %\',item.signature;end if;\n'+
'  metadata:=to_jsonb(p)-\'prosrc\';definition:=pg_get_functiondef(p.oid);\n'+
'  if (length(definition)-length(replace(definition,item.marker,\'\')))/length(item.marker)<>2 then raise exception \'india_provider_alias_marker_drift: %\',item.signature;end if;\n'+
'  original:=split_part(definition,item.marker,2);perform original::jsonb;perform item.replacement::jsonb;\n'+
'  execute replace(definition,item.marker||original||item.marker,item.marker||item.replacement||item.marker);\n'+
'  select * into p from pg_proc where oid=to_regprocedure(item.signature);\n'+
'  if (to_jsonb(p)-\'prosrc\') is distinct from metadata or md5(p.prosrc)<>item.desired_hash then raise exception \'india_provider_alias_installation_drift: %\',item.signature;end if;\n'+
' end loop;\nend;\n$patch$;\nnotify pgrst,\'reload schema\';\ncommit;\n';
 return {sql,manifest,oldManifest,changes};
}
module.exports={build,body};
if(require.main===module){
 const [input,output,manifestOutput]=process.argv.slice(2);assert(input&&output,'baseline JSON and output SQL paths required');
 const result=build(JSON.parse(fs.readFileSync(input,'utf8')));fs.writeFileSync(output,result.sql);
 if(manifestOutput)fs.writeFileSync(manifestOutput,JSON.stringify(result.manifest,null,2)+'\n');
 console.log(JSON.stringify({version:result.manifest.version,rules:result.manifest.rules.length,changes:result.changes.map(x=>({signature:x.signature,old:x.body_hash,next:x.desired_hash})),bytes:Buffer.byteLength(result.sql)}));
}

