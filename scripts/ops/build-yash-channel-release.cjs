// Builds reviewable SQL only; never connects to a database or reads credentials.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const strip=s=>s.replace(/^begin;\s*$/mg,'').replace(/^commit;\s*$/mg,'').replace(/^set local (statement_timeout|lock_timeout)=.*;\s*$/mg,'');
const migration=read('supabase/migrations/20261015140304_yash_channel_provider_classification.sql');
const prepare=()=>"begin;\nset local statement_timeout='15s';set local lock_timeout='500ms';\n"+strip(read('tests/fixtures/yash-channel-shadow-token.sql'))+'\n'+read('supabase/operations/yash-channel-shadow-stage.sql')+'\ncommit;\n';
function promote(id){if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw Error('stage UUID required');return "begin;\nset local statement_timeout='15s';set local lock_timeout='500ms';\nselect private.yash_channel_shadow_preflight('"+id+"');\n"+strip(migration)+"\nselect private.yash_channel_shadow_promote('"+id+"');\ncommit;\n";}
module.exports={prepare,promote};
if(require.main===module){const [mode,out,id]=process.argv.slice(2);if(!out||!['prepare','promote'].includes(mode))throw Error('Usage: node scripts/ops/build-yash-channel-release.cjs prepare|promote OUTPUT.sql [STAGE_UUID]');fs.writeFileSync(out,mode==='prepare'?prepare():promote(id));process.stdout.write(path.resolve(out)+'\n');}
