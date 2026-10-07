// Browser regression fixture: loopback only, synthetic transport, no credentials.
// Run with node tests/collector-control-pairing-fixture.cjs and open the printed URL.
// Verify click, Enter, button Enter, blank name, refresh, and ?scenario=failed/readonly/slow.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const ui=read('admin-preview/live-collector-control.js');
const bindings=read('admin-preview/live-data.js').split('\n').find(line=>line.includes('window.collectorRefresh=')&&line.includes('window.collectorPair='));
const sandbox=read('src/components/OwnerAdminPreview.tsx').match(/<iframe[^>]+sandbox="([^"]+)"/)[1];
const csp=read('src/lib/ownerPreviewDocument.ts').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(scenario){
 const bootstrap=`
  const scenario=${JSON.stringify(scenario)};let serial=0;
  const render=()=>document.getElementById('content').innerHTML=collectorControl.render();
  const collectorControl=HensemCollectorControl.create({active:()=>true,canEdit:()=>scenario!=='readonly',onChange:render,request:async request=>{
   parent.postMessage({fixture:true,operation:request.operation},'*');
   if(request.operation==='overview')return {ok:true,canEdit:scenario!=='readonly',devices:[]};
   if(request.operation==='createPairing'){
    if(scenario==='failed')throw Error('模拟连接失败，请刷新状态后重试');
    if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,2000));
    return {ok:true,code:'LOCAL_TEST_CODE_'+(++serial),expiresAt:new Date(Date.now()+600000).toISOString()};
   }
   throw Error('此诊断页禁止操作任务或正式服务');
  }});
  ${bindings}
  render();collectorControl.activate();`;
 const doc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+escape(csp)+'"><style>body{font:14px system-ui;margin:18px;color:#182947}button{cursor:pointer;padding:8px 14px}input{padding:8px}code{font-size:20px}'+read('admin-preview/live-collector-control.css')+'</style><main id="content"></main><script>'+ui+'</script><script>'+bootstrap+'</script>';
 return '<!doctype html><meta charset="utf-8"><title>配对按钮隔离回归</title><style>body{font:15px system-ui;margin:20px;background:#f3f6fb;color:#182947}iframe{width:100%;height:680px;border:1px solid #ccd6e7}</style><h1>本地隔离回归 · 不连接正式服务</h1><p>显示的配对码仅为测试数据，不可用于连接电脑。</p><p>场景：'+escape(scenario)+'</p><p id="requests">配对请求数：0</p><iframe title="采集管理隔离回归" sandbox="'+escape(sandbox)+'" srcdoc="'+escape(doc)+'"></iframe><script>let count=0;addEventListener("message",event=>{if(event.source===document.querySelector("iframe").contentWindow&&event.data?.fixture&&event.data.operation==="createPairing")document.getElementById("requests").textContent="配对请求数："+(++count)});</script>';
}
const server=http.createServer((request,response)=>{
 const scenario=new URL(request.url,'http://127.0.0.1').searchParams.get('scenario')||'success';
 if(!['success','failed','readonly','slow'].includes(scenario)){response.writeHead(400);response.end('Unknown fixture scenario');return;}
 response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(page(scenario));
});
server.listen(0,'127.0.0.1',()=>console.log('Pairing regression fixture: http://127.0.0.1:'+server.address().port));
