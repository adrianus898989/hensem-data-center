(function(root){
 'use strict';
 const pages=new Set(['overview','providers','provider_payout','collection','payout']);
 const sourceKey=f=>JSON.stringify([f.dataset,f.system||'',f.rawCountry??f.country,f.rawPlatform??f.name,f.direction,f.sourceKind]);
 root.HensemTeamSheetQuery={create({L,reportData,selection,page,providers=()=>[]}){
  let note='';
  const candidates=()=>pages.has(page())?(selection()||[]).filter(p=>p.reportOnly&&p.feeds?.some(f=>f.dataset==='team_sheet')):[];
  const hasReports=()=>candidates().length>0;
  const onlyReports=()=>hasReports()&&(selection()||[]).every(p=>p.reportOnly&&p.feeds?.some(f=>f.dataset==='team_sheet'));
  const context=()=>JSON.stringify([page(),L.serial,L.country,L.from,L.to,L.successFrom,L.successTo,L.successBasis,L.direction,candidates().map(p=>p.id).sort()]);
  const discover=(force=false)=>pages.has(page())?reportData.loadManualCatalog(force):Promise.resolve();
  const fullDay=(from,to)=>/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(from||'')&&/^\d{4}-\d{2}-\d{2}T23:59:59$/.test(to||'');
  async function load({force=false}={}){
   const picked=candidates();if(!picked.length)return null;
   if(!fullDay(L.from,L.to)||(L.successFrom!=null&&L.successFrom!==L.from)||(L.successTo!=null&&L.successTo!==L.to)||L.successBasis==='source_updated'){
    note='团队表格只有整日报；当前小时或独立订单时间筛选无法应用。';reportData.cancel();reportData.restore(null);return null;
   }
   note='';
   // Never send the selected provider to the report loader. Read all providers
   // once for the exact team/day scope and filter the same saved result locally.
   const owner=context(),pending=reportData.load({country:L.country,teams:[...new Set(picked.map(p=>p.team))],platforms:picked.map(p=>p.id),providers:[],direction:['providers','collection'].includes(page())?'charge':['provider_payout','payout'].includes(page())?'withdraw':L.direction||'all',from:L.from,to:L.to},force),reportSerial=reportData.state.serial;
   const result=await pending;reportData.catalog();
   if(owner!==context()||reportSerial!==reportData.state.serial||result!==reportData.state.result)return null;
   if(result&&reportData.state.scope){reportData.state.scope.providers=[...providers()];
    for(const feed of result.feeds||[])if(feed.dataset==='team_sheet')for(const group of feed.groups||[])reportData.state.expanded.add(JSON.stringify([sourceKey(feed),group.grain]));
   }
   return result;
  }
  function render(){if(!hasReports())return'';if(note)return'<section class="live-report-data"><div class="report-note">'+note+'</div></section>';return reportData.render({page:page()});}
  return{hasReports,onlyReports,discover,load,render};
 }};
})(typeof window==='undefined'?globalThis:window);
