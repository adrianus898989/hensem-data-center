/* Production is an authenticated, read-only bridge. Offline samples stay labelled samples. */
(function(){
 if(!window.HENSEM_PRODUCTION||typeof window.hensemLiveRequest!=='function')return;
 const previousRender=render,previousSync=syncFilters;const ratePage=pages.find(p=>p[0]==='rates');if(ratePage){ratePage[2]='费率表';ratePage[4]='费率表'}const teamPage=pages.find(p=>p[0]==='teams');if(teamPage){teamPage[2]='团队 / 平台归属';teamPage[4]='团队 / 平台归属'}const depositPage=pages.find(p=>p[0]==='deposit_tracking');if(depositPage){depositPage[2]='存款未到账-跟进记录';depositPage[4]='存款未到账-跟进记录'}const workPage=pages.find(p=>p[0]==='workorders');if(workPage){workPage[2]='工单未到账';workPage[4]='工单未到账'}if(state.page==='platform_systems')state.page='teams';
 if(!pages.some(p=>p[0]==='payout_config')){pages.push(['payout_config','▣','自动出款配置','AUTO PAYOUT CONFIGURATION','自动出款配置','']);const merchant=navGroupsV3.find(g=>g[0]==='merchant');if(merchant)merchant[3].splice(merchant[3].indexOf('deposit_tracking')+1,0,'payout_config')}
 if(!pages.some(p=>p[0]==='auto_withdraw')){pages.push(['auto_withdraw','▣','自动出款','AUTO WITHDRAWAL','自动出款','']);const merchant=navGroupsV3.find(g=>g[0]==='merchant');if(merchant)merchant[3].splice(merchant[3].indexOf('payout_config')+1,0,'auto_withdraw')}
 if(!pages.some(p=>p[0]==='withdraw_operators')){pages.push(['withdraw_operators','▣','操作人统计','WITHDRAWAL OPERATORS','操作人统计','']);const merchant=navGroupsV3.find(g=>g[0]==='merchant');if(merchant)merchant[3].splice(merchant[3].indexOf('auto_withdraw')+1,0,'withdraw_operators')}
 const supervisorPages={
  workorder_reconciliation:{label:'漏登与状态核对',eyebrow:'WORKORDER RECONCILIATION',summary:'核对疑似漏登、充值成功但登记未更新，以及需人工核验的差异。',source:'需要员工测试站的工单记录、原始工单编号及状态核对结果。',tables:[['待核对记录',['工单 / 订单编号','平台','原始状态','员工记录状态','差异类型','最后核对时间'],'已处理工单不报漏登；不完整或过期来源列为待核验。UTR匹配与表格关联分别核对。']]},
  workorder_workload:{label:'员工工作量',eyebrow:'EMPLOYEE WORKLOAD',summary:'按印度日期和员工查看录入、跟进及到账操作。',source:'需要员工测试站的已认证员工身份、工单分配及操作事件。',tables:[['员工工作记录',['员工','录入次数','跟进次数','跟进案件数','到账案件数','统计日期'],'按服务器操作时间统计；跟进案件去重，到账仅计本订单由非成功改为成功的操作。']]},
  workorder_operation_logs:{label:'操作日志',eyebrow:'WORKORDER OPERATION LOGS',summary:'查看员工对工单的操作时间、内容及变更前后记录。',source:'需要员工测试站保存的操作审计记录，包含真实操作者和变更内容。',tables:[['工单操作记录',['操作时间','员工','操作类型','工单编号','变更前','变更后'],'接通后以已保存的操作记录为准。']]},
  workorder_permissions:{label:'权限与预警',eyebrow:'WORKORDER PERMISSIONS AND ALERTS',summary:'查看员工可操作范围，以及漏登、状态差异和跟进超时的预警规则。',source:'需要员工测试站的账号授权、团队 / 平台范围、预警规则及触发记录。',tables:[['员工权限',['账号','角色','团队 / 平台范围','可用操作'],'员工测试站接通后才能查看或调整权限。'],['预警规则',['规则','触发条件','适用范围','接收人','状态'],'员工测试站接通后才能查看规则和预警记录。']]}
 };
 const isSupervisorPage=key=>key==='workorder_permissions';
 const isWorkorderOperations=key=>['workorders','workorder_reconciliation','workorder_workload','workorder_operation_logs'].includes(key);
 if(!pages.some(p=>p[0]==='deposit_statistics'))pages.push(['deposit_statistics','▤','存款未到账-统计','DEPOSIT STATISTICS','存款未到账-统计','']);
 for(const [id,page]of Object.entries(supervisorPages))if(!pages.some(p=>p[0]===id))pages.push([id,'▤',page.label,page.eyebrow,page.label,'']);
 const supervisorHash=location.hash.replace(/^#/,'');if(Object.prototype.hasOwnProperty.call(supervisorPages,supervisorHash)||supervisorHash==='deposit_statistics')state.page=supervisorHash;
 const merchantGroupIndex=navGroupsV3.findIndex(g=>g[0]==='merchant');
 if(merchantGroupIndex>=0){
  const workorderPages=['workorders','deposit_tracking','deposit_statistics',...Object.keys(supervisorPages)];
  navGroupsV3[merchantGroupIndex][3]=navGroupsV3[merchantGroupIndex][3].filter(id=>!workorderPages.includes(id));
  const workorderGroup=navGroupsV3.find(g=>g[0]==='workorder');if(workorderGroup){workorderGroup[2]='工单运营中心';workorderGroup[3]=workorderPages}else navGroupsV3.splice(merchantGroupIndex+1,0,['workorder','▤','工单运营中心',workorderPages]);if(workorderPages.includes(state.page))state.navGroup='workorder';
  if(workorderPages.includes(state.page))state.navGroup='workorder';
 }
 if(!pages.some(p=>p[0]==='collected_data')){pages.push(['collected_data','▣','平台数据接入','PLATFORM DATA INTAKE','平台数据接入','']);const group=navGroupsV3.find(g=>g[3].includes('overview'));if(group)group[3].splice(group[3].indexOf('overview')+1,0,'collected_data')}if(location.hash==='#collected_data')state.page='collected_data';
 const isWithdrawPage=page=>['auto_withdraw','withdraw_operators'].includes(page);
 if(window.HensemLivePayoutConfig)HensemLivePayoutConfig.configure({request:r=>window.hensemLiveRequest(r),onChange:()=>{if(state.page==='payout_config')render()}});
 const submissionPage=pages.find(p=>p[0]==='events');if(submissionPage){submissionPage[2]='刷单风控';submissionPage[4]='刷单风控'}
 const pendingPage=pages.find(p=>p[0]==='stuck');if(pendingPage){pendingPage[2]='代付中分析';pendingPage[4]='代付中分析'}
 // Keep the existing page/permission key while moving its visible navigation group.
 const pendingAnalysisGroup=navGroupsV3.find(g=>g[0]==='analysis');
 if(pendingAnalysisGroup){for(const group of navGroupsV3)group[3]=group[3].filter(id=>id!=='stuck');pendingAnalysisGroup[3].push('stuck');if(state.page==='stuck')state.navGroup='analysis';}
 // One visible workspace, with the original keys retained for each view's ACL.
 const teamWorkspaceKeys=['teamops','teamcountries','teamplatforms'];
 const isTeamWorkspace=key=>teamWorkspaceKeys.includes(key);
 for(const page of pages)if(isTeamWorkspace(page[0])){page[2]='团队经营';page[4]='团队经营';}
 for(const group of navGroupsV3)group[3]=group[3].filter(id=>!isTeamWorkspace(id));
 const operationsGroup=navGroupsV3.find(g=>g[0]==='merchant');
 if(operationsGroup){operationsGroup[2]='运营中心';operationsGroup[3].unshift(...teamWorkspaceKeys);}else navGroupsV3.push(['merchant','▣','运营中心',[...teamWorkspaceKeys]]);
 for(let i=navGroupsV3.length-1;i>=0;i--)if(!navGroupsV3[i][3].length)navGroupsV3.splice(i,1);
 if(isTeamWorkspace(state.page))state.navGroup='merchant';
 const removedRiskPages=new Set(['dropped','anomaly']);
 const retiredPages=new Set([...removedRiskPages,'channelquality','merchantproviders']);
 const currentPage=key=>key==='channelquality'?'providers':key==='merchantproviders'?'merchants':removedRiskPages.has(key)?'events':key;
 for(const group of navGroupsV3)group[3]=group[3].filter(key=>!retiredPages.has(key));
 for(let i=pages.length-1;i>=0;i--)if(retiredPages.has(pages[i][0]))pages.splice(i,1);
 if(retiredPages.has(state.page)){state.page=currentPage(state.page);state.navGroup=groupForV3(state.page)?.[0];}
 const providerPage=pages.find(p=>p[0]==='providers');if(providerPage){providerPage[2]='代收汇总';providerPage[4]='代收汇总'}
 if(!pages.some(p=>p[0]==='provider_payout')){pages.push(['provider_payout','⇄','代付汇总','PAYOUT SUMMARY','代付汇总','']);const group=navGroupsV3.find(g=>g[3].includes('providers'));if(group)group[3].splice(group[3].indexOf('providers')+1,0,'provider_payout')}
 if(!pages.some(p=>p[0]==='success_analysis'))pages.push(['success_analysis','▦','成功率分析','SUCCESS RATE ANALYSIS','成功率分析','']);
 const successGroup=navGroupsV3.find(g=>g[0]==='analysis');if(successGroup&&!successGroup[3].includes('success_analysis'))successGroup[3].push('success_analysis');
 if(location.hash==='#success_analysis')state.page='success_analysis';
 if(!pages.some(p=>p[0]==='daily_comparison'))pages.push(['daily_comparison','▦','每日对比','DAILY COMPARISON','每日对比','']);
 const dailyGroup=navGroupsV3.find(g=>g[0]==='merchant');if(dailyGroup&&!dailyGroup[3].includes('daily_comparison')){const index=dailyGroup[3].indexOf('merchants');dailyGroup[3].splice(index>=0?index+1:dailyGroup[3].length,0,'daily_comparison');}
 if(location.hash==='#daily_comparison')state.page='daily_comparison';
 if(!pages.some(p=>p[0]==='collector_control')){pages.push(['collector_control','▣','采集管理','COLLECTOR CONTROL','采集管理','']);const group=navGroupsV3.find(g=>g[0]==='system'||g[3].includes('access'));if(group)group[3].push('collector_control')}
 if(!pages.some(p=>p[0]==='channel_status'))pages.push(['channel_status','⇄','平台通道调整','PLATFORM CHANNELS','平台通道调整','']);
 const channelPage=pages.find(p=>p[0]==='channel_status');if(channelPage){channelPage[2]='平台通道调整';channelPage[4]='平台通道调整';}
 for(const group of navGroupsV3)group[3]=group[3].filter(key=>key!=='channel_status');
 const channelGroup=navGroupsV3.find(g=>g[0]==='merchant');if(channelGroup){const index=channelGroup[3].indexOf('daily_comparison');channelGroup[3].splice(index>=0?index+1:channelGroup[3].length,0,'channel_status');}
 if(location.hash==='#channel_status')state.page='channel_status';
 const isChannelStatus=()=>state.page==='channel_status';
 const isSuccessAnalysis=()=>state.page==='success_analysis';
 const isDailyComparison=()=>state.page==='daily_comparison';
 const roleAllowed=(page,action='view')=>['success_analysis','daily_comparison','collector_control','channel_status'].includes(page)
  ? !!window.hensemRoleAccess&&window.hensemRoleAccess.canView===true&&(window.hensemRoleAccess.mode==='owner'||window.hensemRoleAccess.mode==='assigned'&&window.hensemRoleAccess.permissions?.includes(page+'.view')&&window.hensemRoleAccess.permissions?.includes(page+'.'+action))&&typeof window.hensemRoleAllowed==='function'&&window.hensemRoleAllowed(page,action)
  : typeof window.hensemRoleAllowed!=='function'||window.hensemRoleAllowed(page,action);
 const canExportCurrentPage=()=>roleAllowed(state.page,'export')&&(!(isTeamWorkspace(state.page)||isSuccessAnalysis()||isDailyComparison()||isChannelStatus())||roleAllowed(state.page,'query'));
 const teamNavigationEntry=()=>isTeamWorkspace(state.page)&&roleAllowed(state.page)?state.page:teamWorkspaceKeys.find(key=>pages.some(page=>page[0]===key)&&roleAllowed(key));
 function teamWorkspaceNavigation(){return '<div class="section-switcher live-team-workspace"><div class="tabs">'+[['teamops','团队经营'],['teamcountries','国家表现'],['teamplatforms','平台经营']].filter(([key])=>pages.some(page=>page[0]===key)&&roleAllowed(key)).map(([key,label])=>'<button type="button" class="'+(state.page===key?'on':'')+'" aria-pressed="'+(state.page===key)+'" onclick="liveTeamView(\''+key+'\')">'+label+'</button>').join('')+'</div></div>';}
 const collectorControl=window.HensemCollectorControl?.create({request:r=>window.hensemLiveRequest(r),active:()=>state.page==='collector_control',canEdit:()=>roleAllowed('collector_control','edit'),onChange:()=>{if(state.page==='collector_control')render()}});
 window.collectorRefresh=()=>collectorControl?.refresh();window.collectorName=value=>collectorControl?.setName(value);window.collectorPair=event=>collectorControl?.pair(event);window.collectorDesired=(deviceId,taskId,desiredState)=>collectorControl?.desired(deviceId,taskId,desiredState);window.collectorRevoke=deviceId=>collectorControl?.revoke(deviceId);window.collectorCancelRevoke=()=>collectorControl?.cancelRevoke();
 window.hensemCurrentAdminPage=()=>state.page;
 // Remove inaccessible pages before restoring tabs or applying a bookmarked route.
 for(let i=pages.length-1;i>=0;i--)if(!roleAllowed(pages[i][0]))pages.splice(i,1);
 for(let i=navGroupsV3.length-1;i>=0;i--){navGroupsV3[i][3]=navGroupsV3[i][3].filter(id=>pages.some(p=>p[0]===id));if(!navGroupsV3[i][3].length)navGroupsV3.splice(i,1);}
 if(!pages.length){document.getElementById('page').textContent='当前角色没有可用目录，请联系管理员。';return;}
 if(!pages.some(p=>p[0]===state.page))state.page=pages[0][0];
 const retiredBookmark=location.hash.replace(/^#/,'');if(retiredPages.has(retiredBookmark)&&pages.some(p=>p[0]===currentPage(retiredBookmark))){state.page=currentPage(retiredBookmark);state.navGroup=groupForV3(state.page)?.[0];}
 if(isTeamWorkspace(retiredBookmark)&&pages.some(p=>p[0]===retiredBookmark)){state.page=retiredBookmark;state.navGroup='merchant';}
 const initialHostPage=currentPage(window.hensemAdminInitialPage);if(typeof initialHostPage==='string'&&pages.some(p=>p[0]===initialHostPage)){state.page=initialHostPage;state.navGroup=groupForV3(initialHostPage)?.[0];}
 if(isTeamWorkspace(state.page))state.navGroup='merchant';
 const aggregateMode=()=>isSuccessAnalysis()||providerDirection(state.page)||state.page==='orders'||state.page==='merchants'&&L.view!=='trend'||(state.page==='overview'&&!L.overviewAnalysis)?'providers':'full';
 const providerDirection=page=>page==='providers'?'charge':page==='provider_payout'?'withdraw':null;
 const isFlowPage=page=>['collection','payout'].includes(page);
 const fixedDirection=page=>['merchants','success_analysis','daily_comparison'].includes(page)?'all':providerDirection(page)||(['collection','events'].includes(page)?'charge':['payout','stuck'].includes(page)?'withdraw':null);
 const L={pageQueried:false,overviewQueried:false,initialReadComplete:false,comparisonResults:[],comparisonStatus:'idle',comparisonError:'',queryNow:Date.now(),overviewTab:'all',overviewAnalysis:false,overviewSections:null,overviewWorkordersStatus:'idle',queryWarnings:[],queryFailures:[],queryPlatforms:[],queryRetrying:false,queryPaused:false,queryScope:'',multi:{team:[],platform:[],source:[],provider:[],direction:[]},team:'all',providerOptions:[],providerOptionsKey:'',providerOptionsBusy:false,providerOptionsError:'',providerOptionsSerial:0,openMulti:'',multiSearch:{},providerConfigPlatform:'all',loadedView:'full',matrixMode:'range',catalog:[],withdrawCatalog:[],results:[],catalogReady:false,catalogLoading:false,catalogError:'',loading:false,dirty:false,error:'',progress:'',serial:0,currency:'INR',country:'',countryTouched:false,platform:'all',source:'all',provider:'',direction:'all',status:'all',from:'',to:'',successFrom:'',successTo:'',successBasis:'success',retainedContent:null,orderNumber:'',thirdPartyOrderNumber:'',memberId:'',systemOrderId:'',utr:'',page:1,size:20,detail:null,detailBusy:false,view:'business',feeEstimateMode:'current',feePage:1,feeSize:20,feeScope:'all',feeCountry:'all',feeQuery:'',localPage:1,localSize:20,groups:[],fees:null,feeError:'',feeLoading:false,feeSerial:0,feeLookupRows:null,feeLookupLoading:false,feeLookupError:'',feeLookupSerial:0,workorders:null,workordersLoading:false,workordersError:'',workordersScope:'',workordersUnsupported:false,workordersPage:1,workordersSize:20,workordersSerial:0,autoWithdraw:null,autoWithdrawLoading:false,autoWithdrawError:'',autoWithdrawPage:1,autoWithdrawSize:20,autoWithdrawSerial:0,autoWithdrawPlatform:'all',autoWithdrawAccount:'',depositIssues:null,depositIssuesLoading:false,depositIssuesError:'',depositIssuesPage:1,depositIssuesSize:20,depositIssuesSerial:0,depositIssuesDirty:false,depositIssuesPlatform:'all',depositIssuesProvider:'',depositIssuesStatus:'all',depositIssuesQuery:'',providerConfig:null,providerConfigLoading:false,providerConfigError:'',providerConfigPage:1,providerConfigSize:20,providerConfigSerial:0,providerConfigRaw:'',providerConfigCanonical:'',providerConfigCountry:'all',providerConfigDirection:'all',providerConfigStatus:'all',platformAssignments:null,platformAssignmentsLoading:false,platformAssignmentsError:'',platformAssignmentsPage:1,platformAssignmentsSize:20,platformAssignmentsSerial:0,teamPlatformTeam:'all',teamPlatformCountry:'all',teamPlatformSystem:'all',teamPlatformQuery:'',teamPlatformStatus:'all'};
 // Aggregate report pages use query-owned bounded phases. Waiting work does
 // not invoke transport or start its execution deadline.
 const usesReadPhases=page=>!!providerDirection(page)||page==='merchants';
 // Cache policy is independent from the heavy-read phase scheduler.
 const usesQueryCache=page=>['overview','events','success_analysis','collection','payout','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms','orders'].includes(page)||usesReadPhases(page);
 let readPhase=null,deferredMerchantTrend=false;
 const phasedReadBusy=()=>!!readPhase&&readPhase.serial===L.serial&&readPhase.page===state.page;
 function beginReadPhases(serial){if(!usesReadPhases(state.page)&&state.page!=='events')return;readPhase={serial,page:state.page,label:statisticWindowsEnabled()?'读取已准备统计':'读取当期订单'};cancelFeeLookup();window.HensemLiveSyncHealth?.cancel?.();window.hensemLiveCancelRequests?.(['syncHealth']);}
 function setReadPhase(serial,label){if(readPhase?.serial!==serial||serial!==L.serial)return false;readPhase.label=label;render();return true;}
 function endReadPhases(serial){if(readPhase?.serial!==serial)return;const phase=readPhase;readPhase=null;phase.cancelSupplementary?.();if(serial!==L.serial)return;const resumeTrend=deferredMerchantTrend;deferredMerchantTrend=false;render();if(resumeTrend&&state.page==='merchants'&&L.view==='trend')void loadMerchantTrend();}
 window.HensemLiveSyncHealth?.configure({request:q=>window.hensemLiveRequest(q),ready:()=>state.page!=='channel_status'&&!isSupervisorPage(state.page)&&L.pageQueried&&L.catalogReady&&L.initialReadComplete&&!L.loading&&!phasedReadBusy()&&!L.feeLookupLoading&&!submissionAnalysis?.isLoading?.()&&!reportData?.state.loading&&!reportData?.state.catalogBusy&&!L.queryRetrying&&L.comparisonStatus!=='loading'&&L.overviewSections?.status!=='loading'&&!['workordersLoading','autoWithdrawLoading','depositIssuesLoading','depositKycLoading','depositRecoveryLoading','providerConfigLoading','platformAssignmentsLoading','feeLoading'].some(key=>L[key])&&!(state.page==='collected_data'&&collectedPage.state.busy)&&!(state.page==='rates'&&window.HensemLiveRatesRestored?.snapshot().loading)&&!(state.page==='payout_config'&&['indexStatus','snapshotStatus'].some(key=>window.HensemLivePayoutConfig?.state()[key]==='loading')),onChange:()=>window.liveHeader?.()});
 L.feeView='original';if(window.HensemLiveRatesRestored)HensemLiveRatesRestored.configure({request:request=>window.hensemLiveRequest(request),isActive:()=>state.page==='rates',isRestrictedScope:()=>window.hensemDataScope?.mode!=='all',scopeKey:()=>window.hensemDataScope?.identity||'unverified'});
 if(['collection','providers','provider_daily','latency','events'].includes(state.page))L.direction='charge';if(['payout','stuck','provider_payout'].includes(state.page))L.direction='withdraw';window.adminLive=L;
 function normalizePageDirection(){if(state.page==='merchants'||isSuccessAnalysis()||isDailyComparison()){L.direction='all';L.multi.direction=[];if(isSuccessAnalysis()||isDailyComparison()){L.status='all';for(const key of ['orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr'])L[key]='';}return;}if(state.page!=='latency')return;L.direction=['charge','withdraw'].includes(L.direction)?L.direction:'charge';L.multi.direction=[L.direction];}
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const N=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:2});
 let matrixCustom=null;
 const C=v=>v===null?'—':Number(v||0).toLocaleString('en-US');
 const R=(n,d)=>n===null||d===null?'—':Number(d)>0?(Number(n)/Number(d)*100).toFixed(2)+'%':'—';
 const directionName=d=>d==='charge'?'代收':d==='withdraw'?'代付':'全部';
 const statName=s=>({success:'成功',pending:'处理中',failed:'失败',rejected:'拒绝',unknown:'未知',all:'全部状态'}[s]||s);
 const countKeys=['all_count','success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','created_success_count'];
 const amountKeys=['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','created_success_amount'];
 const empty=()=>Object.fromEntries([...countKeys,...amountKeys].map(k=>[k,0]));
 function plus(rows){const sum=empty(),currencies=new Set((rows||[]).map(row=>row.currency).filter(value=>value!==null&&value!==undefined&&String(value)!=='')),mixedCurrencies=currencies.size>1;for(const row of rows){for(const k of countKeys){if(row[k]===null||sum[k]===null)sum[k]=null;else sum[k]+=Number(row[k]||0)}for(const k of amountKeys){if(mixedCurrencies||row[k]===null||sum[k]===null)sum[k]=null;else sum[k]+=Number(row[k]||0)}}for(const key of ['created_success_count','created_success_amount'])if(rows.some(r=>r[key]==null))sum[key]=null;return sum}
 function combine(rows,keys){const groups=new Map();for(const r of rows){const id=keys.map(k=>r[k]??'').join('\x1f');if(!groups.has(id))groups.set(id,{...Object.fromEntries(keys.map(k=>[k,r[k]])),items:[],platformIds:new Set()});const g=groups.get(id);g.items.push(r);if(r.platformId)g.platformIds.add(r.platformId)}return [...groups.values()].map(g=>({...g,...plus(g.items),latest_synced_at:g.items.map(r=>r.latest_synced_at).filter(Boolean).sort().at(-1)||null,platform_count:g.platformIds.size}));}
 const amountBands=direction=>L.amountBandProfiles?.[direction]?.edges;
 const amountLabel=(bucket,direction)=>window.HensemAmountBands?.label(bucket,amountBands(direction))||(bucket==='other'?'其他金额':bucket==='unknown'?'金额缺失':String(bucket));
 const amountBandKeys=direction=>amountBands(direction)?HensemAmountBands.keys():['100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001'];
 const amountNote=direction=>L.matrixMode==='exact'?'精确金额档位；其他金额及缺失单列。':L.amountBandProfiles?.[direction]?L.amountBandProfiles[direction].source+' · 10档；下限含、上限不含，最后一档含上限；超限和金额缺失单列。':'金额区间不重叠；超限和金额缺失单列。';
 const bucketNumber=value=>{if(String(value).startsWith('band:')||['below','above','unknown','other'].includes(value))return window.HensemAmountBands?.rank(value)??Infinity;const text=String(value??'').replaceAll(',',''),match=text.match(/-?\d+(?:\.\d+)?/);return match?Number(match[0]):Infinity};
 function compareBuckets(a,b){return bucketNumber(a.bucket)-bucketNumber(b.bucket)||String(a.bucket).localeCompare(String(b.bucket))}
 async function prepareAmountBands(serial){
  if(!window.HensemAmountBands)return;
  // Provider-only prepared publications do not consume amount distributions.
  // Keep rate lookup in its supplementary lane instead of gating main reads.
  if(statisticWindowsEnabled()&&state.page==='providers'){L.amountBandProfiles=null;return;}
  const currency=L.currency,country=L.country,providers=activeValues('provider',''),platforms=selected();
  // Limits and displayed fees share one validated, cancellable directory. The
  // same snapshot fixes band edges before querying orders and is reused later.
  if(providers.length&&feeLookupPages.has(state.page))await ensureFeeLookup(false,true);
  if(serial!==L.serial||L.dirty)return;
  // Events has no rates request capability. It may reuse an authorized fresh
  // snapshot, otherwise keep the established country reference bands.
  const rates=feeLookupPages.has(state.page)||validFeeSnapshot(feeLookupSnapshot)?L.feeLookupRows:null;
  L.amountBandProfiles=Object.fromEntries(['charge','withdraw'].map(direction=>{
   const fallback=HensemAmountBands.profile({currency,direction}),limits=[];let matched=0;
   const limitRates=(rates||[]).map(r=>({...r,collectFee:r.collectFee||(r.collectLimit?'limit':''),payoutFee:r.payoutFee||(r.payoutLimit?'limit':'')}));
   let missingPairs=0;
   for(const provider of providers){
    let providerMatched=false;
    for(const platform of platforms){
     const candidates=/usdt/i.test(provider)?[]:window.HensemProviderSummary?.feeCandidates({provider,direction,platform:platform.name,source:platform.source},limitRates,country)||[];
     const ranges=candidates.filter(row=>!/usdt|\bUSD\b/i.test(String(row.category||''))).map(row=>direction==='withdraw'?row.payoutLimit:row.collectLimit).filter(limit=>HensemAmountBands.parseLimit(limit,currency));
     if(ranges.length){providerMatched=true;limits.push(...ranges)}else{missingPairs++;limits.push(fallback.edges[0]+'-'+fallback.edges[10])}
    }
    if(providerMatched)matched++;
   }
   const profile=HensemAmountBands.profile({currency,direction,providers:matched?providers:[],limits:matched?limits:[]});
   if(matched&&missingPairs)profile.source='三方限额 + 国家参考范围（部分三方未配置）';
   return [direction,profile];
  }));
 }
 function groupRows(name){return L.results.flatMap(x=>(x.groups?.[name]||[]).map(r=>({...r,source:x.platform?.source,platformId:x.platform?.id,platform:x.platform?.name,country:x.platform?.country,scopeGroup:x.platform?.scopeGroup})));}
 function providerQueryNames(names,platform=null){return window.HensemProviderNames?.queryNames?.(names,platform?.country||L.country,()=>{const selectedIds=new Set(selected().map(p=>p.id));return L.results.filter(r=>platform?r.platform?.id===platform.id:selectedIds.has(r.platform?.id)).flatMap(r=>(r.groups?.provider||[]).filter(row=>(L.direction==='all'||row.direction===L.direction)&&(!platform?.currency||row.currency===platform.currency)).map(row=>row.provider));})??names;}

 function rateKey(value){return String(window.HensemProviderNames?.canonical(value,L.country)??value??'').trim().toLowerCase().replace(/[\s._()（）-]+/g,'')}
 function feeDisplay(row){const percent=row?.collectFee??row?.payoutFee,single=row?.collectSingleFee??row?.payoutSingleFee;const p=percent===null||percent===undefined||String(percent).trim()===''?'':String(percent).trim(),s=single===null||single===undefined||String(single).trim()===''?'':String(single).trim();return p&&s?p+' / 单笔 '+s:p||s||''}
 function feeForRow(row){if(row?.items?.length){const labels=[...new Set(row.items.map(item=>feeForRow({...item,provider:row.provider})))];return labels.length===1?labels[0]:'多档费率'}const rows=Array.isArray(L.feeLookupRows)?L.feeLookupRows:[];if(!rows.length||!row||!row.provider||['未识别通道','未提供'].includes(String(row.provider)))return L.feeLookupLoading?'读取中…':'未匹配';const direction=row.direction==='withdraw'?'payout':'collect',candidates=HensemProviderSummary.feeCandidates(row,rows,L.country);const values=[...new Set(candidates.map(r=>{const value=direction==='payout'?{payoutFee:r.payoutFee,payoutSingleFee:r.payoutSingleFee}:{collectFee:r.collectFee,collectSingleFee:r.collectSingleFee};return feeDisplay(value)}).filter(Boolean))];return values.length===1?values[0]:values.length?'多档费率':'未匹配'}
 const feeLookupPages=new Set(['overview','collection','payout','merchants','merchantproviders','teamops','teamcountries','teamplatforms','providers','provider_payout','risk','time','amount','matrix','provider_daily','latency','orders','daily_comparison','success_analysis']),feeLookupCacheMs=300000;
 let feeLookupBatch=null,feeLookupSnapshot=null,feeLookupIdentity=null,feeLookupIntent=null;
 // Keep every country/platform record used by the existing fee/type consumers.
 // Team-specific native groups retain their geographic alias as well. Unknown
 // native identities use the original complete authorized directory.
 function feeLookupCountries(){
  const aliases={INDIA:'IN','印度':'IN','印度线下':'IN',HK_TEAM:'HK_TEAM','香港':'HK_TEAM',HONGKONG:'HK_TEAM',RED_CRAB:'RED_CRAB','红膏蟹':'RED_CRAB','紅膏蟹':'RED_CRAB',BR_PANGHU:'BR_PANGHU','胖虎巴西':'BR_PANGHU','巴西':'BR','巴基斯坦':'PK','印尼':'ID','越南':'VN','菲律宾':'PH','马来':'MY','缅甸':'MM','尼日利亚':'NG','哥伦比亚':'CO','墨西哥':'MX','智利':'CL'};
  const known=new Set(['IN','BR','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','USDT','BR_NATIVE','HK_TEAM','RED_CRAB','BR_PANGHU']);
  const group=value=>{const key=String(value??'').trim().toUpperCase();return aliases[key]||(known.has(key)?key:null)},platforms=selectedVisible(),countries=new Set();
  if(!platforms.length)return null;
  for(const p of platforms){const native=group(p.scopeGroup??p.scope_group);if(!native)return null;const required=[native,...(['HK_TEAM','RED_CRAB'].includes(native)?['IN']:native==='BR_PANGHU'?['BR']:[])];if(!required.includes(group(p.country)))return null;required.forEach(value=>countries.add(value));}
  return [...countries].sort();
 }
 const feeLookupContext=()=>JSON.stringify([aggregateAccessContext(),feeLookupCountries(),L.catalog.map(p=>[p.id,p.name,p.source,p.sourceName,p.country,p.scopeGroup??p.scope_group,p.currency,p.timezone]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
 const currentFeeIntent=batch=>batch.intent===feeLookupIntent&&batch.querySerial===L.serial&&batch.page===state.page&&(!L.dirty||batch.dirtyScope!==null&&batch.dirtyScope===aggregateQueryScope());
 const validFeeSnapshot=(snapshot,context=feeLookupContext())=>!!snapshot&&snapshot.context===context&&Number.isSafeInteger(snapshot.readAt)&&Date.now()>=snapshot.readAt&&Date.now()-snapshot.readAt<feeLookupCacheMs;
 function clearFeeLookupCache(){const batch=feeLookupBatch;feeLookupBatch=null;feeLookupSnapshot=null;feeLookupIntent=null;L.feeLookupSerial++;L.feeLookupLoading=false;L.feeLookupRows=null;L.feeLookupError='';batch?.controller.abort();}
 function syncFeeLookupIdentity(){const context=feeLookupContext();if(feeLookupIdentity!==null&&feeLookupIdentity!==context){clearFeeLookupCache();L.feeLookupError='费率查询范围或权限已变化，请点击查询或重试费率';}feeLookupIdentity=context;return context;}
 // Navigation may preserve only a complete, still-valid snapshot from the same
 // authority and native lookup scope. Expired/forced reads never restore it.
 function cancelFeeLookup(){feeLookupIntent=null;const batch=feeLookupBatch;if(!batch)return;feeLookupBatch=null;L.feeLookupSerial++;L.feeLookupLoading=false;L.feeLookupError='';const cached=validFeeSnapshot(batch.cachedSnapshot)?batch.cachedSnapshot:null;feeLookupSnapshot=cached;L.feeLookupRows=cached?.rows??null;batch.controller.abort();}
 // Retrying failed platforms restores ownership without refreshing a different reader.
 function resumeFeeLookupIntent(){if(feeLookupPages.has(state.page))feeLookupIntent={context:syncFeeLookupIdentity(),page:state.page};}
 // TTL is checked only for an explicit query. Sorting, pagination and restored
 // tabs keep their displayed snapshot and never turn expiry into background IO.
 function prepareFeeLookupQuery(force=false){if(!feeLookupPages.has(state.page))return;cancelFeeLookup();const context=syncFeeLookupIdentity();if(force||!validFeeSnapshot(feeLookupSnapshot,context))clearFeeLookupCache();feeLookupIntent={context,page:state.page};}
 function readFeeLookupPage(request,signal){const controller=new AbortController();return new Promise((resolve,reject)=>{let settled=false,timer;const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);fn(value)};const cancel=()=>{const error=Error('查询已取消');error.name='AbortError';finish(reject,error);controller.abort()};if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{finish(reject,Error('费率读取超时，请点击重试费率；未读取部分保持未知'));controller.abort()},30000);try{Promise.resolve(window.hensemLiveRequest(request,{signal:controller.signal})).then(value=>finish(resolve,value),error=>finish(reject,error))}catch(error){finish(reject,error)}})}
 async function ensureFeeLookup(force=false,inPhase=false,isCurrent=()=>true){
  if(localPaginationPaint||L.feeLookupLoading||phasedReadBusy()&&!inPhase)return;if((L.loading&&!inPhase||L.restoredPage)&&!force)return;
  const context=syncFeeLookupIdentity();if(!roleAllowed(state.page,'view')||!roleAllowed(state.page,'query')){clearFeeLookupCache();L.feeLookupError='当前角色没有费率查询权限';return;}
  if(force)prepareFeeLookupQuery(true);else if(L.dirty||!feeLookupIntent||feeLookupIntent.context!==context||feeLookupIntent.page!==state.page)return;
  if(Array.isArray(L.feeLookupRows)||L.feeLookupError)return;
  const serial=++L.feeLookupSerial,batch={controller:new AbortController(),cachedSnapshot:validFeeSnapshot(feeLookupSnapshot,context)?feeLookupSnapshot:null,context,countries:feeLookupCountries(),page:state.page,intent:feeLookupIntent,querySerial:L.serial,dirtyScope:force&&L.dirty?aggregateQueryScope():null};feeLookupBatch=batch;L.feeLookupLoading=true;L.feeLookupError='';render();
  const owned=()=>serial===L.feeLookupSerial&&feeLookupBatch===batch&&isCurrent();
  const authorized=()=>context===feeLookupContext()&&roleAllowed(state.page,'view')&&roleAllowed(state.page,'query');
  try{const rows=[];for(const country of batch.countries||[null]){let total=null,offset=0;do{
   const result=await readFeeLookupPage({action:'rates',scopeType:'all',...(country?{country}:{}),offset,limit:500},batch.controller.signal);if(!owned())return;
   if(!authorized()){clearFeeLookupCache();syncFeeLookupIdentity();L.feeLookupError='费率查询范围或权限已变化，请点击查询或重试费率';render();return;}
   if(!currentFeeIntent(batch)){cancelFeeLookup();return;}
   const page=Array.isArray(result?.rows)?result.rows:null,nextTotal=result?.total;if(!page||typeof nextTotal!=='number'||!Number.isSafeInteger(nextTotal)||nextTotal<0||nextTotal>20000||(total!==null&&nextTotal!==total)||(!page.length&&offset<nextTotal)||offset+page.length>nextTotal||rows.length+page.length>20000)throw Error('费率目录不完整，请重试');total=nextTotal;offset+=page.length;rows.push(...page);
  }while(offset<total);}feeLookupSnapshot={rows,context,readAt:Date.now()};L.feeLookupRows=rows;
  }catch(e){if(!owned())return;if(state.page==='providers'&&L.providerReadMode==='published'&&window.HensemProviderPublished?.denied(e)){clearFeeLookupCache();clearPublishedAuthority();render();return;}feeLookupSnapshot=null;L.feeLookupError=e.message||'费率读取失败';L.feeLookupRows=null;
  }finally{if(feeLookupBatch===batch)feeLookupBatch=null;if(serial===L.feeLookupSerial){L.feeLookupLoading=false;render();window.liveMerchantFeeRefresh?.()}}
 }
 window.liveRetryFeeLookup=async()=>{if(!feeLookupPages.has(state.page)||!roleAllowed(state.page,'view')||L.feeLookupLoading)return Promise.resolve();await ensureFeeLookup(true);capturePublishedView();render()};
 const summary=()=>plus(L.results.flatMap(x=>x.summary||[]));
 function option(value,label,current){return '<option value="'+E(value)+'" '+(value===current?'selected':'')+'>'+E(label)+'</option>'}
 function activeValues(key,allValue='all'){const values=Array.isArray(L.multi?.[key])?L.multi[key]:[];const value=L[key];if(value!==undefined&&value!==null&&value!==''&&value!==allValue&&(!values.length||values.length!==1||values[0]!==value))return [value];if(values.length)return values.slice();return []}
 function matchesFilter(key,value,allValue='all'){const values=activeValues(key,allValue);return !values.length||(key==='source'?values.some(source=>orderSource({source})===orderSource({source:value})):values.includes(value))}
 function multiCaption(key,items){const values=activeValues(key);const labels=items.filter(([value])=>values.includes(value)).map(([,label])=>label);return labels.length===0?'全部':labels.length===1?labels[0]:labels.length+' 项已选'}
 function multiSelect(key,label,items,wide=false){const single=state.page==='orders'&&key==='platform';return HensemLiveFilters.multi({key,label:single?'商户（平台，必选一个）':label,single,clearable:!single&&!(key==='direction'&&fixedDirection(state.page)),items:items.filter(([value])=>value!==''&&value!=='all'),values:activeValues(key),open:L.openMulti===key,search:L.multiSearch[key]||'',wide,busy:key==='provider'&&L.providerOptionsBusy,error:key==='provider'?L.providerOptionsError:''})}
 window.liveMultiToggle=function(el){if(!el?.isConnected)return;const key=el.dataset.multi;if(el.open){L.openMulti=key;if(key==='provider')loadProviderOptions();document.querySelectorAll('details[data-multi]').forEach(other=>{if(other!==el)other.open=false})}else if(L.openMulti===key)L.openMulti=''};
 window.liveMultiSearch=function(key,value){L.multiSearch[key]=value;const root=document.querySelector('details[data-multi="'+key+'"]');if(!root)return;let count=0;root.querySelectorAll('.live-multi-option').forEach(row=>{row.hidden=!row.dataset.search.includes(value.toLocaleLowerCase());if(!row.hidden)count++});root.querySelector('.live-multi-empty').hidden=count>0;};
 let pendingSnapshot=null,pendingAnalysis=null,pendingOrders=null,memberCounts=null,submissionAnalysis=null,dailyComparison=null,channelStatus=null,workordersReadCache=null;
 const providerIntake=window.HensemProviderIntake?.create({request:(r,options)=>window.hensemLiveRequest(r,options),accessContext:()=>roleAllowed(state.page,'query')?aggregateAccessContext():''});
 let publishedController=null;
 const cancelDataReads=()=>{cancelPublishedRead();cancelFeeLookup();readPhase?.cancelSupplementary?.();readPhase=null;deferredMerchantTrend=false;cancelAggregateReads();workordersReadCache?.cancel();matrixCustom?.cancel();providerIntake?.cancel();memberCounts?.cancel();submissionAnalysis?.cancel();dailyComparison?.cancel();channelStatus?.cancel();pendingSnapshot?.cancel();pendingAnalysis?.cancel();pendingOrders?.cancel();reportData?.cancel();L.workordersSerial++;L.workordersLoading=false;if(L.overviewWorkordersStatus==='loading')L.overviewWorkordersStatus='idle';window.hensemLiveCancelRequests?.(['aggregate','details','analysisOrders','reportSummary','workorders','pendingSnapshot','pendingAnalysis','pendingOrders','memberDaily','submissionAnalysis','intakeCoverage','channelStatus','autoWithdraw','providerSnapshot']);};
 window.liveMultiClear=function(key){if(!['team','platform','source','provider','direction'].includes(key)||key==='platform'&&state.page==='orders'||key==='direction'&&(fixedDirection(state.page)||state.page==='latency'))return;L.openMulti='';L.multiSearch[key]='';setMultiValues(key,[])};
 window.liveMultiAll=function(key,all){if(state.page==='orders'&&key==='platform'&&all)return;const root=document.querySelector('details[data-multi="'+key+'"]');if(!root)return;const values=all?[...new Set([...activeValues(key),...Array.from(root.querySelectorAll('.live-multi-option:not([hidden]) input')).map(e=>e.value)])]:[];setMultiValues(key,values)};
 document.addEventListener?.('click',e=>{if(e.target.closest?.('.live-multi'))return;L.openMulti='';document.querySelectorAll('details[data-multi]').forEach(el=>el.open=false)});
 document.addEventListener?.('keydown',e=>{if(e.key!=='Escape')return;document.querySelectorAll('details[data-multi][open]').forEach(el=>{el.open=false;el.querySelector('summary')?.focus()});L.openMulti=''});
 function clearProviderOptions(){L.providerOptionsSerial++;L.providerOptions=[];L.providerOptionsKey='';L.providerOptionsBusy=false;L.providerOptionsError='';window.hensemLiveCancelRequests?.(['providerOptions']);renderProviderFilters()}
 async function loadProviderOptions(force=false){
   if(!L.country||!countrySelectable(L.country)){clearProviderOptions();return}if(isSupervisorPage(state.page)||isChannelStatus()||!L.catalogReady)return;if(state.page==='orders'&&!orderPlatform()){clearProviderOptions();return}const ids=selected().map(p=>p.id).sort();if(!ids.length){clearProviderOptions();return}const key=JSON.stringify([ids,L.direction]);if(!force&&key===L.providerOptionsKey)return;
   const serial=++L.providerOptionsSerial;L.providerOptionsKey=key;L.providerOptionsBusy=true;L.providerOptionsError='';renderProviderFilters();
   try{const result=await window.hensemLiveRequest({action:'providerOptions',platformIds:ids,direction:L.direction});if(serial!==L.providerOptionsSerial)return;L.providerOptions=[...new Set([...activeValues('provider',''),...(result.providers||[]).map(p=>window.HensemProviderNames?.canonical(p,L.country)??p).filter(Boolean)])].sort();}
   catch(e){if(serial!==L.providerOptionsSerial)return;L.providerOptionsError=e.message||'归类目录读取失败';L.providerOptionsKey='';}
   finally{if(serial===L.providerOptionsSerial){L.providerOptionsBusy=false;renderProviderFilters()}}
 }

 function renderProviderFilters(){if(isSupervisorPage(state.page)||navigationBatch||renderingPage||['collected_data','data_health','rates','deposit_tracking','deposit_statistics','payout_config','auto_withdraw','withdraw_operators','provider_config','teams','platform_systems'].includes(state.page)||gaps[state.page])return;filters()}
 const countrySelectable=value=>window.HensemLiveReportData?.countrySelectable?.(value)!==false;
 function select(key,label,items,wide=false){if(['country','feeCountry'].includes(key)){items=items.filter(([value])=>countrySelectable(value));if(!items.some(([value])=>value===L[key]))items=[['','请选择国家'],...items];}return '<div class="live-field '+(wide?'wide':'')+'"><label for="live-'+key+'">'+label+'</label><select '+(key==='country'?'required aria-required="true" ':'')+'id="live-'+key+'" onchange="liveSet(\''+key+'\',this.value)">'+items.map(([v,l])=>key==='status'&&v==='success'&&wgSuccessFilterBlocked()?'<option value="success" disabled '+(L.status==='success'?'selected ':'')+'title="'+E(successFilterNote())+'">成功（成功时间未提供）</option>':option(v,l,L[key])).join('')+'</select></div>'}
 function input(key,label,type='text',extra=''){return '<div class="live-field '+(type==='datetime-local'?'clock':'')+'"><label for="live-'+key+'">'+label+'</label><input id="live-'+key+'" type="'+type+'" '+(type==='datetime-local'?'step="1"':'maxlength="200" placeholder="完整值精确匹配"')+' value="'+E(L[key])+'" onchange="liveSet(\''+key+'\',this.value)" '+extra+'></div>'}
 // Display identity stays separate from native query and permission keys.
 const displayIdentity=p=>window.HensemLiveReportData?.normalizeIdentity(p)||p;
 const displayPlatformAllowed=p=>window.HensemLiveReportData?.displayAllowed?.(p)!==false;
 const teamLabel=(team,name='',country='')=>displayIdentity({team,name,country}).team||'__unassigned__';
 const platformTeam=p=>displayIdentity(p).team||'__unassigned__';
 const orderSource=p=>String(p?.source||'').toLowerCase().replaceAll('_','');
 const newarUpdatedClockSelectable=()=>L.direction==='withdraw'&&selected().length>0&&selected().every(platform=>orderSource(platform)==='newar');
 const sourceSuccessTimeUnavailable=(platform,result,direction)=>{const key=direction+'SuccessTimeAvailable',caps=result?.capabilities||result?.platform?.capabilities||platform?.capabilities;if(orderSource(platform)==='panda')return caps?.successCoverageAvailable!==true||caps?.[key]!==true||platform?.capabilities?.[key]===false;if(orderSource(platform)==='newar'&&direction==='withdraw'&&(result?.successBasis==='source_updated'||!result&&statisticWindowsEnabled()&&newarUpdatedClockSelectable()&&L.successBasis==='source_updated'))return !!result&&(result.withdrawSecondaryTimeAvailable===false||caps?.withdrawSecondaryTimeAvailable===false);return result?.successTimeAvailable===false||caps?.successTimeAvailable===false||platform?.capabilities?.successTimeAvailable===false||result?.[key]===false||caps?.[key]===false||platform?.capabilities?.[key]===false||direction==='withdraw'&&orderSource(platform)==='wg'};
 const updatedSuccessBasis=(platform,result)=>result?.successBasis==='source_updated'||[result?.successTimeBasis,result?.capabilities?.successTimeBasis,result?.platform?.capabilities?.successTimeBasis,platform?.capabilities?.successTimeBasis].includes('order_updated_at');
 const completedSuccessBasis=(platform,result)=>[result?.successTimeBasis,result?.capabilities?.successTimeBasis,result?.platform?.capabilities?.successTimeBasis,platform?.capabilities?.successTimeBasis].includes('source_completed_at');
 const successTimeLabel=(platform,result)=>result?.successBasis==='source_updated'?'成功统计时间（源订单更新时间）':updatedSuccessBasis(platform,result)?'成功统计时间（订单更新时间）':completedSuccessBasis(platform,result)?'成功时间（源订单完成时间）':'成功时间';
 const successScope=()=>[...(L.results||[]).map(result=>({platform:result.platform,result})),...(L.queryPlatforms||[]).map(platform=>({platform})),...(L.detail?[{platform:L.detail.platform,result:L.detail}]:[])];
 const successBasisLabel=()=>{if(newarUpdatedClockSelectable()&&L.successBasis==='source_updated')return '源订单更新时间';const items=successScope(),updated=items.filter(x=>updatedSuccessBasis(x.platform,x.result)),completed=items.filter(x=>completedSuccessBasis(x.platform,x.result));return updated.length===items.length&&updated.length?'订单更新时间':completed.length===items.length&&completed.length?'源订单完成时间':updated.length||completed.length?'成功时间（'+[...new Set(updated.map(x=>orderSource(x.platform)==='duoli'?'多利按更新时间':orderSource(x.platform)==='newar'?'新中台按源订单更新时间':'按源订单更新时间')),completed.length?'按源完成时间':''].filter(Boolean).join('；')+'）':'成功时间'};
 const successBasisNote=()=>[successScope().some(x=>orderSource(x.platform)==='duoli'&&updatedSuccessBasis(x.platform,x.result))?'多利成功按成功状态＋订单更新时间统计，不代表实际到账时间。':'',successScope().some(x=>orderSource(x.platform)==='newar'&&x.result?.successBasis==='source_updated')?'新中台出款按成功状态和源订单更新时间统计，不代表实际到账时间；到账时效不可统计。':'',successScope().some(x=>orderSource(x.platform)==='kb'&&completedSuccessBasis(x.platform,x.result))?'KB成功按成功状态＋源订单完成时间统计；耗时为订单处理耗时，不代表银行到账时效。':'',successScope().some(x=>orderSource(x.platform)==='panda')?'熊猫按创建区间读取已入库订单；充值源完成时间仅逐笔展示，成功时间窗口尚未完整核验；提现仅已审核范围；不与旧日报快照相加。':''].filter(Boolean).join(' ');
 const processingLatency=caps=>caps.latencyAvailable===true&&caps.latencyBasis==='order_processing_duration';
 const latencyUnavailable=direction=>L.results.some(result=>{const raw=result.capabilities||result.platform?.capabilities||{},caps=orderSource(result.platform)==='panda'?{...raw,latencyAvailable:raw.successCoverageAvailable===true&&raw[direction+'LatencyAvailable']===true}:raw;return caps.latencyAvailable===false||caps.paymentSuccessTimeAvailable===false&&!processingLatency(caps)||orderSource(result.platform)==='newar'&&direction==='withdraw'&&(result.successBasis==='source_updated'||caps.withdrawLatencyAvailable===false)||sourceSuccessTimeUnavailable(result.platform,result,direction)});
 const successTimeUnavailable=direction=>L.results.some(result=>sourceSuccessTimeUnavailable(result.platform,result,direction))||(L.queryPlatforms||[]).some(platform=>sourceSuccessTimeUnavailable(platform,L.results.find(result=>result.platform?.id===platform.id)||null,direction));
 const successRowsTimeUnavailable=(rows,direction)=>{
  const unavailable=[...(L.results||[]).map(result=>({platform:result.platform,result})),...(L.queryPlatforms||[]).map(platform=>({platform,result:L.results.find(result=>result.platform?.id===platform.id)}))].filter(item=>sourceSuccessTimeUnavailable(item.platform,item.result,direction));
  if(!unavailable.length)return false;
  // Keep existing source rules. NEW_AR's missing clock masks only rows that
  // include that native platform; another platform's own facts remain usable.
  if(unavailable.some(item=>orderSource(item.platform)!=='newar')||!rows?.length)return true;
  const ids=rows.map(row=>Array.from(row.platformIds||[row.platformId]).filter(Boolean));if(ids.some(values=>!values.length))return true;
  const selectedIds=new Set(ids.flat());return unavailable.some(item=>selectedIds.has(item.platform?.id));
 };
 // Empty sources can have no summary row to carry NULL. Preserve the capability
 // at the direction total without inventing an order row or a success cohort.
 const successTimeSummary=(rows,direction)=>{const sum=plus(rows);return pandaAnalysisRow(successRowsTimeUnavailable(rows,direction)?{...sum,success_count:null,success_amount:null}:sum,direction);};
 const unavailableSuccessNote='WG 提现尚未提供已核实成功时间；操作时间不能当作成功时间。成功时间口径的金额、笔数、成功率和到账时效显示 —；创建单当前成功数另列。';
 const wgSuccessFilterNote='WG 提现尚未提供已核实成功时间，不能按成功时间筛选；请选择全部状态按创建时间查询（仍可查当前成功订单），或单独选择代收后按成功时间查询。不会自动更换统计口径。';
 const wgSuccessFilterBlocked=p=>(p?[p]:selected()).some(platform=>(L.direction==='all'?['charge','withdraw']:[L.direction]).some(direction=>sourceSuccessTimeUnavailable(platform,null,direction)));
 const successFilterNote=p=>(p?[p]:selected()).some(platform=>orderSource(platform)==='panda')?'熊猫成功时间窗口尚未完整核验，暂不支持成功时间筛选；请选择全部状态按创建时间查看已入库订单。提现仅含已审核订单。':(p?[p]:selected()).some(platform=>orderSource(platform)==='newar'&&sourceSuccessTimeUnavailable(platform,null,'withdraw'))?'新中台出款缺少付款成功时间。请选择全部状态按创建时间查看订单；单选新中台出款可改用源订单更新时间统计。':(p?[p]:selected()).some(platform=>orderSource(platform)==='duoli')?'多利成功统计时间尚未提供；请选择全部状态按创建时间查询。':(p?[p]:selected()).some(platform=>orderSource(platform)==='kb')?'KB成功时间尚未提供；请选择全部状态按创建时间查询。':wgSuccessFilterNote;
 const newarCreatedSuccessBasis='按各平台当地申请时间选单，统计已入库订单当前成功状态；金额为申请金额，不代表该期间实际到账金额。';
 function newarCreatedSuccessRows(){
  if(L.direction==='charge')return [];
  return L.results.filter(result=>{const caps=result.capabilities||result.platform?.capabilities||{};return orderSource(result.platform)==='newar'&&(caps.withdrawSuccessTimeAvailable===false||caps.withdrawSecondaryTimeUnavailableReason==='payment_success_time_missing');}).flatMap(result=>{
   const platform=result.platform,rows=(result.summary||[]).filter(row=>row.direction==='withdraw'),currencies=[...new Set(rows.map(row=>row.currency||''))],start=Date.parse(result.startAt),end=Date.parse(result.endAt),zone=platform.timezone;
   const range=zone&&Number.isFinite(start)&&Number.isFinite(end)&&start<end?localClock(start,zone).replace('T',' ')+' 至 '+localClock(end-1000,zone).replace('T',' ')+' · '+zone:'申请时间范围待确认';
   return (currencies.length?currencies:[platform.currency||'']).map(currency=>{const selected=rows.filter(row=>(row.currency||'')===currency),sum=selected.length?plus(selected):{created_success_amount:null,created_success_count:null};return [E(platform.name),E(range),N(sum.created_success_amount),C(sum.created_success_count),E(currency||'币种待确认')];});
  });
 }
 function newarSuccessClockNotice(){
  if(L.dirty||L.loading||!L.pageQueried||!statisticWindowsEnabled()||L.direction==='charge')return '';
  const results=L.results.filter(result=>orderSource(result.platform)==='newar'),updated=results.some(result=>result.successBasis==='source_updated'),missing=results.filter(result=>sourceSuccessTimeUnavailable(result.platform,result,'withdraw')),missingPaid=missing.filter(result=>result.successBasis!=='source_updated');
  if(!missing.length&&!updated)return '';
  const current=newarCreatedSuccessRows(),cohort=current.length?'<div data-newar-created-success><strong>新中台出款 · 申请单当前成功</strong><p>'+newarCreatedSuccessBasis+'</p>'+table(['平台','申请时间（平台当地，含起止秒）','申请单当前成功金额','申请单当前成功笔数','币种'],current)+'</div>':'';
  return '<div class="live-panel-note" data-newar-success-clock role="status">'+(missing.length?(missingPaid.length?'新中台出款缺少付款成功时间，无法确认该窗口完整成功额；金额、笔数和成功率显示 —，不能当作 0。旧订单也可能影响此窗口。':'新中台出款的源订单更新时间未完整提供；金额、笔数和成功率显示 —，不能当作 0。'):'')+(updated?'<br>新中台出款按成功状态和源订单更新时间统计；不代表实际到账时间，到账时效不可统计。':'')+cohort+'</div>';
 }
 function wgSourceNotice(){
  if(L.dirty||L.loading||!L.pageQueried||!['overview','orders','providers','provider_payout','collection','payout','time','amount','matrix','provider_daily','latency','teamops','teamcountries','teamplatforms','merchants','merchantproviders'].includes(state.page))return '';
  const results=L.results.filter(result=>orderSource(result.platform)==='wg'),detailWg=orderSource(L.detail?.platform)==='wg';if(!results.length&&!detailWg)return '';
  const notes=visibleDirections().map(direction=>{const rows=results.flatMap(result=>result.summary||[]).filter(row=>row.direction===direction);if(!rows.length)return '';const sum=plus(rows);return directionName(direction)+'创建单当前成功 '+C(sum.created_success_count)+' / '+C(sum.all_count)+' 笔（'+R(sum.created_success_count,sum.all_count)+'）'}).filter(Boolean);
  return '<div class="live-panel-note" data-wg-existing-source>WG 实时明细 · '+(notes.length?notes.map(E).join('；')+'。':'')+'创建单按各平台当地创建日期统计，不与旧 WG 日报相加。'+(L.direction!=='charge'&&(successTimeUnavailable('withdraw')||detailWg)?'<strong>'+unavailableSuccessNote+'</strong>':'')+'</div>';
 }
 function duoliSourceNotice(){
  if(L.dirty||L.loading||!L.pageQueried||!['overview','orders','providers','provider_payout','collection','payout','time','amount','matrix','provider_daily','latency','teamops','teamcountries','teamplatforms','merchants','merchantproviders'].includes(state.page))return '';
  const results=L.results.filter(result=>orderSource(result.platform)==='duoli'),detail=orderSource(L.detail?.platform)==='duoli';if(!results.length&&!detail)return '';
  return '<div class="live-panel-note" data-duoli-existing-source>多利成功按成功状态＋订单更新时间统计；不代表实际到账时间。</div>';
 }
 function kbSourceNotice(){
  if(L.dirty||L.loading||!L.pageQueried||!['overview','orders','providers','provider_payout','collection','payout','time','amount','matrix','provider_daily','latency','teamops','teamcountries','teamplatforms','merchants','merchantproviders'].includes(state.page))return '';
  if(providerDirection(state.page))return ''; // Available in the summary's compact statistics help.
  const items=successScope().filter(x=>orderSource(x.platform)==='kb'&&completedSuccessBasis(x.platform,x.result));
  return items.length?'<div class="live-panel-note" data-kb-existing-source>KB成功按源订单完成时间统计；耗时为订单处理耗时。</div>':'';
 }
 function pandaCoverageMatches(result,request,prepared=false){
  const coverage=result?.pandaCoverage,rows=coverage?.directions,ds=request.direction==='all'?['charge','withdraw']:[request.direction];
  const same=(a,b)=>Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b),prefix=coverage?.reason==='verified_created_prefix_only';
  if(result?.platform?.id!==request.platformId||!same(result.startAt,request.startAt)||!same(result.endAt,request.endAt)||!Array.isArray(rows))return false;
  if(prefix){
   // Only a prepared, strictly verified prefix may keep the original future
   // request window. Its source cutoff is distinct from publication time.
   if(!prepared||!result._preparedPublication||result._preparedPublication.calculationComplete!==true||result._preparedPublication.sourceComplete!==false||coverage.complete!==false||coverage.requestedComplete!==false||coverage.effectiveComplete!==true||coverage.sourceComplete!==false||coverage.timeBasis!=='created_at'||coverage.statisticBasis!=='current_stored_status'||!same(coverage.requestedStartAt,request.startAt)||!same(coverage.requestedEndAt,request.endAt)||!same(coverage.effectiveStartAt,request.startAt)||!same(coverage.effectiveEndAt,coverage.dataCutoff)||!(Date.parse(request.startAt)<Date.parse(coverage.dataCutoff)&&Date.parse(coverage.dataCutoff)<Date.parse(request.endAt)&&Date.parse(coverage.dataCutoff)<=Date.parse(result.asOf))||rows.length!==ds.length)return false;
  }else if(coverage?.complete!==true)return false;
  return ds.every(direction=>{
   const found=rows.filter(r=>r.direction===direction);return found.length===1&&found[0].complete===true&&same(found[0].startAt,request.startAt)&&same(found[0].endAt,prefix?coverage.dataCutoff:request.endAt);
  });
 }
 const pandaAggregatePage=()=>['time','amount','matrix','provider_daily'].includes(state.page);
 function pandaAnalysisRow(row,direction=row.direction){
  if(!selected().some(p=>orderSource(p)==='panda'))return row;
  const future=Number.isInteger(Number(row.hour))&&row.hour!==null&&row.hour!==undefined&&(L.results||[]).some(result=>{
   const c=result.pandaCoverage;if(c?.reason!=='verified_created_prefix_only')return false;
   const zone=result.platform.timezone,start=localClock(Date.parse(c.effectiveStartAt),zone),last=localClock(Date.parse(c.dataCutoff)-1,zone);
   return start.slice(0,10)===last.slice(0,10)&&Number(row.hour)>Number(last.slice(11,13));
  });
  const unknown=future?Object.fromEntries(['all','created_success','pending','failed','rejected','unknown'].flatMap(key=>[key+'_count',key+'_amount']).map(key=>[key,null])):{};
  return {...row,...unknown,success_count:null,success_amount:null,...(direction==='withdraw'?{pending_count:null,pending_amount:null}:{})};
 }
 function pandaCurrentRequest(platform){
  if(statisticWindowsEnabled())return {platformId:platform.id,direction:L.direction,...statisticRequest(platform)};
  const range=HensemLiveCompare.windowFor(L.from,L.to,platform.timezone,L.queryNow);
  return range.valid?{platformId:platform.id,direction:L.direction,startAt:instant(range.currentFrom,platform.timezone),endAt:instant(range.currentTo,platform.timezone,true)}:null;
 }
 function pandaCurrentWindowMatches(result,platform){
  try{const request=pandaCurrentRequest(platform);return request&&result?.platform?.id===platform.id&&Date.parse(result.startAt)===Date.parse(request.startAt)&&Date.parse(result.endAt)===Date.parse(request.endAt);}catch{return false;}
 }

 function pandaCurrentCoverage(){
  const chosen=selected(),platforms=chosen.filter(p=>orderSource(p)==='panda');
  const results=new Map((state.page==='orders'?[L.detail].filter(Boolean):L.results||[]).filter(r=>r.platform?.id).map(r=>[r.platform.id,r]));
  const complete=platforms.length>0&&!L.loading&&!L.queryRetrying&&!L.queryPaused&&platforms.every(p=>{
   if((L.queryFailures||[]).some(f=>f.id===p.id))return false;
   try{const request=pandaCurrentRequest(p);return request&&pandaCoverageMatches(results.get(p.id),request,true);}catch{return false;}
  })&&(!pandaAggregatePage()||!(L.queryFailures||[]).length&&chosen.every(p=>pandaCurrentWindowMatches(results.get(p.id),p)));
  return {platforms,results,complete};
 }
 function pandaAggregateBlocked(){const coverage=pandaCurrentCoverage();return pandaAggregatePage()&&coverage.platforms.length>0&&!coverage.complete;}
 function pandaAggregateBlockedView(){return '<div class="live-status live-error" data-panda-aggregate-blocked role="status"><strong>所选窗口完整性尚未确认</strong><p>暂不显示汇总、图表或分析明细，未确认数据不按 0 计算。可在订单列表查看已入库明细；混合选择时，可取消未完成平台后重新查询。</p><button type="button" class="btn" onclick="liveQuery(true)">重新核验</button></div>';}
 function pandaSourceNotice(){
  if(L.dirty||L.loading||!L.pageQueried)return '';
  const {platforms,results,complete}=pandaCurrentCoverage();if(!platforms.length)return '';
  const prefixes=complete?platforms.map(p=>({platform:p,coverage:results.get(p.id)?.pandaCoverage})).filter(x=>x.coverage?.reason==='verified_created_prefix_only'):[];
  const notes=complete||state.page==='orders'?platforms.flatMap(p=>(results.get(p.id)?.summary||[]).map(r=>(r.direction==='withdraw'?'已审核提现':'充值')+'创建单当前成功 '+C(r.created_success_count??null)+' / '+C(r.all_count??null)+' 笔')):[];
  const label=prefixes.length?'已核验至 '+prefixes.map(x=>E(x.platform.name)+' '+E(formatTime(x.coverage.dataCutoff,x.platform.timezone))).join('；')+'（不含，非全天）':complete?'所选创建窗口已完整采集':'完整性尚未确认';
  return '<div class="live-panel-note" data-panda-existing-source><strong>'+label+'</strong> · 熊猫原生订单明细 · 按平台当地时间。充值源完成时间仅逐笔展示，成功时间窗口尚未完整核验；提现仅包含已审核订单，不统计成功时间轴、时效或代付中存量。'+(notes.length?notes.map(E).join('；')+'。':'')+'旧日报快照独立展示，不与明细相加。</div>';
 }
 const backendSource=value=>!['','reports','report','sheet','google_sheets','recharge_review','withdraw_review','unknown'].includes(String(value||'').toLowerCase());
 const pandaNativePage=()=>['orders','time','amount','matrix','provider_daily'].includes(state.page);
 const queryableSource=p=>orderSource(p)==='panda'?pandaNativePage():!p.source||['ar','newar','game66','lg','wg','duoli','kb'].includes(orderSource(p));
 const unsupportedLgFields=new Set(['systemOrderId','thirdPartyOrderNumber','utr','recordedFee']);
 function orderCapability(p,key){if(!p||p.reportOnly||orderSource(p)==='lg'&&unsupportedLgFields.has(key))return false;if(typeof p.capabilities?.[key]==='boolean')return p.capabilities[key];return key==='systemOrderId'?orderSource(p)==='newar':key==='thirdPartyOrderNumber'?['newar','game66'].includes(orderSource(p)):false;}
 function orderFieldValue(p,key,value){return p?.capabilities?.[key]===false||orderSource(p)==='lg'&&unsupportedLgFields.has(key)?null:value;}
 const orderSearchAttributes=(key,label)=>orderCapability(orderPlatform(),key)?'':'disabled title="当前来源未提供可检索的'+label+'"';
 function visibleCatalog(){
  const rows=[...(reportData?.catalog()||L.catalog.filter(p=>orderSource(p)!=='panda').map(displayIdentity)),...(pandaNativePage()?L.catalog.filter(p=>orderSource(p)==='panda').map(displayIdentity):[])],chosen=new Set(activeValues('platform'));
  const currentSuperlg=new Set(rows.filter(p=>!p.reportOnly&&orderSource(p)==='lg'&&p.country==='菲律宾'&&String(p.name).toUpperCase()==='SUPERLG').map(platformTeam));
  // Historical operator reports keep their own source keys and dedicated page.
  // Hide the redundant directory option, without widening a retained selection.
  return rows.filter(p=>displayPlatformAllowed(p)&&!(p.reportOnly&&p.historicalSource&&p.country==='菲律宾'&&String(p.name).toUpperCase()==='SUPERLG'&&currentSuperlg.has(platformTeam(p))&&!chosen.has(p.id)));
 }
 function clearHiddenDashboardView(){
  const current=new Map([...(L.catalog||[]),...(L.withdrawCatalog||[])].filter(p=>p.id).map(p=>[p.id,p]));
  const hidden=p=>p&&(!displayPlatformAllowed(p)||current.has(p.id)&&!displayPlatformAllowed(current.get(p.id)));
  if(![...(L.queryPlatforms||[]),...(L.results||[]).map(r=>r.platform),...(L.comparisonResults||[]).map(r=>r.platform),L.detail?.platform].some(hidden))return false;
  // A paused team's old tab/result cannot remain visible after a directory
  // refresh or be restored/exported under the remaining teams' selection.
  L.serial++;cancelDataReads();providerOrders.cancel();window.closeDrawer?.();
  Object.assign(L,{pageQueried:false,overviewQueried:false,dirty:true,loading:false,queryRetrying:false,queryPaused:false,results:[],comparisonResults:[],comparisonStatus:'idle',comparisonError:'',detail:null,detailBusy:false,workorders:null,workordersLoading:false,workordersScope:'',workordersError:'',queryPlatforms:[],queryFailures:[],queryWarnings:[],queryScope:'',retainedContent:null,providerPublished:null,publishedWindow:null,providerReadMode:'live',providerIntake:null,providerComparisonIntake:null,overviewIntake:null,overviewSections:null,merchantTrend:null,successApplied:null,providerOptions:[],providerOptionsKey:''});
  channelStatus?.restore(null);dailyComparison?.restore(null);submissionAnalysis?.restore(null);memberCounts?.restore(null);pendingSnapshot?.restore(null);pendingAnalysis?.restore(null);analysis?.restore?.(null);matrixCustom?.restore(null);
  return true;
 }
 const teamCatalog=(catalog=visibleCatalog())=>catalog.filter(p=>matchesFilter('team',platformTeam(p)));
 const platformCandidates=(catalog=visibleCatalog())=>teamCatalog(catalog).filter(p=>!!L.country&&p.country===L.country&&matchesFilter('source',p.source));
 function reconcileScopeSelections(){const sourceSet=new Set(teamCatalog().filter(p=>p.country===L.country).map(p=>p.source).filter(backendSource).map(source=>orderSource({source}))),sources=activeValues('source').filter(source=>sourceSet.has(orderSource({source})));L.multi.source=sources;L.source=sources.length===1?sources[0]:'all';const candidates=platformCandidates(),platforms=[...new Set(activeValues('platform').map(id=>candidates.find(p=>p.id===id||(p.aliasPlatformIds||[]).includes(id))?.id).filter(Boolean))];L.multi.platform=platforms;L.platform=platforms.length===1?platforms[0]:'all';}
 function orderCoverageLabel(){if(isDailyComparison())return '';if(L.dirty||!L.queryPlatforms?.length||L.queryScope!==aggregateQueryScope())return '';
  if(state.page==='orders'&&orderSource(orderPlatform())==='panda'){
   const d=L.detail,p=orderPlatform(),total=d?.total;
   if(L.error)return '<span>订单数据读取失败</span>';
   if(L.detailBusy||!d)return '<span>订单数据待读取</span>';
   if(d.platform?.id!==p.id||total===null||total===undefined||total===''||!Number.isSafeInteger(Number(total))||Number(total)<0)return '<span>订单数据待确认</span>';
   if(Number(total)===0&&!pandaCurrentCoverage().complete)return '<span>尚无入库明细 · 完整性未确认</span>';
   return '<span title="按当前订单查询返回的明细总条数判断有无数据；不代表金额、成功笔数或采集完整率">所选日期有订单数据 '+C(Number(total)>0?1:0)+' 平台</span>';
  }
  if(pandaAggregateBlocked())return '<span>所选窗口完整性尚未确认 · 订单数据待确认</span>';
  const allowed=new Set(selected().map(p=>p.id)),failed=new Set((L.queryFailures||[]).map(p=>p.id)),withData=new Set(L.results.filter(r=>allowed.has(r.platform?.id)&&!failed.has(r.platform.id)&&(r.summary||[]).some(s=>Number(s.all_count)>0||Number(s.success_count)>0)).map(r=>r.platform.id)),incomplete=L.loading||L.queryPaused||L.queryRetrying||L.queryFailures?.length;return '<span title="按所选日期已返回的创建或成功订单统计；目录中缺数平台仍保留">'+(incomplete?'已返回有订单数据 ':'所选日期有订单数据 ')+C(withData.size)+' 平台</span>';}
 const matchesPlatform=p=>!activeValues('platform').length||activeValues('platform').some(id=>id===p.id||(p.aliasPlatformIds||[]).includes(id));
 const selectedVisible=()=>visibleCatalog().filter(p=>!!L.country&&p.country===L.country&&matchesFilter('source',p.source)&&matchesPlatform(p)&&matchesFilter('team',platformTeam(p)));
 const countryScope=()=>false;const selected=()=>visibleCatalog().filter(p=>!p.reportOnly&&(!!L.country&&p.country===L.country)&&(isWithdrawPage(state.page)||queryableSource(p))&&matchesFilter('source',p.source)&&matchesPlatform(p)&&matchesFilter('team',platformTeam(p)));
 function aggregateFailureState(failure){
  const status=['missing','building','stale','unsupported','invalid'].includes(failure?.status)?failure.status:'failed',labels={missing:'统计尚未准备',building:'统计正在准备',stale:'统计已过期',unsupported:'当前筛选暂不支持',invalid:'统计范围或结构校验未通过',failed:'读取失败'};
  return {status,label:failure?.message||labels[status],pending:['missing','building','stale'].includes(status)};
 }
 // Presence is about the exact queried native platform and direction. An empty
 // response describes received records; it cannot certify a complete zero day.
 function platformDataCoverage(direction){
  if(!['charge','withdraw'].includes(direction)||!['all',direction].includes(L.direction)||!L.pageQueried||L.dirty||!L.queryScope||L.queryScope!==aggregateQueryScope()||!L.queryPlatforms?.length)return null;
  const platforms=[...new Map(selectedVisible().filter(p=>p.id).map(p=>[p.id,p])).values()],requested=new Set(L.queryPlatforms.map(p=>p.id)),queryable=new Set(selected().map(p=>p.id)),failures=new Map((L.queryFailures||[]).map(p=>[p.id,p])),returned=new Map();
  for(const result of L.results||[])if(requested.has(result.platform?.id)&&!returned.has(result.platform.id))returned.set(result.platform.id,result);
  const count=value=>value!==null&&value!==undefined&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
  const rows=platforms.map(platform=>{
   const result=returned.get(platform.id),failure=failures.get(platform.id),base={id:platform.id,name:displayIdentity(platform).name||platform.name||platform.id,source:platform.source||'—',all:null,success:null};
   if(!queryable.has(platform.id))return {...base,status:'unsupported',label:platform.reportConnected?'仅日报 / 配置，未接入订单':'仅目录，未接入订单'};
   if(failure)return {...base,...aggregateFailureState(failure)};
   if(!requested.has(platform.id))return {...base,status:'unread',label:'尚未读取'};
   if(!result)return {...base,status:L.queryPaused?'paused':L.loading||L.queryRetrying?'loading':'unread',label:L.queryPaused?'已暂停，待读取':L.loading||L.queryRetrying?'读取中':'尚未读取'};
   if(!Array.isArray(result.summary))return {...base,status:'unknown',label:'已返回，统计待确认'};
   const successUnavailable=sourceSuccessTimeUnavailable(platform,result,direction);
   const summaries=result.summary.filter(row=>row.direction===direction),all=summaries.length&&summaries.some(row=>count(row.all_count)===null)?null:summaries.reduce((n,row)=>n+count(row.all_count),0),success=successUnavailable||summaries.length&&summaries.some(row=>count(row.success_count)===null)?null:summaries.reduce((n,row)=>n+count(row.success_count),0),hasData=summaries.some(row=>(count(row.all_count)||0)>0||!successUnavailable&&(count(row.success_count)||0)>0);
   return {...base,all,success,status:hasData?'data':all===null||success===null?'unknown':'empty',label:hasData?'有订单数据':successUnavailable?'已读取，成功时间未提供':all===null||success===null?'已返回，统计待确认':'已读取无订单记录'};
  });
  return {direction,rows,total:rows.length,withData:rows.filter(row=>row.status==='data').length,empty:rows.filter(row=>row.status==='empty').length,unresolved:rows.filter(row=>!['data','empty'].includes(row.status)).length};
 }
 function platformDataCoverageHtml(direction){
  const coverage=platformDataCoverage(direction);if(!coverage||!coverage.total)return '';
  const order={data:0,empty:1,failed:2,invalid:3,unknown:4,building:5,loading:6,stale:7,missing:8,paused:9,unread:10,unsupported:11},rows=coverage.rows.slice().sort((a,b)=>order[a.status]-order[b.status]||(b.all||0)-(a.all||0)||a.name.localeCompare(b.name));
  return '<details class="live-platform-coverage" data-platform-coverage="'+direction+'"><summary title="有订单数据的平台数 / 当前所选平台数，按本方向分别统计">有数据平台 <strong>'+C(coverage.withData)+' / '+C(coverage.total)+'</strong><span class="live-platform-coverage-toggle">展开平台</span></summary><div class="live-platform-coverage-body"><div class="live-platform-coverage-note">'+directionName(direction)+' · 有数据 '+C(coverage.withData)+' · 已读取无订单记录 '+C(coverage.empty)+(coverage.unresolved?' · 待读取 / 待确认 '+C(coverage.unresolved):'')+'<span>按当前日期和筛选的已返回订单记录统计，不代表采集完整率。</span></div><table aria-label="'+directionName(direction)+'平台数据范围"><thead><tr><th scope="col">平台</th><th scope="col">来源</th><th scope="col">当前读取状态</th><th scope="col">提交笔数</th><th scope="col">成功笔数</th></tr></thead><tbody>'+rows.map(row=>'<tr data-platform-id="'+E(row.id)+'" data-coverage-status="'+row.status+'"><td>'+E(row.name)+'</td><td>'+E(row.source)+'</td><td'+(row.status==='invalid'?' class="live-error"':'')+'>'+E(row.label)+'</td><td>'+C(row.all)+'</td><td>'+C(row.success)+'</td></tr>').join('')+'</tbody></table></div></details>';
 }
 function orderPlatform(){const ids=activeValues('platform'),list=selected();return ids.length===1&&list.length===1&&(list[0].id===ids[0]||(list[0].aliasPlatformIds||[]).includes(ids[0]))?list[0]:null}
 const orderSelectionNotice=()=>'<div class="live-status">请先选择一个商户（平台），再查询订单明细。每次仅查询一个平台，结果分页展示。</div>';
 const selectedCurrencies=()=>[...new Set(selected().map(p=>p.currency).filter(Boolean))];
 const scopeZone=()=>selectedVisible().find(p=>p.timezone)?.timezone||L.withdrawCatalog.find(p=>p.country===L.country)?.timezone||({'印度':'Asia/Kolkata','巴西':'America/Sao_Paulo','胖虎巴西':'America/Sao_Paulo','巴基斯坦':'Asia/Karachi','印尼':'Asia/Jakarta','越南':'Asia/Ho_Chi_Minh','菲律宾':'Asia/Manila','马来':'Asia/Kuala_Lumpur','缅甸':'Asia/Yangon','尼日利亚':'Africa/Lagos','哥伦比亚':'America/Bogota','墨西哥':'America/Mexico_City','智利':'America/Santiago'}[L.country])||'UTC';
 function syncCurrency(){const currencies=selectedCurrencies();L.currency=currencies.length===1?currencies[0]:currencies.length?'多币种':'—';}
 // DateTimeFormat owns native ICU resources. Reuse the fixed-format instance
 // across all platform/cell checks instead of allocating thousands per paint.
 const clockFormatters=new Map();
 function localClock(epoch,zone){let formatter=clockFormatters.get(zone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});if(clockFormatters.size>=32)clockFormatters.delete(clockFormatters.keys().next().value);clockFormatters.set(zone,formatter)}const p=Object.fromEntries(formatter.formatToParts(epoch).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second}
 const instantCache=new Map();
 function instant(value,zone,end=false){const full=value.length===16?value+':00':value;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(full))throw Error('请输入日期、小时、分钟和秒');const wall=Date.parse(full+'Z');if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,19)!==full)throw Error('日期时间无效');const key=JSON.stringify([full,typeof zone,zone,!!end]);if(instantCache.has(key))return instantCache.get(key);const offsets=new Set([-48,-24,0,24,48].map(h=>{const e=wall+h*3600000;return Date.parse(localClock(e,zone)+'Z')-e}));const candidates=[...offsets].map(o=>wall-o).filter(e=>localClock(e,zone)===full);if(candidates.length!==1)throw Error('平台时区存在跳时或重复时间，请调整边界');const result=new Date(candidates[0]+(end?1000:0)).toISOString();if(instantCache.size>=128)instantCache.delete(instantCache.keys().next().value);instantCache.set(key,result);return result}
 function table(headers,rows,classes='',footerRows=[]){return '<div class="live-table table-wrap '+classes+'"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody>'+(footerRows.length?'<tfoot>'+footerRows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tfoot>':'')+'</table>'+(rows.length?'':'<div class="live-empty">当前筛选范围没有已入库记录</div>')+'</div>'}
 function box(title,body,note='',tools=''){return '<section class="panel"><div class="panel-head"><h2>'+title+'</h2>'+tools+'</div>'+body+(note?'<div class="live-panel-note">'+note+'</div>':'')+'</section>'}
 function metric(label,value,sub=''){return '<div class="live-metric"><label>'+label+'</label><strong>'+value+'</strong>'+(sub?'<small>'+sub+'</small>':'')+'</div>'}
 function comparisonRows(direction){return L.comparisonResults.flatMap(x=>x.summary||[]).filter(r=>!direction||r.direction===direction)}
 function comparisonNote(){
  if(L.comparisonStatus==='loading')return '<span class="live-compare muted">对比读取中</span>';
  if(L.comparisonStatus!=='ready')return '<span class="live-compare muted" title="'+E(L.comparisonError||'对比尚未读取')+'">对比暂不可用</span>';
  return '';
 }
 function compareMetric(key,current,rate=false,direction,rateBasis='success'){
  const pending=comparisonNote();if(pending)return pending;const previous=successTimeSummary(comparisonRows(direction),direction);
  const options={previous,comparisonStatus:L.comparisonStatus,comparisonLabel:L.comparisonLabel,comparisonError:L.comparisonError,money:N,count:C},html=value=>'<span class="live-compare '+E(value.tone)+'" title="'+E(value.title)+'">'+E(value.text)+'</span>';
  if(rate){const currentPair=[rateBasis==='success'?current.success_count:current.created_success_count??current.success_count,current.all_count],previousPair=[rateBasis==='success'?previous.success_count:previous.created_success_count??previous.success_count,previous.all_count];return html(HensemLiveLayout.comparison(currentPair,previousPair,{...options,rateDelta:rateBasis==='success'?HensemLiveCompare.ratioDelta:HensemLiveCompare.rateDelta},true))}
  const changes=[html(HensemLiveLayout.comparison(current[key],previous[key],options,false,key.endsWith('_count')?'count':'amount'))];
  if(key.endsWith('_amount')){const countKey=key.replace(/_amount$/,'_count');changes.push(html(HensemLiveLayout.comparison(current[countKey],previous[countKey],options,false,'count')))}
  return '<span class="live-metric-comparisons">'+changes.join('')+'</span>';
 }
 function comparisonCaption(){
  const q=L.results[0],prior=L.comparisonResults[0],zone=q?.platform?.timezone;
  const cur=q?E(formatTime(q._parts?.[0]?.startAt||q.startAt,zone))+' 至 '+E(formatTime(new Date(Date.parse(q._parts?.at(-1)?.endAt||q.endAt)-1000).toISOString(),zone)):'';
  const prev=prior?E(formatTime(prior._parts?.[0]?.startAt||prior.startAt,zone))+' 至 '+E(formatTime(new Date(Date.parse(prior._parts?.at(-1)?.endAt||prior.endAt)-1000).toISOString(),zone)):'';
  return '<div class="live-comparison-caption"><b>'+directionName(L.direction)+'</b><span>本期 '+cur+'</span>'+(L.comparisonStatus==='ready'?'<span>对比 '+prev+'</span>':'<span>'+E(L.comparisonStatus==='loading'?'正在读取前期同范围数据':L.comparisonError||'对比暂不可用')+'</span>')+'<span>同平台、同方向、同筛选；全部按创建时间、成功按成功时间；金额按各平台币种分别核算，成功率对比为百分点</span></div>';
 }
 function visibleDirections(){return L.direction==='all'?['charge','withdraw']:[L.direction]}
 function merchantSummaryFee(direction,summary){
  const mode=L.feeEstimateMode==='historical'?'historical':'current',label=mode==='current'?'当前费率参考估算':'历史生效手续费';
  if(mode==='current'&&(L.feeLookupLoading||!Array.isArray(L.feeLookupRows)&&!L.feeLookupError))return {label,amount:null,status:'loading'};
  if(mode==='current'&&L.feeLookupError)return {label,amount:null,status:'error',note:L.feeLookupError};
  if(successTimeUnavailable(direction))return {label,amount:null,matchedCount:null,eligibleCount:null,complete:false,mode};
  const metadata=result=>({source:result.platform?.source,platformId:result.platform?.id,platform:result.platform?.name,country:result.platform?.country,scopeGroup:result.platform?.scopeGroup});
  const summaries=L.results.flatMap(result=>(result.summary||[]).filter(row=>row.direction===direction).map(row=>({...row,...metadata(result)})));
  const orders=L.results.flatMap(result=>(result.groups?.provider||[]).filter(row=>row.direction===direction).map(row=>({...row,...metadata(result)})));
  const rows=HensemProviderSummary.overviewDimensions({orders,summaries,rates:L.feeLookupRows||[],country:L.country,key:'platform',plus,combine});
  const currencies=[...new Set([...summaries,...orders].map(row=>row.currency).filter(Boolean))],currency=currencies.length===1?currencies[0]:null;
  const fact=mode==='current'?HensemProviderSummary.currentReferenceFeeFacts({...summary,direction,currency,fee_items:rows},L.feeLookupRows,L.country):HensemProviderSummary.feeSummary(rows.map(row=>({...row,...successTimeSummary([row],direction)})));
  return {label,amount:fact.amount,matchedCount:fact.matchedCount,eligibleCount:mode==='current'?fact.eligibleCount:fact.successCount,excludedCount:fact.excludedCount,complete:fact.complete,mode,currency};
 }
 function totals(){
  // Panda's order page reads server-paged details only. Both the reference
  // renderer and fallback call this helper; empty aggregates are not zero facts.
  if(state.page==='orders'&&orderSource(orderPlatform())==='panda'||pandaAggregateBlocked())return '';
  if(L.feeEstimateMode!=='historical'&&!L.loading&&L.feeLookupRows===null&&!L.feeLookupLoading&&!L.feeLookupError)ensureFeeLookup();
  return HensemLiveLayout.totals({directions:visibleDirections().map(direction=>{const rows=L.results.flatMap(r=>r.summary||[]).filter(r=>r.direction===direction),partial=aggregateReadStatus().incomplete,summary=partial&&!rows.length?Object.fromEntries([...countKeys,...amountKeys].map(key=>[key,null])):successTimeSummary(rows,direction),fee=merchantSummaryFee(direction,summary);return {key:direction,label:directionName(direction),coverageHtml:(partial?'<span class="live-subtotal-label">已读小计</span>':'')+platformDataCoverageHtml(direction),summary,previous:successTimeSummary(comparisonRows(direction),direction),fee:partial&&!rows.length?{...fee,amount:null,matchedCount:null,eligibleCount:null,complete:false}:fee}}),currency:L.currency,comparisonStatus:L.comparisonStatus,comparisonLabel:L.comparisonLabel,comparisonError:L.comparisonError,money:N,count:C,rate:R})
 }

 function providerCell(r){return '<button class="link" title="'+E(r.provider||'未识别通道')+' · 查看订单号与归类依据" onclick="liveProviderOrders('+E(JSON.stringify(r.provider||'未识别通道'))+','+E(JSON.stringify(r.source||''))+','+E(JSON.stringify(r.direction))+')">'+E(r.provider||'未识别通道')+'</button>'}
 function businessCells(r){r=pandaAnalysisRow(r);return [N(r.all_amount),C(r.all_count),N(r.success_amount),C(r.success_count),N(r.pending_amount),C(r.pending_count),N(r.failed_amount),C(r.failed_count),R(r.success_count,r.all_count)]}
 const businessHeaders=['全部金额','全部笔数','成功金额','成功笔数','处理中金额','处理中笔数','失败金额','失败笔数','成功率'];
 function pager(total,page,size,kind){const max=Math.max(1,Math.ceil(total/size)),start=Math.max(1,Math.min(page-3,max-6)),end=Math.min(max,start+6);let nums='';for(let p=start;p<=end;p++)nums+='<button '+(p===page?'class="on"':'')+' onclick="livePage('+p+',\''+kind+'\')">'+p+'</button>';return '<div class="live-pager"><span>共 <b>'+C(total)+'</b> 条　'+(total?C((page-1)*size+1)+'–'+C(Math.min(page*size,total)):'0')+'</span><div class="right"><select aria-label="每页条数" onchange="livePageSize(this.value,\''+kind+'\')">'+[20,30,50,100,500].map(n=>option(n,n+' 条 / 页',size)).join('')+'</select><button '+(page===1?'disabled':'')+' onclick="livePage(1,\''+kind+'\')">首页</button><button '+(page===1?'disabled':'')+' onclick="livePage('+(page-1)+',\''+kind+'\')">上一页</button>'+nums+'<button '+(page>=max?'disabled':'')+' onclick="livePage('+(page+1)+',\''+kind+'\')">下一页</button><button '+(page>=max?'disabled':'')+' onclick="livePage('+max+',\''+kind+'\')">尾页</button><span>共 '+C(max)+' 页　前往</span><input id="live-jump-'+kind+'" type="number" min="1" max="'+max+'" aria-label="跳转页码"><span>页</span><button onclick="liveJump(\''+kind+'\','+max+')">确定</button></div></div>'}
 function pagedTable(headers,rows,title,note=''){L.groups=rows;const max=Math.max(1,Math.ceil(rows.length/L.localSize));L.localPage=Math.min(L.localPage,max);return box(title,table(headers,rows.slice((L.localPage-1)*L.localSize,L.localPage*L.localSize))+pager(rows.length,L.localPage,L.localSize,'local'),note)}
 // Sorting uses complete loaded records; server-paged order/configuration tables
 // deliberately do not use this adapter. State shares the existing page snapshots.
 const loadedSortRegistry=new Map(),loadedSorting=window.HensemProviderSummary;
 const loadedNumeric=key=>({value:r=>loadedSorting.knownNumber(r[key])}),loadedText=key=>({value:r=>r[key]||null,ascending:true});
 const loadedRatio=(a,b)=>({value:r=>loadedSorting.fraction(r[a],r[b])});
 const loadedBusinessColumns=()=>['all_amount','all_count','success_amount','success_count','pending_amount','pending_count','failed_amount','failed_count'].map(loadedNumeric).concat(loadedRatio('success_count','all_count'));
 function loadedTypeValue(row){if(L.feeLookupLoading||L.feeLookupError)return null;const fact=loadedSorting.providerType(row,L.feeLookupRows,L.country);return ['empty','review'].includes(fact.state)?null:fact.label}
 function loadedFeeValue(row){
  if(L.feeLookupLoading||L.feeLookupError)return null;
  const leaves=row.items?.length?row.items:[row],values=[];
  for(const leaf of leaves){const records=loadedSorting.feeCandidates({...leaf,provider:row.provider},L.feeLookupRows||[],L.country);if(!records.length)return null;
   for(const record of records){const fee=leaf.direction==='withdraw'?loadedSorting.parseFee(record.payoutFee,record.payoutSingleFee):loadedSorting.parseFee(record.collectFee,record.collectSingleFee);if(!fee)return null;values.push([fee.percent,fee.fixed])}}
  return values.length&&values.every(value=>value[0]===values[0][0]&&value[1]===values[0][1])?values[0]:null;
 }
 function sortLoadedTable(id,headers,rows,columns){
  const key=state.page+'|'+id;L.tablePages=L.tablePages||{};loadedSortRegistry.set(key,{page:state.page,columns});
  if(!loadedSorting?.sortableTable)return {headers,rows};
  return loadedSorting.sortableTable({rows,headers,columns,sort:L.tablePages['sort:live-'+id],onSort:index=>'liveLoadedTableSort(\''+encodeURIComponent(key)+'\','+index+')'});
 }
 window.liveLoadedTableSort=function(encoded,index){let key;try{key=decodeURIComponent(encoded)}catch{return}const entry=loadedSortRegistry.get(key),column=entry?.columns[index];if(L.dirty||entry?.page!==state.page||!Number.isInteger(index)||!column||typeof column.value!=='function')return;const id=key.slice(key.indexOf('|')+1),old=L.tablePages['sort:live-'+id];L.tablePages['sort:live-'+id]={column:index,ascending:old?.column===index?!old.ascending:!!column.ascending};L.localPage=1;render()};
 function sortedLoadedPage(id,headers,rows,columns,cells,title,note=''){const sorted=sortLoadedTable(id,headers,rows,columns);return pagedTable(sorted.headers,sorted.rows.map(cells),title,note)}
 function pairedTable(title,headers,rows,note,kind,footerRows=[]){const all=rows||[],max=Math.max(1,Math.ceil(all.length/L.localSize)),page=Math.min(L.localPage,max),from=(page-1)*L.localSize;L.localPage=page;return box(title,table(headers,all.slice(from,from+L.localSize),'',footerRows)+pager(all.length,page,L.localSize,kind||'local'),note)}
 function directionFooter(label,rows,sourceColumns=0,tailColumns=0,direction){const total=successTimeSummary(rows||[],direction),platforms=(rows||[]).reduce((n,row)=>n+Number(row.platform_count||0),0);return ['<strong>'+E(label)+'</strong>',...Array.from({length:sourceColumns},()=>'<span class="muted">—</span>'),C(platforms),...businessCells(total),...Array.from({length:tailColumns},()=>'<span class="muted">—</span>')]}
 function businessFooter(label,rows,prefixColumns=0,tailColumns=0,direction){return ['<strong>'+E(label)+'</strong>',...Array.from({length:prefixColumns},()=>'<span class="muted">—</span>'),...businessCells(successTimeSummary(rows||[],direction)),...Array.from({length:tailColumns},()=>'<span class="muted">—</span>')]}
 function providerTypeCell(r){return HensemProviderSummary.providerTypeCell(r,L.feeLookupRows,L.country,E,L)}
 function providersView(){const sourceRows=groupRows('provider'),rows=combine(sourceRows,['source','provider','direction','currency']).sort((a,b)=>b.all_count-a.all_count),headers=['三方','类型','来源','平台数',...businessHeaders,'手续费'],columns=[loadedText('provider'),{value:loadedTypeValue,ascending:true},loadedText('source'),loadedNumeric('platform_count'),...loadedBusinessColumns(),{value:loadedFeeValue}];if(!L.loading&&L.feeLookupRows===null&&!L.feeLookupLoading)ensureFeeLookup();return '<div class="grid equal live-paired-dimensions">'+visibleDirections().map(d=>{const subset=rows.filter(r=>r.direction===d),sorted=sortLoadedTable('providers-'+d,headers,subset,columns);return pairedTable('三方经营汇总 · '+directionName(d),sorted.headers,sorted.rows.map(r=>[providerCell(r),providerTypeCell(r),E(r.source||'—'),C(r.platform_count),...businessCells(r),E(feeForRow(r))]),'金额与笔数独立展示；'+directionName(d)+'无数据时仍保留空表。','local',[directionFooter(directionName(d)+'汇总',subset,2,1,d)]);}).join('')+'</div>'}
 function platformsView(){const rows=L.results.flatMap(r=>(r.summary||[]).map(x=>({...x,platform:r.platform}))).sort((a,b)=>b.all_count-a.all_count),headers=['平台','来源','授权分组',...businessHeaders,'源数据更新时间'],columns=[{value:r=>r.platform.name||null,ascending:true},{value:r=>r.platform.source||null,ascending:true},{value:r=>r.platform.scopeGroup||null,ascending:true},...loadedBusinessColumns(),{value:r=>r.latest_synced_at?loadedSorting.knownNumber(Date.parse(r.latest_synced_at)):null}];return '<div class="grid equal live-paired-dimensions">'+visibleDirections().map(d=>{const subset=rows.filter(r=>r.direction===d),sorted=sortLoadedTable('platforms-'+d,headers,subset,columns);return pairedTable('平台经营汇总 · '+directionName(d),sorted.headers,sorted.rows.map(r=>['<button class="link" onclick="liveChoosePlatform(\''+E(r.platform.id)+'\')">'+E(r.platform.name)+'</button>',E(r.platform.source),E(r.platform.scopeGroup||'未绑定'),...businessCells(r),E(formatTime(r.latest_synced_at,r.platform.timezone))]),'正式数据范围由账号权限控制；'+directionName(d)+'无数据时仍保留空表。','local',[businessFooter(directionName(d)+'汇总',subset,2,1,d)]);}).join('')+'</div>'}
 function chartCoverage(previous=false){
  const expected=(L.queryPlatforms||[]).length?L.queryPlatforms:selected(),ids=new Set(expected.map(p=>p.id));
  const results=(previous?L.comparisonResults:L.results)||[],currentFull=!previous&&(L.loadedView==='full'||L.overviewSections?.done>0&&L.results===L.overviewSections.results);
  const full=result=>result._aggregateView==='full'||result._aggregateView===undefined&&currentFull;
  // Provider summaries contain empty hourly arrays without reading that dimension.
  const read=results.filter(r=>(!ids.size||ids.has(r.platform?.id))&&Array.isArray(r.groups?.hourly)&&(full(r)||r.groups.hourly.length>0));
  const loaded=new Set(read.map(r=>r.platform?.id)).size,total=ids.size,complete=total>0&&loaded===total&&read.every(full)&&!read.some(r=>r.pandaCoverage?.reason==='verified_created_prefix_only');
  return {complete,label:(previous?'前期':'本期')+'已读 '+C(loaded)+' / '+C(total)+' 平台'+(complete?'':' · 来源不完整，仅已读范围')};
 }
 function inspectChart(svg,series,max,money,direction){
  const helper=window.HensemLiveChart;if(!helper)return svg;
  const current=chartCoverage(),previous=chartCoverage(true);
  return helper.enhance(svg,{max,title:directionName(direction)+' · 24小时订单'+(money?'金额':'笔数'),range:[L.from,L.to].filter(Boolean).join(' 至 ').replaceAll('T',' '),series:series.map(line=>{
   const coverage=line.previous?previous:current;
   return helper.series({...line,money,currency:L.currency,complete:coverage.complete,coverage:coverage.label,unavailable:line.key.startsWith('success_')&&successTimeUnavailable(direction)?'尚未接入有效成功时间，不能计为 0':''});
  })});
 }
 function chart(rows){
  const direction=rows[0]?.direction||L.direction,prefix=L.results.some(r=>r.pandaCoverage?.reason==='verified_created_prefix_only');
  const hours=Array.from({length:24},(_,hour)=>{const row={...plus(rows.filter(r=>Number(r.hour)===hour)),hour,direction,currency:L.currency};return prefix?pandaAnalysisRow(row,direction):row;}),max=Math.max(1,...hours.map(r=>r.all_count)),w=700,h=155;
  let svg='<svg class="live-chart" viewBox="0 0 760 210" role="img" aria-label="当地创建小时全部与成功笔数">';
  for(let i=0;i<4;i++){const y=15+i*h/3;svg+='<line x1="43" x2="742" y1="'+y+'" y2="'+y+'"/><text x="34" y="'+(y+3)+'" text-anchor="end">'+C(Math.round(max*(3-i)/3))+'</text>'}
  const lines=[['all_count','#4e75ed'],['success_count','#35a697']],plotted=key=>prefix?hours.some(row=>row[key]!==null):!rows.some(row=>row[key]===null);
  for(const [key,color]of lines.filter(([key])=>plotted(key))){let points=[];const flush=()=>{if(points.length)svg+='<polyline fill="none" stroke="'+color+'" stroke-width="2.4" points="'+points.join(' ')+'"/>';points=[];};for(const [i,r]of hours.entries()){if(r[key]===null){flush();continue;}points.push((43+i*w/23)+','+(15+h-r[key]/max*h));}flush();}
  for(let i=0;i<24;i+=3)svg+='<text x="'+(43+i*w/23)+'" y="193" text-anchor="middle">'+String(i).padStart(2,'0')+':00</text>';
  const rawRows=prefix?hours:groupRows('hourly').filter(r=>direction==='all'||r.direction===direction);
  return inspectChart(svg+'</svg>',lines.map(([key,color])=>({name:key==='all_count'?'本期全部':'本期成功',color,rows:rawRows,key,plotted:plotted(key)})),max,false,direction)+'<div class="live-legend"><span>● 全部笔数</span><span style="color:#35a697">● 成功笔数</span><span>全部 / 处理中按各平台当地创建小时；成功按各平台当地成功小时</span></div>';
 }

 function overview(){
  const tabs=[['all','经营全景'],['providers','三方表现'],['dimensions','平台 / 国家 / 团队'],['amount','金额档位'],['time','24小时 / 每日'],['latency','成功时效'],...(L.direction!=='charge'?[['pending','代付中等待']]:[]),['coverage','费用 / 工单 / 风险']];
  if(!tabs.some(([key])=>key===L.overviewTab))L.overviewTab='all';
  const nav='<nav class="live-overview-tabs" aria-label="总览分类">'+tabs.map(([key,label])=>'<button class="'+(L.overviewTab===key?'on':'')+'" onclick="liveOverviewTab(\''+key+'\')">'+label+'</button>').join('')+'</nav>';
  let body='';
  if(L.overviewTab==='all')body=overviewPanorama();
  if(L.overviewTab==='providers')body=providersView();
  if(L.overviewTab==='dimensions')body=overviewDimensions()+platformsView();
  if(L.overviewTab==='amount')body=overviewAmounts()+box('24小时 × 金额档位',overviewMatrix(),'每一小时独立列；金额、笔数、成功率独立指标行。');
  if(L.overviewTab==='time')body='<div class="live-charts">'+visibleDirections().map(d=>box(directionName(d)+' · 24小时订单笔数',overviewChart(false,d))+box(directionName(d)+' · 24小时订单金额',overviewChart(true,d))).join('')+'</div>'+overviewDaily();
  if(L.overviewTab==='latency')body=overviewDurationSummary(false)+latencyView(false);
  if(L.overviewTab==='pending')body=overviewDurationSummary(true)+latencyView(true);
  if(L.overviewTab==='coverage')body=overviewCoverage();
  return comparisonCaption()+totals()+nav+body;
 }
 window.liveOverviewTab=function(key){L.overviewTab=key;L.localPage=1;render()};
 function overviewStateTable(){return ''}

 function overviewChart(money,direction){
  const field=money?'all_amount':'all_count',success=money?'success_amount':'success_count';
  const current=groupRows('hourly').filter(r=>r.direction===direction),previous=L.comparisonResults.flatMap(r=>r.groups?.hourly||[]).filter(r=>r.direction===direction);
  const candidates=[{name:'本期全部',color:'#4e75ed',rows:current,key:field},{name:'本期成功',color:'#35a697',rows:current,key:success},...(L.comparisonStatus==='ready'?[{name:'前期全部',color:'#a2afc5',rows:previous,key:field,dash:true,previous:true}]:[])];
  const previousCoverage=chartCoverage(true),lines=candidates.filter(line=>!(line.key===success&&successTimeUnavailable(direction))&&!line.rows.some(row=>row[line.key]===null)&&(!line.previous||previousCoverage.complete||line.rows.length>0));
  for(const line of lines)line.points=Array.from({length:24},(_,hour)=>{const rows=line.rows.filter(r=>Number(r.hour)===hour);return line.previous&&!previousCoverage.complete&&!rows.length?null:plus(rows)[line.key]});
  const max=Math.max(1,...lines.flatMap(l=>l.points).filter(v=>v!==null));let svg='<svg class="live-chart" viewBox="0 0 760 210" role="img" aria-label="'+(money?'每小时金额与前期对比':'每小时笔数与前期对比')+'">';
  for(let i=0;i<4;i++){const y=15+i*155/3;svg+='<line x1="43" x2="742" y1="'+y+'" y2="'+y+'"/><text x="36" y="'+(y+3)+'" text-anchor="end">'+C(Math.round(max*(3-i)/3))+'</text>'}
  for(const line of lines){let segments=[];for(let i=0;i<24;i++){const v=line.points[i];if(v===null){if(segments.length)svg+='<polyline fill="none" stroke="'+line.color+'" stroke-width="2" '+(line.dash?'stroke-dasharray="5 4"':'')+' points="'+segments.join(' ')+'"/>';segments=[];continue}segments.push((43+i*700/23)+','+(170-v/max*155))}if(segments.length)svg+='<polyline fill="none" stroke="'+line.color+'" stroke-width="2" '+(line.dash?'stroke-dasharray="5 4"':'')+' points="'+segments.join(' ')+'"/>'}
  for(let i=0;i<24;i+=3)svg+='<text x="'+(43+i*700/23)+'" y="193" text-anchor="middle">'+String(i).padStart(2,'0')+':00</text>';
  return inspectChart(svg+'</svg>',candidates.map(line=>({...line,plotted:lines.includes(line)})),max,money,direction)+'<div class="live-legend">'+lines.map(l=>'<span style="color:'+l.color+'">● '+l.name+'</span>').join('')+'</div>';
 }
 function overviewAmounts(){const field=L.matrixMode==='range'?'amount_range':'amount',rows=combine(groupRows(field),['direction','bucket']).sort(compareBuckets),headers=['金额档位 · '+E(L.currency),'全部金额','全部笔数','成功金额','成功笔数','成功率','笔数占比'];return '<div class="grid equal live-paired-dimensions">'+visibleDirections().map(d=>{const total=plus(L.results.flatMap(x=>x.summary||[]).filter(x=>x.direction===d)).all_count,sorted=sortLoadedTable('amounts-'+d,headers,(L.matrixMode==='range'&&amountBands(d)?[...amountBandKeys(d).map(bucket=>rows.find(r=>r.direction===d&&r.bucket===bucket)||({...empty(),direction:d,bucket})),...rows.filter(r=>r.direction===d&&!amountBandKeys(d).includes(r.bucket))]:rows.filter(r=>r.direction===d)),[{value:r=>loadedSorting.knownNumber(bucketNumber(r.bucket)),ascending:true},...['all_amount','all_count','success_amount','success_count'].map(loadedNumeric),loadedRatio('success_count','all_count'),{value:r=>loadedSorting.fraction(r.all_count,total)}]);return box('金额档位分布 · '+directionName(d),table(sorted.headers,sorted.rows.map(r=>[E(amountLabel(r.bucket,r.direction)),N(r.all_amount),C(r.all_count),N(r.success_amount),C(r.success_count),R(r.success_count,r.all_count),R(r.all_count,total)])),amountNote(d)+'全部 / 处理中按创建时间，成功按成功时间。')}).join('')+'</div>'}
 function overviewMatrix(){return visibleDirections().map(d=>'<h3 class="live-subheading">'+directionName(d)+'</h3>'+matrixBody(d)).join('')}
 function overviewDaily(){const rows=combine(groupRows('daily'),['direction','date']).sort((a,b)=>String(a.date).localeCompare(String(b.date)));return sortedLoadedPage('overview-daily',['方向','当地日期',...businessHeaders],rows,[{value:r=>directionName(r.direction),ascending:true},loadedText('date'),...loadedBusinessColumns()],r=>[directionName(r.direction),E(r.date),...businessCells(r)],'每日经营明细')}
 function overviewDimensions(){const raw=L.results.flatMap(result=>(result.summary||[]).map(r=>({...r,platformId:result.platform.id,country:result.platform.country,source:result.platform.source,team:result.platform.team||'未绑定团队'})));const sections=[['国家 / 授权分组','country'],['包网来源','source'],['团队归属','team']];return '<div class="live-dimension-grid">'+sections.map(([title,key])=>{const rows=combine(raw,[key,'direction']);return box(title,table([title,'方向','平台数','全部金额','全部笔数','成功率'],rows.map(r=>[E(r[key]),directionName(r.direction),C(r.platform_count),N(r.all_amount),C(r.all_count),R(r.success_count,r.all_count)])))}).join('')+'</div>'}
 function overviewDurationSummary(pending){return (pending?['withdraw']:visibleDirections()).map(direction=>{if(!pending&&(successTimeUnavailable(direction)||direction==='withdraw'&&L.results.some(result=>orderSource(result.platform)==='newar'&&(result.successBasis==='source_updated'||result.capabilities?.withdrawLatencyAvailable===false))))return box(directionName(direction)+'成功时效','所选来源未提供当前统计依据对应的可核验时间，成功时效暂不可用。');const rows=combineAging(L.results.flatMap(r=>r.groups?.[pending?'pending_age':'latency']||[]).filter(r=>r.direction===direction)),valid=rows.reduce((n,r)=>n+Number(r.count||0),0),money=rows.some(r=>r.amount===null)?null:rows.reduce((n,r)=>n+Number(r.amount||0),0),s=plus(L.results.flatMap(r=>r.summary||[]).filter(r=>r.direction===direction)),all=pending?s.pending_count:s.success_count;return '<h3 class="live-subheading">'+directionName(direction)+(pending?'等待时效':'成功时效')+'</h3><div class="live-mini-stats">'+metric(pending?'有效等待笔数':'有效成功时效笔数',C(valid))+metric('有效时效金额',N(money))+metric('有效时间覆盖率',R(valid,all))+metric('无有效时间笔数',C(Math.max(0,all-valid)))+'</div>'}).join('')}

 function overviewCoverage(){return '<div class="live-coverage-grid">'+[['当前费率','已接入正式配置，代收、代付、单笔费和限额独立列。','rates','查看费率表'],['手续费估算','复杂阶梯费率尚未逐单匹配，历史生效版本待补齐。','','未计算'],['申述工单','正式工单按代收、代付分开展示，包含存款与取款未到账记录。','workorders','查看申述工单'],['存款未到账-跟进记录','员工工作台登记与历史表格共用跟进数据，按当前查询条件展示。','deposit_tracking','查看存款明细'],['掉单 / 风险事件','正式订单接口不包含核对标记与风险事件，暂不生成虚构数量。','data_health','查看数据覆盖'],['团队归属 / 在线账号','未绑定团队独立列示；后台在线按最近 120 秒心跳、同账号去重，员工工作台不混计。','data_health','查看数据覆盖']].map(([title,text,page,action])=>'<article><h3>'+title+'</h3><p>'+text+'</p>'+(page?'<button class="link" onclick="setPage(\''+page+'\')">'+action+' →</button>':'<span class="muted">'+action+'</span>')+'</article>').join('')+'</div>'}
 function overviewPanorama(){const a=summary(),raw=combine(groupRows('provider'),['provider','source','direction']),providers=raw.sort((a,b)=>b.all_count-a.all_count).slice(0,8),countries=new Set(L.results.map(r=>r.platform.country)),teams=new Set(L.results.map(r=>r.platform.team).filter(Boolean));const coverage='<div class="live-mini-stats">'+metric('有订单平台数',C(L.results.filter(r=>r.total>0).length))+metric('三方原始通道数',C(raw.length))+metric('国家 / 授权分组',C(countries.size))+metric('已绑定团队数',C(teams.size))+'</div>';return coverage+overviewStateTable()+'<div class="live-charts">'+visibleDirections().map(d=>box(directionName(d)+' · 24小时订单笔数',overviewChart(false,d))+box(directionName(d)+' · 24小时订单金额',overviewChart(true,d))).join('')+'</div>'+'<div class="live-charts">'+box('三方占比 · 前8项',table(['三方','来源','方向','全部金额','全部笔数','成功率','笔数占比'],providers.map(r=>[E(r.provider),E(r.source),directionName(r.direction),N(r.all_amount),C(r.all_count),R(r.success_count,r.all_count),R(r.all_count,plus(L.results.flatMap(x=>x.summary||[]).filter(x=>x.direction===r.direction)).all_count)])),'', '<button class="link" onclick="liveOverviewTab(\'providers\')">全部三方 →</button>')+overviewAmounts()+'</div>'+overviewDurationSummary(false)+latencyView(false)+(L.direction!=='charge'?overviewDurationSummary(true)+latencyView(true):'')+overviewDimensions()+platformsView()+overviewCoverage()}
 function timeView(){const rows=combine(groupRows('hourly'),['direction','hour']).sort((a,b)=>Number(a.hour)-Number(b.hour));return totals()+visibleDirections().map(d=>box(directionName(d)+' · 24 小时全部 / 成功订单',chart(rows.filter(r=>r.direction===d)))).join('')+pagedTable(['方向','创建小时',...businessHeaders],rows.map(r=>[directionName(r.direction),String(r.hour).padStart(2,'0')+':00–'+String(r.hour).padStart(2,'0')+':59:59',...businessCells(r)]),'每小时经营明细')}
 function amountView(){const field=L.matrixMode==='range'?'amount_range':'amount',rows=combine(groupRows(field),['direction','bucket']).sort(compareBuckets);return totals()+overviewAmounts()+box('金额档位与订单状态',table(['方向','金额档位 · '+E(L.currency),...businessHeaders],rows.map(r=>[directionName(r.direction),E(amountLabel(r.bucket,r.direction)),...businessCells(r)])),'按当前国家及所选三方范围统计；全部 / 处理中按创建时间，成功按成功时间。')}
 // Keep the frozen amount column descriptive; totals belong after the 24 hours.
 function matrixBandCell(bucket,direction){const text=amountLabel(bucket,direction),range=String(text).match(/^(.*?) ≤ 金额 ([<≤]) (.*)$/);return '<span class="matrix-band-label" title="'+E(text)+'">'+(range?'<span>'+E(range[1])+' ≤ 金额</span><span>'+E(range[2]+' '+range[3])+'</span>':E(text))+'</span>';}
 function matrixTotalCell(bucket,direction,rawRows,field){
  const keys=['all_count','all_amount','success_count','success_amount'],known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const originalRows=result=>Array.isArray(result._parts)?result._parts.flatMap(originalRows):(result.groups?.[field]||[]),unmergedRows=L.results.some(r=>Array.isArray(r._parts))?L.results.flatMap(originalRows):rawRows;
  const bandRows=unmergedRows.filter(r=>r.direction===direction&&String(r.bucket)===String(bucket)&&r.hour!==null&&r.hour!==undefined&&String(r.hour).trim()!==''&&Number.isInteger(Number(r.hour))&&Number(r.hour)>=0&&Number(r.hour)<24);
  const sum=successTimeSummary(bandRows.map(r=>({...r,...Object.fromEntries(keys.map(k=>[k,known(r[k])?Number(r[k]):null]))})),direction);
  if(bandRows.some(r=>!r.currency||r.currency!==L.currency)){sum.all_amount=null;sum.success_amount=null;}
  const incomplete=r=>r.complete===false||!Array.isArray(r.groups?.[field])||(Array.isArray(r._parts)&&(!r._parts.length||r._parts.some(incomplete)));
  if(!L.results.length||L.results.some(incomplete)||!bandRows.length&&aggregateReadStatus().incomplete)for(const key of keys)sum[key]=null;
  const partial=L.loading||L.queryPaused||L.queryWarnings.length>0||L.queryFailures?.length>0,title=(partial?'部分平台已读取；':'')+'所选日期范围内 00–23 时合计；全部按创建时间，成功按成功时间；金额单位 '+L.currency;
  return '<div class="matrix-row-total" title="'+E(title)+'">'+(partial?'<small class="matrix-total-partial">部分已读</small>':'')+[['全部笔数',C(sum.all_count)+' 笔'],['全部金额',N(sum.all_amount)],['成功笔数',C(sum.success_count)+' 笔'],['成功金额',N(sum.success_amount)],['成功率',partial?'—':R(sum.success_count,sum.all_count)]].map(([label,value])=>'<span><small>'+label+'</small><b>'+value+'</b></span>').join('')+'</div>';
 }
 function matrixBody(direction){
  const field=L.matrixMode==='range'?'matrix_range':'matrix',rawRows=groupRows(field).filter(r=>r.direction===direction),rows=combine(rawRows,['bucket','hour']),exact=['100','200','300','400','500','750','1000','1500','2000','5000'],ranges=amountBandKeys(direction);
  const bands=L.matrixMode==='range'?ranges:exact,buckets=[...bands,...[...new Set(rows.map(r=>r.bucket))].filter(b=>!bands.includes(b))].filter(bucket=>!(state.page==='matrix'&&L.matrixMode==='range'&&bucket==='below')),enabled=state.page==='matrix'&&analysis,label=bucket=>amountLabel(bucket,direction),headers=['金额 / 时',...Array.from({length:24},(_,h)=>String(h).padStart(2,'0')+'时'),'24小时合计'];
  const cells=bucket=>[matrixBandCell(bucket,direction),...Array.from({length:24},(_,hour)=>{
   const found=rows.find(r=>r.bucket===bucket&&Number(r.hour)===hour),base=!found&&aggregateReadStatus().incomplete?Object.fromEntries([...countKeys,...amountKeys].map(key=>[key,null])):empty(),r=pandaAnalysisRow({...base,direction,hour,...found},direction),body='<b>'+C(r.all_count)+'笔</b><span>'+N(r.all_amount).replace(/\.00$/,'')+'</span><span>'+(R(r.success_count,r.all_count))+'</span>';
   return enabled?'<button class="matrix-cell analysis-matrix-cell'+(analysis.isOpen({kind:field,direction,hour,bucket})?' is-selected':'')+'" aria-pressed="'+analysis.isOpen({kind:field,direction,hour,bucket})+'" title="展开 '+String(hour).padStart(2,'0')+'时 × '+E(label(bucket))+' 的平台及每日数据" onclick="liveMatrixSegment(\''+encodeURIComponent(JSON.stringify({kind:field,direction,hour,bucket})).replace(/'/g,'%27')+'\')">'+body+'</button>':'<div class="matrix-cell">'+body+'</div>';
  }),matrixTotalCell(bucket,direction,rawRows,field)];
  const chosen=L.analysisMatrixSelection?.[direction],body=enabled?analysis.table({id:'matrix-'+direction,exclusive:'matrix-'+direction,rowDetail:bucket=>chosen&&chosen.kind===field&&String(chosen.bucket)===String(bucket)?{segment:chosen,label:directionName(direction)+' · '+String(chosen.hour).padStart(2,'0')+'时 × '+label(bucket)}:null,headers,rows:buckets,cells,footerRows:matrixCustom?[matrixCustom.row(direction)]:[],footerDetail:()=>matrixCustom?.footerDetail(direction),segment:bucket=>({kind:L.matrixMode==='range'?'amount_range':'amount',direction,bucket}),label:bucket=>directionName(direction)+' · '+label(bucket)+' · 24小时合计'}):table(headers,buckets.map(cells),'live-matrix');
  return '<div class="matrix-hours-view '+(enabled?'analysis-compact analysis-matrix':'')+'"><div class="live-definition">每格从上到下：① 全部笔数　② 全部金额（'+E(L.currency)+'）　③ 成功率（成功 / 创建，含跨日）；'+amountNote(direction)+' 24小时合计汇总所选日期范围内 00–23 时，全部按创建时间、成功按成功时间。'+(enabled?'点击小时单格看交叉明细。':'')+'</div>'+body+'</div>';
 }
 window.liveMatrixSegment=function(encoded){try{const segment=JSON.parse(decodeURIComponent(encoded));L.analysisMatrixSelection=L.analysisMatrixSelection||{};L.analysisMatrixSelection[segment.direction]=segment;(analysis.isOpen(segment)?window.liveAnalysisAction(encoded,'toggle'):analysis.open(segment,directionName(segment.direction)+' · '+segment.hour+'时 × '+segment.bucket,'matrix-'+segment.direction))}catch{}};
 function matrixView(){const tools='<div class="live-tabs"><button class="'+(L.matrixMode==='exact'?'on':'')+'" onclick="liveMatrixMode(\'exact\')">精确金额</button><button class="'+(L.matrixMode==='range'?'on':'')+'" onclick="liveMatrixMode(\'range\')">金额区间</button></div>';return totals()+'<div class="section-switcher"><div class="tabs"><button class="'+(L.view!=='matrixDetail'?'on':'')+'" onclick="liveView(\'business\')">24 小时 × 金额段</button><button class="'+(L.view==='matrixDetail'?'on':'')+'" onclick="liveView(\'matrixDetail\')">高频组合的订单状态</button></div></div>'+(L.view==='matrixDetail'?matrixDetail():visibleDirections().map(d=>box(directionName(d)+' · 24 小时 × 金额段',matrixBody(d),'',tools)).join('')+(matrixCustom?.dialog()||''))}
 window.liveMatrixMode=function(mode){if(!['exact','range'].includes(mode))return;L.matrixMode=mode;render()};
 function matrixDetail(){const field=L.matrixMode==='range'?'matrix_range':'matrix',rows=combine(groupRows(field),['direction','bucket','hour','currency']).sort((a,b)=>b.all_count-a.all_count),size=L.localSize||20,page=Math.min(L.localPage||1,Math.max(1,Math.ceil(rows.length/size))),headers=['方向','金额档位','时段',...businessHeaders],cells=r=>[directionName(r.direction),E(amountLabel(r.bucket,r.direction)),String(r.hour).padStart(2,'0')+'时',...businessCells(r)],sorted=sortLoadedTable('matrix-detail',headers,rows,[{value:r=>directionName(r.direction),ascending:true},{value:r=>loadedSorting.knownNumber(bucketNumber(r.bucket)),ascending:true},{value:r=>loadedSorting.knownNumber(r.hour),ascending:true},...loadedBusinessColumns()]);return '<div class="analysis-compact">'+box('高频组合的订单状态',analysis.table({id:'matrix-detail',headers:sorted.headers,rows:sorted.rows.slice((page-1)*size,page*size),cells,segment:r=>({kind:field,direction:r.direction,hour:Number(r.hour),bucket:r.bucket}),label:r=>directionName(r.direction)+' · '+r.hour+'时 × '+amountLabel(r.bucket,r.direction)})+pager(rows.length,page,size,'local'),'全部按创建时间；成功金额、笔数按成功时间。')+'</div>'}


 function formatTime(value,zone){if(!value)return '—';const e=Date.parse(value);return Number.isFinite(e)?localClock(e,zone||'UTC').replace('T',' '):'—'}
 function detailFeeState(r){return r.fee_version_state==='complete'?'已匹配':r.fee_version_state==='partial'?'部分匹配':'待匹配'}
 function detailFeeVersion(r){return Array.isArray(r.fee_version_ids)&&r.fee_version_ids.length?E(r.fee_version_ids.join(' / ')):'—'}
 function pandaDetailsView(){
  const d=L.detail,p=d?.platform||selected()[0],zone=p?.timezone,withActual=p?.capabilities?.actualAmount===true,withFee=p?.capabilities?.recordedFee===true,withSuccess=L.direction==='charge'&&p?.capabilities?.chargeSourceCompletedTimeAvailable===true;
  const headers=['订单号','平台','三方','通道','方向','订单金额',...(withActual?['实际金额']:[]),...(withFee?['已记录手续费']:[]),'状态','创建时间',...(withSuccess?['成功时间（源订单完成时间）']:[]),'操作'];
  const rows=(d?.rows||[]).map((r,i)=>['<button class="link mono" onclick="liveOrder('+i+')">'+E(r.order_number||r.order_no||'—')+'</button>',E(p.name),E(r.provider||'未识别三方'),E(HensemProviderOrders.pandaChannel(r)),directionName(r.direction),HensemProviderOrders.moneyCell(r,{E,N}),...(withActual?[N(r.actual_amount)]:[]),...(withFee?[N(r.withdraw_fee)]:[]),E(statName(r.status_group||'unknown'))+'<small>'+E(r.status||'—')+'</small>',E(formatTime(r.created_at,zone)),...(withSuccess?[E(formatTime(r.success_at,zone))]:[]),'<button class="link" onclick="liveOrder('+i+')">查看 →</button>']);
  return box('订单列表',(L.detailBusy?'<div class="live-status">正在读取订单页…</div>':!d?'<div class="live-status">点击查询读取订单明细</div>':'')+table(headers,rows,'order-columns-v4')+pager(Number(d?.total||0),L.page,L.size,'server'),'按创建区间展示已入库订单；源完成时间不代表成功时间窗口已采齐。金额 '+E(p.currency)+'；未提供字段显示 —。');
 }
 function detailsView(){if(orderSource(L.detail?.platform||selected()[0])==='panda')return pandaDetailsView();const fee=L.view==='orderFees',version=L.view==='orderRates',d=L.detail,platform=d?.platform||selected()[0],zone=platform?.timezone;const successLabel=successTimeLabel(platform,d);const headers=version?['订单号','系统 ID','平台','三方','方向','百分比费率','固定费','费率版本','生效时间','失效时间','计费状态','操作']:fee?['订单号','系统 ID','平台','团队','三方','方向','订单金额','估算手续费','实际手续费','计费状态','费率版本','创建时间','操作']:['订单号','系统 ID','平台','团队','国家','三方','方向','订单金额','状态','核对标记',...(L.status==='success'?[successLabel,'创建时间']:['创建时间',successLabel]),'操作'];
 const rows=(d?.rows||[]).map((r,i)=>{const no='<button class="link mono" onclick="liveOrder('+i+')">'+E(r.order_number||r.orderNumber||r.order_no||'—')+'</button>',id=E(orderFieldValue(platform,'systemOrderId',r.system_order_id||r.source_id||r.id)||'—'),pn=E(platform?.name||'—'),provider=E(r.provider||'未提供'),dir=directionName(r.direction),action='<button class="link" onclick="liveOrder('+i+')">查看 →</button>',team=E(platform?.team||'未绑定团队'),time=E(formatTime(r.created_at,zone)),successTime=E(formatTime(r.success_at,zone));if(version)return [no,id,pn,provider,dir,r.fee_version_percent_rate==null?'—':E((Number(r.fee_version_percent_rate)*100).toFixed(2)+'%'),N(r.fee_version_fixed_fee),detailFeeVersion(r),E(formatTime(r.fee_version_effective_from,zone)),E(formatTime(r.fee_version_effective_until,zone)),detailFeeState(r),action];if(fee)return [no,id,pn,team,provider,dir,HensemProviderOrders.moneyCell(r,{E,N}),N(r.fee_version_estimated_amount),N(orderFieldValue(platform,'recordedFee',r.withdraw_fee)),detailFeeState(r),detailFeeVersion(r),time,action];return [no,id,pn,team,E(platform?.country||'—'),provider,dir,HensemProviderOrders.moneyCell(r,{E,N}),'<span class="live-badge '+E(r.status_group||r.status)+'">'+E(statName(r.status_group||r.status))+'</span>','—',...(L.status==='success'?[successTime,time]:[time,successTime]),action]});
 let info=L.platform==='all'?'<div class="live-status">请选择商户（平台）后查询逐笔订单。汇总统计包含当前全部授权平台。</div>':L.detailBusy?'<div class="live-status">正在读取订单页…</div>':!d?'<div class="live-status">点击查询读取订单明细</div>':'';
 return box('订单列表',info+table(headers,rows,'order-columns-v4')+pager(Number(d?.total||0),L.page,L.size,'server'),version?'按订单创建时间匹配已记录的费率版本':fee?'费用独立列；实际手续费仅展示来源已提供值':'成功订单按'+successLabel+'；全部拉单按创建时间 · 平台当地时间');}

 function durationRows(groups,direction,cumulative){const rows=combineAging((groups||[]).filter(r=>r.direction===direction));if(rows.length)return rows.sort((a,b)=>Number(a.bucket)-Number(b.bucket));const bounds=[300000,1800000,3600000,10800000,21600000,43200000,86400000,172800000,259200000,null];return Array.from({length:cumulative?9:10},(_,i)=>({direction,bucket:i,threshold_ms:bounds[i],min_ms:i?bounds[i-1]:null,max_ms:bounds[i],count:0,amount:0,denominator_count:0,denominator_amount:0}))}
 function durationFooter(direction,rows,pending){const summaryRow=plus(L.results.flatMap(x=>x.summary||[]).filter(r=>r.direction===direction)),validCount=Math.max(0,...rows.map(r=>Number(r.denominator_count||0))),validAmount=rows.some(r=>r.denominator_amount===null)?null:Math.max(0,...rows.map(r=>Number(r.denominator_amount||0))),candidateCount=Number(summaryRow[pending?'pending_count':'success_count']||0),candidateAmount=summaryRow[pending?'pending_amount':'success_amount'],excludedCount=Math.max(0,candidateCount-validCount),excludedAmount=candidateAmount===null||candidateAmount===undefined||validAmount===null?null:Math.max(0,Number(candidateAmount)-validAmount),label=pending?'本期仍代付中':'成功订单';return [['<strong>'+label+'待核对</strong>',N(excludedAmount),C(excludedCount),'—','—'],['<strong>'+label+'合计</strong>',N(candidateAmount),C(candidateCount),'—','—']]}
 function latencyView(pending=false){if(!pending&&visibleDirections().some(latencyUnavailable))return box("成功耗时分布",'所选来源未提供实际支付成功时间，到账时效暂不可统计。');const cumulative=L.view==='thresholds',name=(pending?'pending_age':'latency')+(cumulative?'_thresholds':''),groups=L.results.flatMap(x=>{const data=x.groups?.[name];return Array.isArray(data)?data:[]}),directions=pending?['withdraw']:visibleDirections(),headers=['耗时区间','金额 · '+E(L.currency),'笔数','笔数占比','金额占比'],tabs='<div class="live-tabs"><button class="'+(!cumulative?'on':'')+'" onclick="liveView(\'bands\')">互斥时长区间</button><button class="'+(cumulative?'on':'')+'" onclick="liveView(\'thresholds\')">超过指定时长</button></div>',panels=directions.map(direction=>{const rows=durationRows(groups,direction,cumulative),label=direction==='charge'?'充值 / 代收成功耗时':'提款 / 代付成功耗时',note=pending?'':L.results.some(r=>processingLatency(r.capabilities||r.platform?.capabilities||{}))?'订单处理耗时 = 源订单完成时间 − 创建时间，表示订单处理耗时，不代表银行到账时效；其他来源保留各自口径。':'按来源记录的成功时间 − 提交时间；时间无效订单不计入耗时分母。GAME66提款成功时间可能为源更新时间代理。';return box(label,table(headers,rows.map(r=>[E(durationLabel(r,cumulative)),N(r.amount),C(r.count),R(r.count,r.denominator_count),R(r.amount,r.denominator_amount)]),'',durationFooter(direction,rows,pending)),note)}).join('');return tabs+box(pending?'所选创建范围 · 仍待付订单等待时长':'充值 / 提款成功耗时分布','<div class="grid equal live-duration-paired">'+panels+'</div>',pending?'':'代收左、代付右分开显示；各方向占比分母为有效时间订单。')}
 function durationLabel(r,cumulative){const names={300000:'5分钟',1800000:'30分钟',3600000:'1小时',10800000:'3小时',21600000:'6小时',43200000:'12小时',86400000:'1天',172800000:'2天',259200000:'3天'};return cumulative?'超过 '+(names[r.threshold_ms]||r.threshold_ms+'毫秒'):r.min_ms==null?'5分钟以内':r.max_ms==null?'超过3天':(names[r.min_ms]||'0')+'–'+names[r.max_ms]}
 function combineAging(rows){const m=new Map();for(const r of rows){const key=[r.direction,r.bucket,r.kind].join('|');if(!m.has(key))m.set(key,{...r,count:0,amount:0,denominator_count:0,denominator_amount:0});const x=m.get(key);x.count+=Number(r.count||0);x.amount=x.amount===null||r.amount===null?null:x.amount+Number(r.amount||0);x.denominator_count+=Number(r.valid_count||0);x.denominator_amount=x.denominator_amount===null||r.valid_amount===null?null:x.denominator_amount+Number(r.valid_amount||0)}return [...m.values()]}
 const healthFilters={query:'',source:'',group:'',applied:{query:'',source:'',group:''}};
 window.liveHealthSet=function(key,value){if(!['query','source','group'].includes(key))return;healthFilters[key]=String(value||'').slice(0,200)};
 window.liveHealthQuery=function(form,event){
  if(state.page!=='data_health')return false;
  if(event){const input=event.target;if(event.defaultPrevented||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||input?.tagName!=='INPUT'||input.isContentEditable)return false;event.preventDefault();}
  if(!form?.reportValidity())return false;
  healthFilters.applied={query:healthFilters.query.trim().toLocaleLowerCase(),source:healthFilters.source,group:healthFilters.group};L.localPage=1;render();return false;
 };
 window.liveHealthReset=function(){if(state.page!=='data_health')return;Object.assign(healthFilters,{query:'',source:'',group:'',applied:{query:'',source:'',group:''}});L.localPage=1;render()};
 function health(){
  const {query,source,group}=healthFilters.applied,choices=values=>[...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
  const rows=L.catalog.filter(p=>(!source||p.source===source)&&(!group||p.country===group||p.scopeGroup===group)&&(!query||[p.name,p.sourceName,p.team,p.country,p.scopeGroup].some(value=>String(value||'').toLocaleLowerCase().includes(query))));
  const form='<form class="live-filters live-health-filters" aria-label="平台目录查询" onsubmit="return false" onkeydown="liveHealthQuery(this,event)">'+
   '<div class="live-field"><label for="healthQuery">平台 / 团队</label><input id="healthQuery" type="search" maxlength="200" placeholder="搜索平台或团队" value="'+E(healthFilters.query)+'" oninput="liveHealthSet(\'query\',this.value)"></div>'+
   '<div class="live-field"><label for="healthSource">来源系统</label><select id="healthSource" onchange="liveHealthSet(\'source\',this.value)">'+option('','全部来源',healthFilters.source)+choices(L.catalog.map(p=>p.source)).map(value=>option(value,value,healthFilters.source)).join('')+'</select></div>'+
   '<div class="live-field"><label for="healthGroup">国家 / 授权分组</label><select id="healthGroup" onchange="liveHealthSet(\'group\',this.value)">'+option('','全部国家 / 分组',healthFilters.group)+choices(L.catalog.flatMap(p=>[p.country,p.scopeGroup])).map(value=>option(value,value,healthFilters.group)).join('')+'</select></div>'+
   '<div class="live-actions"><button type="button" class="btn primary" onclick="liveHealthQuery(this.form)">查询</button><button type="button" class="btn" onclick="liveHealthReset()">重置</button></div></form>';
  return '<div class="live-health">'+[['正式订单','已连接生产库已采集订单。只读取账号范围内的平台；不代表采集前的源系统历史已完整入库。'],['成功率','同一平台、方向、币种、创建时间范围：成功笔数按成功时间；全部订单笔数按创建时间。跨币种分别查询。'],['费用','费率表展示当前正式配置原文；复杂阶梯费率尚未逐单匹配，不显示猜算费用。历史生效版本尚未入库。'],['待付与时效','待付只针对所选提交日期内仍待付记录。缺成功时间不会伪造耗时；源数据更新时间与查询时间分开。'],['工单','Google存款核对为读取快照。AR汇总仅有工单处理状态；新AR部分成功工单缺成功时间。'],['账号与在线','实际账号操作在右上角；后台在线按最近 120 秒心跳、同账号去重，名单按账号权限展示。']].map(([t,b])=>'<article><h3>'+t+'</h3><p>'+b+'</p></article>').join('')+'</div>'+form+pagedTable(['平台','来源','授权分组','时区','币种'],rows.map(p=>[E(p.name),E(p.source),E(p.scopeGroup||p.country),E(p.timezone),E(p.currency)]),'当前授权内的正式平台','目录由数据库按当前账号数据范围返回。');
 }
 const gaps={dropped:['掉单核对','正式订单源没有已核对掉单标记；未成功订单不自动当作掉单。'],anomaly:['异常核对','金额、时间与状态缺失可在数据健康页查看；尚未连接真实异常事件流水。'],rules:['预警规则','自动风险调度未接入；规则设计样本保留在本地样本中。'],access:['账号与角色权限','右上角“查看授权”管理新版入口查看权限；实际账号与国家数据范围继续由现有管理后台控制。'],ip:['IP 白名单','此新版尚未接入正式IP策略，不能用本地勾选改变登录访问。'],login_logs:['登录日志','正式认证审计尚未接入本页，不展示样本账号登录记录。'],operation_logs:['操作日志','正式操作日志尚未接入本页，不展示模拟操作记录。'],teams:['团队平台配置','生产来源缺统一团队绑定，当前按源授权分组显示。原样本配置仍为本地草稿，不能改变正式数据授权。'],platform_systems:['平台包网系统配置','真实来源为AR / NEW_AR / GAME66，已加入全部业务筛选。业务包网名称绑定仍需正式配置表。']};
 function gapPage(key){return HensemLiveEmpty.render(key)}
 function ratesView(){if(L.feeView!=='normalized'&&window.HensemLiveRatesRestored)return HensemLiveRatesRestored.render();if(L.feeLoading)return '<div class="live-status">正在读取当前正式费率表…</div>';if(L.feeError)return '<div class="live-status live-error">'+E(L.feeError)+'</div>';if(!L.fees)return queryPrompt('点击查询读取当前费率。',true);const rows=L.fees.rows||[],options=L.fees.options||{};const filter='<div class="live-filters">'+select('feeScope','费率范围',[['all','全部费率'],['country','国家通用'],['platform','指定平台']])+select('feeCountry','国家 / 授权分组',[['all','全部授权范围'],...(options.countries||[]).map(c=>[c.value,c.label])])+input('feeQuery','三方名称')+'<div class="live-actions"><button class="btn primary" onclick="liveRates(true,true)">查询</button></div></div>';return filter+box('当前三方费率表',table(['三方','类型','范围','国家 / 分组','平台','代收费率','代收单笔费','代收限额','代付费率','代付单笔费','代付限额','状态','更新时间'],rows.map(r=>[E(r.provider),HensemProviderSummary.providerTypeCell(r,[r],r.country||r.scopeGroup,E),r.scopeType==='platform'?'平台专属':'国家通用',E(r.country||r.scopeGroup),E(r.platform||'—'),E(r.collectFee??'—'),E(r.collectSingleFee??'—'),E(r.collectLimit??'—'),E(r.payoutFee??'—'),E(r.payoutSingleFee??'—'),E(r.payoutLimit??'—'),E(r.status||r.rawStatus||'—'),E(r.updatedAt?formatTime(r.updatedAt,'Asia/Kolkata'):'—')]))+pager(Number(L.fees.total||0),L.feePage,L.feeSize,'fee'),'当前正式费率原文；通用费率与平台专属费率分列，不将复杂金额档简化为平均费率。历史生效版本暂缺。')}

 window.liveDurationSet=function(key,value){if(!['durationMode','durationGroup','durationThreshold','durationQuery','durationDetail','durationOrderQuery'].includes(key))return;L[key]=value;render()};
 window.liveReferenceSet=function(key,value){if(!['view','dailyView','dailyMetric','direction'].includes(key))return;if(key==='direction'){liveSet(key,value);return}if(key==='view'&&value!=='trend'&&L.merchantTrend?.status==='loading')L.merchantTrend.status='paused';L[key]=value;L.localPage=1;render();if(key==='view'&&value==='trend'&&state.page==='merchants')return loadMerchantTrend();};
 window.liveReferenceDay=function(day){L.dailyDay=day;L.dailyView='selected';render()};
 window.liveReferenceEnd=function(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;L.to=day+'T23:59:59';L.from=new Date(Date.parse(day+'T00:00:00Z')-30*86400000).toISOString().slice(0,10)+'T00:00:00';L.dirty=true;render()};
 function workorderRows(){return Array.isArray(L.workorders?.rows)?L.workorders.rows:[]}
 function workorderMetric(value,money=false){return money?N(value):C(value)}
 function workordersView(){
  if(L.dirty)return '<div class="live-status">筛选条件已修改，点击查询读取未到账工单。</div>';
  if(L.workordersLoading)return '<div class="live-status">正在读取正式工单日汇总…</div>';
  if(L.workordersUnsupported)return '<div class="live-status">所选平台来源尚未接入工单数据</div>';
  if(L.workordersError)return '<div class="live-status live-error">'+E(L.workordersError)+'</div>';
  const result=L.workorders||{},summary=result.summary||{},by=result.byDirection||{},rows=workorderRows();
  const stats=[['提交金额',workorderMetric(summary.submittedAmount,true)],['提交笔数',workorderMetric(summary.submittedCount)],['到账成功金额',workorderMetric(summary.successAmount,true)],['到账成功笔数',workorderMetric(summary.successCount)],['未到账金额',workorderMetric(summary.notReceivedAmount,true)],['未到账笔数',workorderMetric(summary.notReceivedCount)]];
  const cards='<div class="live-metrics workorder-summary-metrics">'+stats.map(([label,value])=>metric(label,value)).join('')+'</div>';
  const directionRow=d=>{const x=by[d]||{};return [d==='charge'?'存款未到账':'取款未到账',workorderMetric(x.submittedAmount,true),workorderMetric(x.submittedCount),workorderMetric(x.successAmount,true),workorderMetric(x.successCount),workorderMetric(x.notReceivedAmount,true),workorderMetric(x.notReceivedCount),R(x.successCount,x.submittedCount)]};
  const detailRows=rows.map(r=>[E(r.date),E(r.country||r.countryCode||'—'),E(r.platform),E(r.provider),E(r.channelType),directionName(r.direction),workorderMetric(r.submittedAmount,true),workorderMetric(r.submittedCount),workorderMetric(r.successAmount,true),workorderMetric(r.successCount),workorderMetric(r.notReceivedAmount,true),workorderMetric(r.notReceivedCount),R(r.successCount,r.submittedCount),E(formatTime(r.sourceUpdatedAt,'UTC'))]);
  const total=Number(result.total||0),page=Number(L.workordersPage||1),size=Number(L.workordersSize||20);
  return cards+box('存款 / 取款未到账工单汇总',table(['方向','提交金额','提交笔数','到账成功金额','到账成功笔数','未到账金额','未到账笔数','笔数到账率'],[directionRow('charge'),directionRow('withdraw')]),'按工单提交日期统计；存款、取款分开展示。提交包含已成功工单，未到账 = 提交 − 已成功。')+box('工单记录',table(['日期','国家','平台','三方','通道','方向','提交金额','提交笔数','到账成功金额','到账成功笔数','未到账金额','未到账笔数','笔数到账率','源更新时间'],detailRows,'workorder-columns-v4')+pager(total,page,size,'workorders'),'当前来源是按日期 / 平台 / 三方 / 通道汇总的正式工单事实；逐笔工单 ID 和提交秒级时间不在这张源表中，不伪造逐笔编号。')
 }
 function workordersScope(){const base=[L.country,L.from,L.to,L.direction,selected().map(p=>p.id).sort()];try{return JSON.stringify([...base,providerQueryNames(activeValues('provider')).slice().sort()])}catch{return JSON.stringify([...base,{invalidProviderNames:activeValues('provider').slice()}])}}
 // One document, exact authorized JSON only. No provider or distinct-count projection.
 function createWorkorderExactCache(options){
  const completed=new Map(),jobs=new Map(),now=options.now||Date.now,copy=value=>JSON.parse(JSON.stringify(value));
  let bytes=0,generation=0,context=null;
  const denied=error=>['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(String(error?.code||''));
  const cancelled=()=>Object.assign(Error('工单读取已取消'),{name:'AbortError',code:'ADMIN_LIVE_CANCELLED'});
  function encode(value){
   if(value===null||typeof value!=='object')return JSON.stringify(value);
   return Array.isArray(value)?'['+value.map(encode).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+encode(value[key])).join(',')+'}';
  }
  function forget(key){const entry=completed.get(key);if(entry){bytes-=entry.bytes;completed.delete(key);}}
  function settle(waiter,error,value){if(waiter.done)return;waiter.done=true;waiter.job.waiters.delete(waiter);error?waiter.reject(error):waiter.resolve(copy(value));}
  function stop(job){job.cancelled=true;for(const waiter of [...job.waiters])settle(waiter,cancelled());job.controller.abort();if(jobs.get(job.key)===job)jobs.delete(job.key);}
  function cancel(){generation++;for(const job of [...jobs.values()])stop(job);}
  function clear(){for(const entry of completed.values())entry.invalidated=true;completed.clear();bytes=0;cancel();}
  function sync(){let value;try{value=options.context();}catch{clear();context=null;throw cancelled();}if(typeof value!=='string'||!value){clear();context=null;throw cancelled();}if(context!==value){clear();context=value;}return value;}
  function current(snapshot,isCurrent){return snapshot.generation===generation&&snapshot.context===sync()&&snapshot.identity===options.identity()&&(!isCurrent||isCurrent());}
  function prune(){for(const job of [...jobs.values()]){for(const waiter of [...job.waiters]){try{if(!current(job,waiter.isCurrent))settle(waiter,cancelled());}catch{settle(waiter,cancelled());}}if(!job.waiters.size)stop(job);}}
  function reusable(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.rows)&&Array.isArray(value.byProvider)&&value.byDirection&&typeof value.byDirection==='object'&&!Array.isArray(value.byDirection)&&value.partial!==true&&value.complete!==false&&value.available!==false&&!value.error&&value.meta?.partial!==true;}
  function hit(key){const entry=completed.get(key),at=now();if(!entry)return null;if(entry.invalidated||at<entry.readAt||at-entry.readAt>=30000){forget(key);return null;}completed.delete(key);completed.set(key,entry);return entry;}
  function remember(job,value){
   if(job.cancelled||job.generation!==generation||job.context!==context||!reusable(value))return;
   const saved=copy(value),size=(JSON.stringify(saved).length+job.key.length)*2+64;if(size>2*1024*1024)return;
   forget(job.key);completed.set(job.key,{value:saved,readAt:now(),bytes:size});bytes+=size;
   while(completed.size>8||bytes>8*1024*1024)forget(completed.keys().next().value);
  }
  function deliver(job,error,value){let accepted=0;for(const waiter of [...job.waiters]){try{if(!current(job,waiter.isCurrent))throw cancelled();if(error)throw error;waiter.validate?.(value);settle(waiter,null,value);accepted++;}catch(failure){settle(waiter,failure);}}return accepted;}
  async function run(job){
   try{prune();if(job.cancelled||!current(job))throw cancelled();const value=await options.request(copy(job.request),{signal:job.controller.signal});if(job.cancelled||job.controller.signal.aborted)return;if(deliver(job,null,value))remember(job,value);}
   catch(error){if(!job.cancelled){let authority=false;try{authority=denied(error)&&current(job);}catch{}deliver(job,error);if(authority)clear();}}
   finally{if(jobs.get(job.key)===job)jobs.delete(job.key);for(const waiter of [...job.waiters])settle(waiter,cancelled());}
  }
  function read(request,settings={}){
   try{
    const scope=sync(),identity=options.identity(),q=copy(request),key=encode([scope,identity,q]),snapshot={generation,context:scope,identity};
    if(typeof identity!=='string'||!identity||!current(snapshot,settings.isCurrent))throw cancelled();
    if(settings.force){const entry=completed.get(key);if(entry)entry.invalidated=true;forget(key);const old=jobs.get(key);if(old&&!old.force)stop(old);}
    else{const entry=hit(key);if(entry){prune();return Promise.resolve().then(()=>{if(!current(snapshot,settings.isCurrent)||entry.invalidated)throw cancelled();const fresh=hit(key);if(!fresh)return read(q,settings);settings.validate?.(fresh.value);return copy(fresh.value);});}}
    let job=jobs.get(key);
    if(!job){job={...snapshot,key,request:q,force:settings.force===true,cancelled:false,controller:new AbortController(),waiters:new Set()};jobs.set(key,job);Promise.resolve().then(()=>run(job));}
    return new Promise((resolve,reject)=>{job.waiters.add({job,resolve,reject,isCurrent:settings.isCurrent,validate:settings.validate,done:false});prune();});
   }catch(error){return Promise.reject(error);}
  }
  return {read,cancel,clear};
 }
 workordersReadCache=createWorkorderExactCache({request:(request,options)=>window.hensemLiveRequest(request,options),context:()=>roleAllowed(state.page,'view')&&roleAllowed(state.page,'query')?JSON.stringify([state.page,aggregateAccessContext()]):'',identity:()=>JSON.stringify(selected().map(p=>[p.id,p.source,p.sourceName,p.name,p.country,p.scopeGroup??p.scope_group,p.timezone,p.currency,p.capabilities??null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))});
 async function workordersLoad(preserveView=false,inPhase=false,force=false,isCurrent=()=>true){
  if(!L.catalogReady||phasedReadBusy()&&!inPhase)return;
  if(isSuccessAnalysis()&&(!roleAllowed(state.page,'query')||!successFullDays()||L.dirty||L.queryScope!==aggregateQueryScope()))return;
  const originPage=state.page,originNavigation=navigationRevision,originSerial=L.serial,originSuccessContext=isSuccessAnalysis()?successIdentity():null,savedScroll=preserveView?pageScroll():null;
  const paint=()=>{render();if(savedScroll&&state.page===originPage&&navigationRevision===originNavigation)restorePageScroll(savedScroll)};
  const renderIfPage=()=>{if(state.page==='workorders'||isSuccessAnalysis()||providerDirection(state.page)||state.page==='overview'&&L.overviewAnalysis)paint()};
  const serial=++L.workordersSerial,current=()=>serial===L.workordersSerial&&originSerial===L.serial&&originPage===state.page&&originNavigation===navigationRevision&&!L.dirty&&isCurrent();
  L.workordersLoading=true;L.workordersError='';L.workordersUnsupported=false;L.workorders=null;L.workordersScope=workordersScope();L.dirty=false;paint();
  try{
   const selectedPlatforms=selected(),list=selectedPlatforms.filter(p=>['ar','newar'].includes(orderSource(p)));
   if(!list.length){L.workordersLoading=false;L.workordersUnsupported=true;L.workordersError='所选平台来源尚未接入工单数据';renderIfPage();return;}
   const request={action:'workorders',startAt:L.from.slice(0,10)+'T00:00:00.000Z',endAt:L.to.slice(0,10)+'T23:59:59.000Z',country:L.country,platforms:[...new Set(list.flatMap(p=>[p.name,p.sourceName].filter(Boolean)))],direction:L.direction,offset:(L.workordersPage-1)*L.workordersSize,limit:L.workordersSize};
   const providers=providerQueryNames(activeValues('provider'));if(providers.length)request.providers=providers;
   const providerSummary=providerDirection(originPage)||originPage==='overview'&&L.overviewAnalysis,successAnalysis=isSuccessAnalysis();
   const validate=result=>{
    if(!result||result.partial===true||result.complete===false||result.available===false||result.error||result.meta?.partial===true)throw Error('工单汇总返回未完成，请单独重试工单');
    if(providerSummary&&(!Array.isArray(result.byProvider)||!result.byDirection||typeof result.byDirection!=='object'||Array.isArray(result.byDirection)))throw Error('工单汇总响应不完整，请单独重试工单');
    if(successAnalysis&&(!Array.isArray(result.byPlatformProvider)||result.startDate!==request.startAt.slice(0,10)||result.endDate!==request.endAt.slice(0,10)))throw Error('工单平台原单汇总或日期响应不完整，请单独重试工单');
   };
   const result=await workordersReadCache.read(request,{force,isCurrent:current,validate});
   if(!current()||originSuccessContext&&originSuccessContext!==successIdentity())return;
   L.workorders={...result,unsupportedPlatforms:selectedPlatforms.filter(p=>!['ar','newar'].includes(orderSource(p))).map(p=>p.name)};L.workordersLoading=false;renderIfPage();
  }catch(error){
   if(!current()||originSuccessContext&&originSuccessContext!==successIdentity())return;
   if(['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(String(error?.code||'')))workordersReadCache.clear();
   if(isSuccessAnalysis()&&['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(error?.code)){clearSuccessAuthority();render();return;}
   if(state.page==='providers'&&L.providerReadMode==='published'&&window.HensemProviderPublished?.denied(error)){clearPublishedAuthority();render();return;}
   L.workordersLoading=false;L.workordersError=error.message||'正式工单读取失败';renderIfPage();
  }
 }

 const reportPages=new Set(['overview','collection','payout','merchants','merchantproviders','teamops','teamcountries','teamplatforms']);
 const reportData=window.HensemLiveReportData?.create({L,E,N,C,R,displayAllowed:displayPlatformAllowed,nativeCatalog:()=>L.catalog.filter(p=>orderSource(p)!=='panda'),request:r=>window.hensemLiveRequest(r),render:()=>render(),accessContext:()=>{const s=window.hensemDataScope||{},a=window.hensemRoleAccess||{};return JSON.stringify([s.mode,s.identity,a.mode,a.roleId,a.version,a.assignmentVersion,a.canView,a.permissions]);}});
 const teamSheetReports=window.HensemTeamSheetQuery?.create({L,reportData,selection:selectedVisible,page:()=>state.page,providers:()=>activeValues('provider','')});
 let pendingCatalogTask=null,pendingCatalogContext=null,pendingSnapshotPhase=null;
 const pendingCatalogScope=()=>JSON.stringify([L.country,L.from,L.to,L.direction,L.status,...['team','source','platform','provider'].map(key=>activeValues(key))]);
 function preparePendingCatalog(){
  if(!L.catalogReady||!Array.isArray(L.catalog)||!Array.isArray(L.withdrawCatalog))throw Error('快照平台目录尚未就绪，请重试读取目录');
  if(!reportData)return;
  pendingCatalogContext={serial:L.serial,navigation:navigationRevision,scope:pendingCatalogScope()};
  if(pendingCatalogTask)return;
  // Preserve supplementary directory discovery, but never await it before a
  // scoped snapshot read. Only this unchanged manual query may refresh later.
  const task=reportData.loadCatalog();pendingCatalogTask=task;
  const settled=()=>{if(pendingCatalogTask!==task)return;pendingCatalogTask=null;const context=pendingCatalogContext;if(context.serial===L.serial&&context.navigation===navigationRevision&&state.page==='overview'&&!L.dirty&&context.scope===pendingCatalogScope())pendingSnapshot?.refreshScope();};
  void task.then(settled,settled);
 }
 const pendingCatalogComplete=()=>{const chosen=activeValues('platform');return !reportData||chosen.length>0&&chosen.every(id=>selectedVisible().some(p=>p.id===id||(p.aliasPlatformIds||[]).includes(id)))||reportData.state.catalogLoaded&&!reportData.state.catalogBusy&&!reportData.state.catalogError;};
 // Midnight snapshots use the same authorized base directories as pending analysis;
 // an unrelated historical report inventory timeout must not block their read.
 pendingSnapshot=window.HensemLivePendingSnapshot?.create({L,E,N,C,accessContext:()=>roleAllowed(state.page,'query')?aggregateAccessContext():'',scopeZone,selected:selectedVisible,providers:()=>activeValues('provider',''),currentOrders:()=>({platforms:L.queryPlatforms,results:L.results,loading:L.loading,retrying:L.queryRetrying,paused:L.queryPaused,failures:L.queryFailures,queriedAt:new Date(L.queryNow).toISOString(),scopeMatches:!L.dirty&&L.queryScope===aggregateQueryScope()&&state.page==='overview',status:L.status}),canLoad:()=>state.page==='overview'&&L.direction!=='charge'&&!L.queryRetrying&&(!L.loading||pendingSnapshotPhase===L.serial),prepare:preparePendingCatalog,catalogComplete:pendingCatalogComplete,request:r=>window.hensemLiveRequest(r),render:()=>render(),open:(title,html)=>openDrawer(title,html)})||null;
 pendingOrders=window.HensemPendingOrders?.create({E,N,C,active:()=>state.page==='stuck'&&!L.dirty,scope:()=>JSON.stringify([L.from,L.to,L.country,L.team,L.source,L.platform,L.multi]),canDetail:()=>roleAllowed('stuck','detail'),request:r=>window.hensemLiveRequest(r),open:(title,html)=>openDrawer(title,html)})||null;
 // Snapshot identities are already in the authorized core/withdrawal catalog.
 // The historical report inventory adds no authority and must not gate this read.
 pendingAnalysis=window.HensemLivePendingAnalysis?.create({L,E,N,C,canDetail:()=>roleAllowed('stuck','detail'),openDetail:input=>pendingOrders?.open(input),selected:selectedVisible,providers:()=>activeValues('provider',''),prepare:()=>{if(!L.catalogReady||!Array.isArray(L.catalog)||!Array.isArray(L.withdrawCatalog))throw Error('快照平台目录尚未就绪，请重试读取目录')},request:r=>window.hensemLiveRequest(r),render:()=>{if(state.page==='stuck')render()}})||null;
 window.livePendingSnapshotRetry=()=>{
  if(state.page!=='overview'||L.dirty||L.direction==='charge')return;
  try{if(window.HensemLivePendingSnapshot?.requestPeriod(String(L.to||'').slice(0,10),scopeZone(),L.queryNow).mode==='current')return L.queryFailures.length||L.queryPaused?window.liveRetryFailed(L.queryPaused):window.liveQuery(true);}catch{}
  // A retry while the same snapshot is already reading shares that read;
  // completed/error states explicitly bypass their cached result.
  return pendingSnapshot?.load(pendingSnapshot.state?.status!=='loading');
 };
 window.livePendingSnapshotDetails=()=>pendingSnapshot?.details();
 channelStatus=window.HensemLiveChannelStatus?.create({L,getPage:()=>state.page,catalog:visibleCatalog,selected:selectedVisible,activeValues,roleAllowed:action=>roleAllowed('channel_status',action),request:r=>window.hensemLiveRequest(r),render:()=>{if(isChannelStatus())render()}})||null;
 dailyComparison=window.HensemLiveDailyComparison?.create({L,E,N,C,R,getPage:()=>state.page,selected:selectedVisible,nativePlatforms:selected,authorizedPlatforms:visibleCatalog,accessContext:aggregateAccessContext,cancelReads:()=>{cancelAggregateReads();window.hensemLiveCancelRequests?.(['aggregatePrepared','workorders'])},readAggregate:(q,serial,refresh=false)=>{if(refresh)preparedRefreshScope={serial:serial??L.serial,page:state.page,context:aggregateAccessContext()};return readAggregate(q,serial??L.serial,false,true)},instant,localClock,activeValues,ensureFeeLookup,prepareFeeLookupQuery,scopeZone,render:()=>{if(isDailyComparison())render()},roleAllowed:action=>roleAllowed('daily_comparison',action),allowed:action=>roleAllowed('daily_comparison',action),request:r=>window.hensemLiveRequest(r)})||null;
 submissionAnalysis=window.HensemSubmissionAnalysis?.create({L,E,N,C,dashboard:()=>state.page==='events',isPublished:()=>state.page==='providers'&&L.providerReadMode==='published',retryPublished:()=>window.liveQuery(true),accessContext:()=>roleAllowed(state.page,'query')?aggregateAccessContext():'',readTime:stamp=>formatTime(new Date(stamp).toISOString(),scopeZone()),beforeRead:()=>{if(state.page==='events'){window.HensemLiveSyncHealth?.cancel?.();window.hensemLiveCancelRequests?.(['syncHealth']);}},selected:selectedVisible,query,request:(r,options)=>window.hensemLiveRequest(r,options),canStart:()=>roleAllowed(state.page,'query')&&(!phasedReadBusy()||state.page==='events'),render:()=>render(),open:(title,html)=>openDrawer(title,html),box,table})||null;
 memberCounts=window.HensemLiveMemberCounts?.create({L,E,N,C,accessContext:()=>roleAllowed(state.page,'query')?aggregateAccessContext():'',selected:selectedVisible,query,successClockUnavailable:(platform,direction)=>orderSource(platform)==='newar'&&direction==='withdraw'&&sourceSuccessTimeUnavailable(platform,L.results.find(result=>result.platform?.id===platform.id),direction),request:r=>window.hensemLiveRequest(r),render:()=>render(),open:(title,html)=>openDrawer(title,html)})||null;
 window.liveMemberCountsDetails=(tab,basis)=>memberCounts?.details(tab,basis);
 window.liveMemberCountsRetry=async()=>{
  if(state.page==='overview'&&!L.dirty)return memberCounts?.load();
  if(state.page!=='merchants'||!memberCounts||!roleAllowed('merchants','view')||!roleAllowed('merchants','query')||!L.pageQueried||!L.catalogReady||L.dirty||L.loading||L.queryRetrying||phasedReadBusy()||L.queryScope!==aggregateQueryScope()||memberCounts.state.status==='loading')return;
  const serial=L.serial;beginReadPhases(serial);setReadPhase(serial,'重新读取会员人数');
  try{return await memberCounts.ensure(true,1)}finally{endReadPhases(serial)}
 };
 const collectedPage=HensemLiveCollectedData.create({L,E,C,N,box,table,request:q=>window.hensemLiveRequest(q),render:()=>{if(state.page==='collected_data')render()}});
 const withdrawPages=HensemLiveWithdrawPages.create({L,E,C,R,N,box,table,request:(q,options)=>window.hensemLiveRequest(q,options),onLoading:loading=>{L.autoWithdrawLoading=loading;if(loading){window.HensemLiveSyncHealth?.cancel?.();window.hensemLiveCancelRequests?.(['syncHealth']);}},render:()=>{if(isWithdrawPage(state.page))render()},page:()=>state.page});
 function autoWithdrawView(){return withdrawPages.render()}
 async function autoWithdrawLoad(reset=false){return withdrawPages.load(reset)}
 const depositPages=HensemLiveDepositIssues.create({L,E,C,N,R,metric,box,table,pager,formatTime,openDrawer:(title,html)=>openDrawer(title,html),page:()=>state.page,request:q=>window.hensemLiveRequest(q),render:()=>{if(['deposit_tracking','deposit_statistics'].includes(state.page))render()}});
 const workorderOperations=window.HensemLiveWorkorderOperations?.create({L,E,C,N,box,table,formatTime,page:()=>state.page,request:(q,options)=>window.hensemLiveRequest(q,options),render:()=>{if(isWorkorderOperations(state.page))render()},openDrawer:(title,html)=>openDrawer(title,html),renderDaily:workordersView,loadDaily:workordersLoad});
 function depositIssuesView(){return depositPages.render()}
 async function depositIssuesLoad(reset=false){return depositPages.load(reset)}
  function providerConfigView(){return configuration.providerView()}
  window.providerConfigSet=function(key,value){if(key==='providerConfigCountry'&&!countrySelectable(value))return;if(!['providerConfigRaw','providerConfigCanonical','providerConfigCountry','providerConfigPlatform','providerConfigDirection','providerConfigStatus'].includes(key))return;L[key]=String(value||'').slice(0,200);if(key==='providerConfigCountry'){L.providerConfigPlatform='all';providerConfigLoad(true)}};
  window.providerConfigReset=function(){Object.assign(L,{providerConfigRaw:'',providerConfigCanonical:'',providerConfigCountry:L.country,providerConfigPlatform:'all',providerConfigDirection:'all',providerConfigStatus:'all',providerConfigPage:1});providerConfigLoad()}
  async function providerConfigLoad(reset=false){if(!L.catalogReady)return;const renderIfPage=()=>{if(state.page==='provider_config')render()};if(L.providerConfigCountry==='all')L.providerConfigCountry=L.country;if(reset)L.providerConfigPage=1;const serial=++L.providerConfigSerial;L.providerConfigLoading=true;L.providerConfigError='';render();try{if(!L.providerConfigCountry||!countrySelectable(L.providerConfigCountry))throw Error('请选择具体国家后查询。');const request={action:'providerConfig',offset:(L.providerConfigPage-1)*L.providerConfigSize,limit:L.providerConfigSize};for(const [key,name] of [['providerConfigRaw','rawProvider'],['providerConfigCanonical','canonicalProvider']])if(L[key])request[name]=L[key];if(L.providerConfigCountry!=='all')request.country=L.providerConfigCountry;if(L.providerConfigPlatform!=='all')request.platform=L.providerConfigPlatform;if(L.providerConfigDirection!=='all')request.direction=L.providerConfigDirection;if(L.providerConfigStatus!=='all')request.status=L.providerConfigStatus;const result=await window.hensemLiveRequest(request);if(serial!==L.providerConfigSerial)return;L.providerConfig=result;L.providerConfigLoading=false;renderIfPage()}catch(e){if(serial!==L.providerConfigSerial)return;L.providerConfigLoading=false;L.providerConfigError=e.message||'三方归类读取失败';renderIfPage()}}

  function platformAssignmentsView(){return configuration.platformView()}
  window.platformAssignmentsSet=function(key,value){if(key==='teamPlatformCountry'&&!countrySelectable(value))return;if(!['teamPlatformTeam','teamPlatformCountry','teamPlatformSystem','teamPlatformQuery','teamPlatformStatus'].includes(key))return;const next=String(value||'').slice(0,200);if(L[key]===next)return;L[key]=next;L.platformAssignmentsSerial++;L.platformAssignmentsLoading=false;L.platformAssignmentsError='';L.platformAssignmentsDirty=true;configuration.platformChanged?.()};
  window.platformAssignmentsReset=function(){Object.assign(L,{teamPlatformTeam:'all',teamPlatformCountry:'all',teamPlatformSystem:'all',teamPlatformQuery:'',teamPlatformStatus:'all',platformAssignmentsPage:1});platformAssignmentsLoad()}
  async function platformAssignmentsLoad(reset=false){if(!L.catalogReady)return;const renderIfPage=()=>{if(state.page==='teams'||state.page==='platform_systems')render()};if(reset)L.platformAssignmentsPage=1;const serial=++L.platformAssignmentsSerial;L.platformAssignmentsLoading=true;L.platformAssignmentsError='';render();try{if(!L.teamPlatformCountry||!countrySelectable(L.teamPlatformCountry))throw Error('请选择具体国家后查询。');const request={action:'platformAssignments',offset:(L.platformAssignmentsPage-1)*L.platformAssignmentsSize,limit:L.platformAssignmentsSize};for(const [key,name] of [['teamPlatformTeam','team'],['teamPlatformCountry','country'],['teamPlatformSystem','system'],['teamPlatformQuery','platform']])if(L[key]&&L[key]!=='all')request[name]=L[key];if(L.teamPlatformStatus!=='all')request.status=L.teamPlatformStatus;const result=await window.hensemLiveRequest(request);if(serial!==L.platformAssignmentsSerial)return;L.platformAssignments=result;L.platformAssignmentsAppliedRequest={...request};L.platformAssignmentsDirty=false;L.platformAssignmentsLoading=false;renderIfPage()}catch(e){if(serial!==L.platformAssignmentsSerial)return;L.platformAssignmentsLoading=false;L.platformAssignmentsError=e.message||'团队平台归属读取失败';renderIfPage()}}
 window.providerConfigLoad=providerConfigLoad;window.platformAssignmentsLoad=platformAssignmentsLoad;
 const configuration=HensemLiveConfiguration.create({L,E,C,metric,box,table,pager,page:()=>state.page,request:q=>window.hensemLiveRequest(q),render:()=>render(),changed:async type=>{
   clearAggregateCache();reportData?.invalidateCatalog();const catalog=await window.hensemLiveRequest({action:'catalog'});L.catalog=catalog.platforms||[];L.dirty=true;L.results=[];L.providerOptionsKey='';
   await loadProviderOptions(true);if(type==='platform')await platformAssignmentsLoad();else if(state.page==='teams')await platformAssignmentsLoad();else await providerConfigLoad();
 }});
 const analysis=window.HensemAnalysisDrilldown?.create({L,E,N,C,R,query,formatTime,successTimeLabel,openDrawer:(title,html)=>openDrawer(title,html),customRows:segment=>matrixCustom?.detailRows(segment),customResults:segment=>matrixCustom?.customResults(segment),request:q=>window.hensemLiveRequest(q),render:()=>render()});
 matrixCustom=window.HensemMatrixCustomRange?.create({L,E,N,C,R,analysis,page:()=>state.page,allowed:()=>roleAllowed(state.page,'query'),selected,query,request:(q,serial)=>readAggregate(q,serial,false,true),successUnavailable:successTimeUnavailable,render:()=>render()});
 // A completed request is not proof of source collection coverage. This is
 // strictly the requested platform-read state for the visible overview.
 function aggregateReadStatus(){
  const requested=[...new Map((L.queryPlatforms||[]).filter(p=>p.id).map(p=>[p.id,p])).values()],failed=new Map((L.queryFailures||[]).map(f=>[f.id,f])),returned=new Set((L.results||[]).map(r=>r.platform?.id));
  const completed=requested.filter(p=>returned.has(p.id)&&!failed.has(p.id)),missing=requested.filter(p=>!returned.has(p.id)||failed.has(p.id));
  return {total:requested.length,done:completed.length,incomplete:requested.length>0&&(!!L.loading||!!L.queryRetrying||!!L.queryPaused||missing.length>0),missing:missing.map(p=>({name:p.name||p.id,error:failed.get(p.id)?.message||''}))};
 }
 function referencePage(){
  if(state.page==='merchants'&&L.view==='trend'&&L.loadedView!=='full'){
   const t=L.merchantTrend,loading=t?.status==='loading',note=loading?'正在按需读取订单趋势 '+(t.done||0)+' / '+(t.total||0)+' 平台':t?.status==='error'?'趋势读取未完成：'+t.error:'订单趋势尚未读取';
   return totals()+'<div class="section-switcher"><div class="tabs">'+[['business','商户经营清单'],['trend','商户订单趋势'],['providers','该商户的三方经营表现']].map(([key,label])=>'<button class="'+(L.view===key?'on':'')+'" onclick="liveReferenceSet(\'view\',\''+key+'\')">'+label+'</button>').join('')+'</div></div><div class="live-status" role="status">'+E(note)+(loading?'':' <button class="link" onclick="liveMerchantTrend()">读取订单趋势</button>')+'</div>';
  }
  return HensemLivePages.create({aggregateReadStatus,analysis,matrixCustom,pendingSnapshot,memberCounts,reportCatalogRows:reportData?.state.catalogError?[]:reportData?.state.catalogRows,successTimeSummary,successTimeUnavailable:(direction,rows)=>rows?successRowsTimeUnavailable(rows,direction):successTimeUnavailable(direction),successBasisLabel,analysisRow:pandaAnalysisRow,amountBandKeys,amountLabel,amountNote,L,E,N,C,R,plus,combine,groupRows,empty,table,box,pager,totals,comparisonRows,compareMetric,chart,matrixBody,latencyView,detailsView,providersView,platformsView,pagedTable,overviewChart,overviewAmounts,overviewAnalysisRender,businessHeaders,businessCells,feeForRow,ensureFeeLookup,providerCell,loadedFeeValue}).render(state.page)
 }
  // Report pages already have Query in the filter bar. Only standalone views
  // without that bar (the legacy rates view) need an action in the empty state.
  const queryPrompt=(text,showQueryAction=false)=>'<div class="live-status live-query-prompt"><span>'+E(text)+'</span>'+(showQueryAction?'<button type="button" class="btn primary" onclick="liveQuery()">查询数据</button>':'')+'</div>';
 function aggregateQueryNotice(){
  const status=aggregateReadStatus();if(!status.incomplete)return '';
  const active=L.loading||L.queryRetrying,failures=L.queryFailures||[],pendingOnly=failures.length>0&&failures.every(f=>aggregateFailureState(f).pending);
  const label=L.queryRetrying?'正在继续读取剩余平台':L.queryPaused?'查询已暂停':active?'正在读取':status.done?'查询未完成':'当前范围暂无可用统计';
  const scope=[L.country,L.from&&L.to?L.from+' 至 '+L.to:'',L.successFrom&&L.successTo?'成功时间 '+L.successFrom+' 至 '+L.successTo:'',activeValues('provider','').join(' / ')||'全部三方'].filter(Boolean).join(' · ');
  const detail=status.missing.map(p=>'<div>'+E(p.name)+'：'+E(p.error||(active?'正在读取':'尚未完成'))+'</div>').join('');
  return '<div class="live-status'+(!active&&!pendingOnly&&failures.length?' live-error':'')+'" data-aggregate-read-status role="status"><strong>'+label+' · 已读 '+C(status.done)+' / '+C(status.total)+' 平台</strong>'+(status.done?'；以下仅为已读取结果（小计）。':'；未完成数据不按 0 计算。')+(!active?'<button type="button" class="link" onclick="liveRetryFailed('+!!L.queryPaused+')">'+(L.queryPaused?'继续查询':'重试未完成平台')+'</button>':'')+'<div data-aggregate-query-scope>'+E(scope)+'</div>'+(detail?'<details><summary>查看未完成平台（'+C(status.missing.length)+'）</summary>'+detail+'</details>':'')+'</div>';
 }
 function unavailableAggregateQuery(){return '<section class="aggregate-query-unavailable">'+aggregateQueryNotice()+'</section>';}
  function content(){
  if(statisticWindowsEnabled()&&!roleAllowed(state.page,'query'))return queryPrompt('当前角色没有此页面的查询权限');
  const context=JSON.stringify([aggregateAccessContext(),visibleCatalog().map(p=>[p.id,p.source,p.sourceName,p.country,p.timezone,p.currency])]),retain=statisticWindowsEnabled()&&roleAllowed(state.page,'query');
  // Current verified platform results take precedence over an older complete
  // screen. A slow peer must not hide data already returned for this query.
  const currentPrepared=retain&&!L.dirty&&!L.error&&L.queryScope===aggregateQueryScope()&&L.results.length>0&&L.results.every(r=>r._preparedPublication&&r._aggregateAccessContext===aggregateAccessContext()&&L.queryPlatforms.some(p=>p.id===r.platform?.id));
  if(retain&&!currentPrepared&&(L.dirty||L.loading||L.error||L.queryFailures.length)&&L.retainedContent?.page===state.page&&L.retainedContent.context===context)return '<div class="live-panel-note" role="status">'+(L.dirty?'筛选已修改，点击查询后更新结果':L.loading?'正在读取所选范围，以下保留上次查询结果':'本次读取未完成，以下保留上次查询结果')+' · '+E(L.retainedContent.scope)+(L.error?' · '+E(L.error):'')+'</div><section class="live-retained-result" inert aria-label="上次查询结果">'+L.retainedContent.html+'</section>';
  const html=wgSourceNotice()+newarSuccessClockNotice()+duoliSourceNotice()+kbSourceNotice()+pandaSourceNotice()+pageContent()+(teamSheetReports?.hasReports()&&!teamSheetReports.onlyReports()?teamSheetReports.render():'');
  if(retain&&!L.dirty&&!L.loading&&!phasedReadBusy()&&L.pageQueried&&!L.error&&!L.queryFailures.length&&L.results.length&&L.results.length===L.queryPlatforms.length&&html.length<2000000)L.retainedContent={page:state.page,context,queryScope:aggregateQueryScope(),providerReadMode:L.providerReadMode,scope:[L.country,L.from+' 至 '+L.to,(L.successFrom&&L.successTo?'独立成功时间 '+L.successFrom+' 至 '+L.successTo:'成功日期默认沿查询日期')].filter(Boolean).join(' · '),html};
  return html;
 }
  function pageContent(){const teamNavigation=isTeamWorkspace(state.page)?teamWorkspaceNavigation():'';return teamNavigation+((isTeamWorkspace(state.page)||isSuccessAnalysis()||isDailyComparison()||isChannelStatus())&&!roleAllowed(state.page,'query')?queryPrompt('当前角色仅可查看此视图，未获查询权限。'):pageDataContent());}
  function pageDataContent(){if(teamSheetReports?.onlyReports())return teamSheetReports.render();if(L.pageQueried&&!L.dirty&&!selected().length&&['overview','collection','payout','merchants','merchantproviders','teamops','teamcountries','teamplatforms','time','amount','matrix','latency'].includes(state.page))return '<div class="live-status">所选平台暂无可用原始订单明细</div>';return orderContent();}
  function orderContent(){if(state.page==='providers'&&L.providerReadMode==='published')return publishedContent();if(['access','rules','ip','login_logs','operation_logs'].includes(state.page))return gapPage(state.page);if(!L.catalogReady)return L.catalogError?'<div class="live-status live-error live-catalog-status" role="alert"><span>平台目录未读取成功，尚未开始查询订单。'+E(L.catalogError)+'</span><button type="button" class="btn primary" onclick="liveRetryCatalog()">重试读取目录</button></div>':'<div class="live-status live-catalog-status" role="status">正在读取账号可见的平台目录…</div>';if(isChannelStatus())return (L.error?'<div class="live-status live-error">'+E(L.error)+'</div>':'')+(channelStatus?.render()||'<div class="live-status">平台通道调整暂不可用</div>');if(isDailyComparison())return (L.error?'<div class="live-status live-error">'+E(L.error)+'</div>':'')+(dailyComparison?.render()||'<div class="live-status">每日对比暂不可用</div>');if(!L.pageQueried&&!['collected_data','payout_config','auto_withdraw','withdraw_operators','teams','platform_systems','workorders','rates','data_health'].includes(state.page)&&!isWithdrawPage(state.page)&&!gaps[state.page]&&state.page!=='orders')return queryPrompt(L.error||'请选择筛选条件，点击查询。');if(state.page==='orders'&&L.catalogReady&&!orderPlatform())return orderSelectionNotice();if(state.page==='collected_data')return collectedPage.render();if(state.page==='payout_config')return HensemLivePayoutConfig.render();if(isWithdrawPage(state.page))return autoWithdrawView();if(state.page==='teams'||state.page==='platform_systems')return platformAssignmentsView();if(state.page==='workorders')return workordersView();if(state.page==='events')return submissionAnalysis?.render()||'<div class="live-status">刷单风控暂不可用</div>';if(gaps[state.page])return gapPage(state.page);if(state.page==='rates')return ratesView();if(state.page==='data_health')return health();if(isSuccessAnalysis())return successContent();if(L.error)return '<div class="live-status live-error">'+E(L.error)+'</div>';if(L.dirty)return queryPrompt('筛选条件已修改，点击查询读取对应的正式数据。');if(!L.catalogReady)return '<div class="live-status">正在验证权限并读取正式平台目录…</div>';if(state.page==='stuck')return pendingAnalysis?.page()||'<div class="live-status">代付中分析暂不可用</div>';if(L.loading&&!providerDirection(state.page)&&!(statisticWindowsEnabled()&&L.results.length)){return statisticWindowsEnabled()?aggregateQueryNotice():'<div class="live-status">'+E(L.progress||'正在读取正式订单…')+' · 当前为部分结果，尚非完整总计</div>'+((state.page==='overview'||isFlowPage(state.page))&&L.results.length?referencePage():'');}if(pandaAggregateBlocked())return aggregateQueryNotice()+pandaAggregateBlockedView();if(statisticWindowsEnabled()&&L.pageQueried&&!L.dirty&&!L.results.length&&L.queryPlatforms.length)return unavailableAggregateQuery();const duration=window.HensemLiveDuration?.create({analysis,L,E,N,C,R,box,table}).render(state.page);if(duration!=null)return aggregateQueryNotice()+duration;if(providerDirection(state.page))return (statisticWindowsEnabled()?'':'<div class="live-panel-note">实时明细汇总</div>')+(L.queryPaused?'<div class="live-status">查询已暂停，保留已读取结果。<button class="link" onclick="liveRetryFailed(true)">继续查询</button></div>':'')+HensemProviderSummary.render({L,E,N,C,R,plus,successTimeSummary,successTimeUnavailable,combine,groupRows,box,table,pager,submissionAnalysis,sourceBasis:successBasisNote(),feeForRow,ensureFeeLookup,providerCell,openDrawer:(title,html)=>openDrawer(title,html),render:()=>render()},providerDirection(state.page));const reference=referencePage();if(reference!==null)return (state.page==='overview'?'':aggregateQueryNotice())+reference;if(state.page==='orders')return (orderSource(orderPlatform())==='panda'?'':totals())+detailsView();if(state.page==='overview')return overview();if(state.page==='time')return timeView();if(state.page==='amount')return amountView();if(state.page==='matrix')return aggregateQueryNotice()+matrixView();if(state.page==='latency')return totals()+latencyView(false);if(['teamops','teamcountries','teamplatforms','merchants'].includes(state.page))return totals()+platformsView();if(state.page==='payout')return totals()+providersView()+latencyView(true)+latencyView(false);if(state.page==='collection')return totals()+providersView()+latencyView(false);if(state.page==='risk')return totals()+providersView()+box('加量判断','<div class="live-empty">先结合成功率、待付和耗时比较三方表现；当前缺少历史费率版本、持续稳定性与容量证据，不自动生成加量结论。</div>');return totals()+providersView()}
  let renderedNavigation='';
  function renderNavigation(){const key=state.page+'|'+state.navGroup;if(key===renderedNavigation)return;const g=groupForV3(state.page)||navGroupsV3[0];document.getElementById('nav').innerHTML=navGroupsV3.map(n=>'<div class="nav-center"><button class="center-button '+(g[0]===n[0]?'current':'')+'" onclick="toggleCenterV3(\''+n[0]+'\')"><span class="ico">'+n[1]+'</span><span class="nav-label">'+n[2]+'</span><span class="nav-arrow">'+(state.navGroup===n[0]?'⌄':'›')+'</span></button>'+(state.navGroup===n[0]?'<div class="subnav">'+n[3].filter(id=>id!=='platform_systems'&&(!isTeamWorkspace(id)||id===teamNavigationEntry())&&(n[0]!=='analysis'||!['orders','collection','payout'].includes(id))).map(id=>{const p=pages.find(p=>p[0]===id);return '<a class="'+(state.page===id||isTeamWorkspace(state.page)&&isTeamWorkspace(id)?'active':'')+'" href="'+E(window.hensemAdminPageUrl?.(id)||'#'+id)+'" target="_top" rel="noopener" onclick="return liveNavClick(event,\''+id+'\')"><span class="sub-dot"></span>'+E(p[2])+'</a>'}).join('')+'</div>':'')+'</div>').join('');renderedNavigation=key;}
  const adminBrand='M8 | 数据中控后台';
 function applyAdminBrand(){document.title=adminBrand;const label=document.querySelector('.sidebar .brand b');if(label)label.textContent=adminBrand;}
 function chrome(){const page=pages.find(p=>p[0]===state.page)||pages[0],g=groupForV3(page[0]);applyAdminBrand();document.getElementById('pageTitle').textContent=page[4];document.getElementById('pageSubtitle').textContent='';document.getElementById('eyebrow').textContent='';document.getElementById('crumbTitle').textContent=g[2]+' / '+page[2];renderNavigation();document.querySelector('.title-actions').innerHTML=!isChannelStatus()&&canExportCurrentPage()?'<button class="btn primary" onclick="liveExport()">导出当前表</button>':'';document.querySelector('.title-actions').style.display=isChannelStatus()?'none':'';document.getElementById('filters').style.display='none';document.getElementById('scope').style.display='none';document.querySelector('.bottom-note').innerHTML='';liveHeader();}
 const statisticWindowsEnabled=()=>!!window.HensemStatisticWindows?.enabled(state.page);
 let dateRangeOpen=false,dateRangeEditing=false;
 window.liveDateRangeToggle=function(open){dateRangeOpen=typeof open==='boolean'?open:!dateRangeOpen;const panel=document.getElementById('liveDatePanel'),button=document.getElementById('liveDateTrigger');if(panel)panel.hidden=!dateRangeOpen;if(button)button.setAttribute('aria-expanded',String(dateRangeOpen));if(!dateRangeOpen)button?.focus();};
 function dateRangeInfo(){const zones=[...new Set(selectedVisible().map(p=>p.timezone).filter(Boolean))],zone=isSuccessAnalysis()&&zones.length>1?'各平台当地时间':zones.length===1?zones[0]:scopeZone(),sameDay=L.from.slice(0,10)===L.to.slice(0,10),label=sameDay?L.from.slice(0,10):L.from.slice(5,10)+' 至 '+L.to.slice(5,10),clock=state.page==='stuck'?'日快照':L.from.slice(11)==='00:00:00'&&L.to.slice(11)==='23:59:59'?'全天':'自定义时间',title=(state.page==='stuck'?L.from.slice(0,10)+' 至 '+L.to.slice(0,10):L.from.replace('T',' ')+' 至 '+L.to.replace('T',' '))+' · '+zone;return {zone,label,clock,title}}
 function dateRange({dayOnly=state.page==='stuck'}={}){const {zone,label,clock,title}=dateRangeInfo();if(!dayOnly&&statisticWindowsEnabled())return HensemStatisticWindows.render(L,E,zone,{allowSourceUpdated:newarUpdatedClockSelectable()});return '<div class="live-field live-filter-date" onkeydown="if(event.key===\'Escape\')liveDateRangeToggle(false)"><label>'+ (dayOnly?'快照日期':'统计时间')+'</label><button type="button" id="liveDateTrigger" class="live-date-trigger" aria-expanded="'+dateRangeOpen+'" aria-controls="liveDatePanel" title="'+E(title)+'" onclick="liveDateRangeToggle()"><span data-date-caption>'+E(label)+'</span><small data-date-clock>'+E(clock)+'</small><span aria-hidden="true">▾</span></button><div id="liveDatePanel" class="live-date-panel" '+(dateRangeOpen?'':'hidden')+'><div class="live-date-panel-head"><strong>'+(dayOnly?'快照日期':'日期与时间')+'</strong><span>'+E(zone)+'</span><button type="button" class="link" aria-label="收起日期时间" onclick="liveDateRangeToggle(false)">收起</button></div><div class="live-date-controls">'+[['from','开始'],['to','结束']].map(([key,label],i)=>'<div class="live-date-endpoint"><label for="liveDate-'+key+'">'+label+'</label><input id="liveDate-'+key+'" aria-label="'+(i?'截止':'起始')+'日期" type="date" value="'+E(L[key].slice(0,10))+'" onchange="liveDateSet(\''+key+'\',\'date\',this.value)">'+(dayOnly?'':'<input aria-label="'+(i?'截止':'起始')+'时间（含秒）" type="time" step="1" value="'+E(L[key].slice(11)||(i?'23:59:59':'00:00:00'))+'" onchange="liveDateSet(\''+key+'\',\'time\',this.value)">')+'</div>').join('')+'</div><div class="live-date-panel-foot"><span>修改后点击查询</span><button type="button" class="btn" onclick="liveDateRangeToggle(false)">完成</button></div></div></div>'}
 window.liveDateSet=function(key,part,value){if(!['from','to'].includes(key)||!['date','time'].includes(part)||state.page==='stuck'&&part==='time')return;const current=L[key]||'T00:00:00';dateRangeEditing=true;try{liveSet(key,part==='date'?value+'T'+(state.page==='stuck'?(key==='to'?'23:59:59':'00:00:00'):(current.slice(11)||'00:00:00')):current.slice(0,10)+'T'+(value.length===5?value+':00':value))}finally{dateRangeEditing=false}};
 window.liveMetricTimeSet=function(key,value){
  if(!statisticWindowsEnabled()||!HensemStatisticWindows.fields.includes(key)||key==='successBasis'&&!['success','source_updated'].includes(value))return;
  HensemStatisticWindows.ensure(L);if(key!=='successBasis'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))value+=':00';
  dateRangeEditing=key!=='successBasis';try{liveSet(key,value)}finally{dateRangeEditing=false}
 };
 function directoryCoverage(){
  const rows=[...new Map(selectedVisible().map(p=>[p.id,p])).values()],orderIds=new Set(selected().map(p=>p.id)),reports=rows.filter(p=>!orderIds.has(p.id)&&p.reportConnected),directory=rows.filter(p=>!orderIds.has(p.id)&&!p.reportConnected);
  return '<span title="按当前国家、团队、平台与包网范围去重的可选目录；不是所选日期的数据完整率">可选目录 '+C(rows.length)+' 个平台</span><span>订单目录 '+C(orderIds.size)+' 平台</span>'+
   (reports.length?'<span title="目录中已收到日报或配置记录，不代表当前所选日期已收齐">已接入日报 / 配置 '+C(reports.length)+' 平台</span>':'')+
   (directory.length?'<span title="保留授权目录内的平台；查询后核对可用数据，当前未确认日报或配置接入">仅目录 '+C(directory.length)+' 平台 · 数据待确认</span>':'');
 }
 // Artifact TTL and the next scheduled refresh are distinct. Keep the stored
 // freshness/validation unchanged while describing a future schedule honestly.
 function publicationRefreshLabel(publications){
  if(publications.some(p=>['queued','running'].includes(p.refreshState)))return ' · 更新中';
  if(publications.some(p=>p.refreshState==='failed'))return ' · 更新未完成';
  const due=publications.filter(p=>p.freshness==='refresh_due');
  return due.length?(due.some(p=>!(Date.parse(p.nextRefreshAt)>Date.now()))?' · 待更新':' · 按计划更新'):'';
 }
 function filters(){
  normalizePageDirection();if(state.page==='orders'){const p=orderPlatform();for(const key of ['systemOrderId','thirdPartyOrderNumber','utr'])if(!orderCapability(p,key))L[key]='';if(p?.capabilities?.memberIdentity===false)L.memberId='';}syncCurrency();
  let mount=document.getElementById('liveFilters');if(!mount){mount=document.createElement('section');mount.id='liveFilters';document.getElementById('filters').after(mount)}
  mount.style.display=gaps[state.page]||['collected_data','data_health','rates','deposit_tracking','deposit_statistics','payout_config','auto_withdraw','withdraw_operators','channel_status'].includes(state.page)?'none':'';if(isChannelStatus()){mount.innerHTML='';return;}
  const fullCatalog=visibleCatalog(),list=platformCandidates(fullCatalog),countryCatalog=teamCatalog(fullCatalog).filter(p=>p.country===L.country),systems={ar:'AR系统',newar:'新AR系统',game66:'AA包网',lg:'LG系统',wg:'WG系统',duoli:'多利系统',kb:'KB系统',panda:'熊猫系统'},providerItems=[...new Set([...(isChannelStatus()?channelStatus?.providers()||[]:[...L.providerOptions,...(reportData?.providers()||[])]),...activeValues('provider','')])],teamItems=[...new Set(fullCatalog.map(platformTeam))].filter(t=>!['__team_pending__','__team_conflict__','归属待核对'].includes(t)).sort((a,b)=>String(a).localeCompare(String(b))),sourceItems=[...new Map(countryCatalog.map(p=>p.source).filter(backendSource).map(source=>[orderSource({source}),source])).values()].sort();
  const fields=multiSelect('team','所属团队',[['all','全部团队'],...teamItems.map(t=>[t,t==='__unassigned__'?'未绑定团队':t==='__team_pending__'?'团队待读取':t==='__team_conflict__'?'归属待核对':t])])+
   select('country','国家 / 地区',[...new Set(teamCatalog(fullCatalog).map(p=>p.country).filter(Boolean))].map(c=>[c,c]))+
   multiSelect('platform','商户（平台）',[['all','全部平台'],...list.map(p=>[p.id,p.name+(orderSource(p)==='panda'&&!p.reportOnly?' · 入库明细':'')+(p.historicalSource?' · 历史来源':'')+(!p.reportOnly&&queryableSource(p)?'':p.reportConnected?' · 日报 / 配置':' · 仅目录')])],true)+
   multiSelect('source','包网系统',[['all','全部系统'],...sourceItems.map(c=>[c,systems[orderSource({source:c})]||c])])+
   multiSelect('provider','三方',[['','全部三方'],...providerItems.map(p=>[p,p])])+
   (fixedDirection(state.page)||state.page==='provider_daily'?'':state.page==='latency'?select('direction','业务方向',[['charge','代收'],['withdraw','代付']]):multiSelect('direction','业务方向',[['all','全部'],['charge','代收'],['withdraw','代付']]));
  const shortcuts=[['today','今天'],['yesterday','昨日'],['before','前日'],...(!(isSuccessAnalysis()||isDailyComparison())?[['week','近1周'],['month','近1个月']]:[])].map(([k,l])=>'<button type="button" class="btn" '+(k==='today'?'title="'+(state.page==='stuck'?'按当地日期查看实际采集观察；午夜快照以真实采集证明为准':'按所选国家当地日期查看当前已入库数据')+'" ':'')+'onclick="livePeriod(\''+k+'\',false)">'+l+'</button>').join('');
  const preparedResults=L.results.filter(r=>r._preparedPublication),merchantCache=preparedResults.length&&preparedResults.length===L.results.length?'<span title="后台定时更新；逐日汇总由各日已准备统计合计，各日更新时间独立保留。刷新请求后台更新并读取上次完整结果。来源采集完整性另行核对。'+E(preparedResults.map(r=>r._preparedPublication.nextRefreshAt).filter(Boolean).length?' 下次计划更新 '+formatTime(preparedResults.map(r=>r._preparedPublication.nextRefreshAt).filter(Boolean).sort()[0],scopeZone()):'')+'">'+(preparedResults.some(r=>r._preparedPublication.kind==='daily_provider_rollup')?'逐日汇总':'定时汇总')+' · 更新于 '+E(formatTime(new Date(Math.min(...preparedResults.map(r=>Date.parse(r._preparedPublication.computedAt)))).toISOString(),scopeZone()))+publicationRefreshLabel(preparedResults.map(r=>r._preparedPublication))+'</span>':state.page==='providers'&&L.providerReadMode==='published'?'<span>已发布汇总 · 刷新读取最新发布版本</span>':usesQueryCache(state.page)&&L.results.length?'<span class="muted" title="查询可复用本次登录中的完整读取结果；刷新会重新读取。实时汇总缓存30秒，历史汇总最多5分钟。">数据读取 '+E(formatTime(new Date(Math.min(...L.results.map(r=>r._aggregateReadAt||L.queryNow))).toISOString(),scopeZone()))+(L.results.some(r=>r._aggregateCacheHit)?' · 缓存':'')+'</span>':'';
  const actions='<div class="live-actions live-query-actions"><button type="button" class="btn primary" onclick="liveDateRangeToggle(false);liveQuery()" '+(state.page==='orders'&&!orderPlatform()?'disabled title="请先选择一个商户（平台）"':'')+'>查询</button>'+(usesQueryCache(state.page)?'<button type="button" class="btn" onclick="liveRefresh()" '+(L.loading||phasedReadBusy()?'disabled':'')+' title="'+(state.page==='providers'&&L.providerReadMode==='published'?'重新读取已发布汇总与当前费率':statisticWindowsEnabled()?'读取上次完整汇总，并请求后台更新':'忽略本次登录的查询缓存，重新读取')+'">刷新</button>':'')+'<button type="button" class="btn" onclick="liveReset()">重置</button></div>';
  const search=state.page==='orders'?'<div class="live-search-row">'+input('systemOrderId','系统 ID','text',orderSearchAttributes('systemOrderId','源系统 ID'))+input('orderNumber','订单号')+input('thirdPartyOrderNumber','三方订单号','text',orderSearchAttributes('thirdPartyOrderNumber','三方订单号'))+input('utr','UTR 交易参考','text',orderSearchAttributes('utr','UTR'))+input('memberId','会员 ID','text',orderPlatform()?.capabilities?.memberIdentity===false?'disabled title="当前来源未提供会员身份"':'')+select('status','订单状态',[['all','全部状态'],['success','成功'],['pending','处理中'],['failed','失败'],['rejected','拒绝'],['unknown','未知']])+'</div>'+(wgSuccessFilterBlocked()?'<div class="live-panel-note" data-wg-success-filter>'+E(successFilterNote())+'</div>':''):'';
  const catalogDescription=directoryCoverage()+'<span>'+(L.providerOptionsBusy?'三方目录读取中':L.providerOptionsError?'三方目录读取失败':C(activeValues('provider','').length||providerItems.length)+' 三方')+'</span><span>'+C(new Set(selectedVisible().map(platformTeam).filter(t=>!['__unassigned__','__team_pending__','__team_conflict__','归属待核对'].includes(t))).size)+' 团队</span><span>'+C(new Set(selectedVisible().map(p=>p.country)).size)+' 国家</span>';
  const scopeMarkup=!L.catalogReady?'<span>'+(L.catalogLoading?'平台目录读取中…':'暂未读到平台目录，请重试')+'</span>':'<details class="live-scope-description"><summary>数据范围</summary><div>'+catalogDescription+'</div></details>'+orderCoverageLabel()+
   (L.providerOptionsError?'<span>三方目录读取失败</span>':'')+(fullCatalog.some(p=>platformTeam(p)==='__team_pending__')?'<span>部分平台团队待读取</span>':'')+(fullCatalog.some(p=>['__team_conflict__','归属待核对'].includes(platformTeam(p)))?'<span>部分平台归属待核对</span>':'');
  // Native date/time change can fire during pointer-down on Query/Done. Keep
  // those controls and the focused input alive while staging the new range.
  if(dateRangeEditing){const info=dateRangeInfo(),button=document.getElementById('liveDateTrigger'),scopeNode=mount.querySelector('.live-scope');if(button){const caption=button.querySelector('[data-date-caption]'),clock=button.querySelector('[data-date-clock]');if(caption)caption.textContent=info.label;if(clock)clock.textContent=info.clock;button.title=info.title;}if(scopeNode)scopeNode.innerHTML=scopeMarkup+merchantCache;return;}
  mount.innerHTML='<div class="live-filters live-business-filters"><div class="live-filter-fields" style="--filter-count:'+((fixedDirection(state.page)||state.page==='provider_daily')?5:6)+'">'+fields+'</div>'+(isChannelStatus()?'':isDailyComparison()?dateRange()+(dailyComparison?.filterDateExtras()||''):dateRange())+(isChannelStatus()?'':'<div class="live-date-shortcuts" aria-label="快捷日期">'+shortcuts+'</div>')+actions+search+'</div>'+'<div class="live-scope">'+scopeMarkup+merchantCache+'</div>';
 }

  window.liveHeader=function(){const host=document.querySelector('.top-right');const sample=host.querySelector('.sample');if(sample){sample.textContent=state.page==='deposit_tracking'?'存款未到账-跟进记录':isWithdrawPage(state.page)?(state.page==='withdraw_operators'?'操作人统计':'自动出款'):state.page==='provider_config'||state.page==='teams'||state.page==='platform_systems'?'Supabase归类':'正式数据';sample.title='Supabase 生产只读数据'}const currency=host.querySelector('span:nth-of-type(3)');if(currency)currency.textContent=L.currency;let mount=document.getElementById('headerActivityV3');if(!mount){mount=document.createElement('div');mount.id='headerActivityV3';mount.className='header-activity-v3';host.appendChild(mount)}mount.innerHTML=(window.HensemLivePresence?.button(headerIconV3('people'))||'<button class="live-header-button" title="后台在线人数暂无法读取" onclick="liveHeaderInfo(\'online\')">'+headerIconV3('people')+'<span>在线 —</span></button>')+'<button id="headerBellV3" class="live-header-button" aria-label="数据提醒" onclick="liveHeaderInfo(\'alerts\')">'+headerIconV3('bell')+(window.HensemLiveSyncHealth?.badge()||'')+'</button>';window.HensemLiveSyncHealth?.schedule(JSON.stringify([...L.catalog,...L.withdrawCatalog].map(p=>[p.id,p.country,p.scopeGroup,p.source]).sort()));};
  window.liveHeaderInfo=function(kind){if(kind==='online'&&window.HensemLivePresence){window.HensemLivePresence.open();return}if(kind==='alerts'&&window.HensemLiveSyncHealth){window.HensemLiveSyncHealth.open();return}let p=document.getElementById('live-header-pop');if(p){p.remove();return}p=document.createElement('div');p.id='live-header-pop';p.className='live-header-pop';p.innerHTML='<b>'+(kind==='online'?'后台在线账号':'正式数据提醒')+'</b><button class="link" style="float:right" onclick="this.parentNode.remove()">关闭</button><p>'+(kind==='online'?'后台在线人数暂无法读取，请重新加载后重试。':'正式订单已连接。历史费率版本、部分成功时间和风险事件仍有缺项；详见采集与数据健康。')+'</p>';document.querySelector('.topbar').appendChild(p)};
  function renderSupervisorPage(){
   const page=supervisorPages[state.page];
   document.body.classList.add('live-admin');HensemProviderSticky?.clear();
   applyAdminBrand();
   document.getElementById('pageTitle').textContent=page.label;
   document.getElementById('pageSubtitle').textContent='工单主管视图 · 员工测试站尚未接通';
   document.getElementById('eyebrow').textContent=page.eyebrow;
   document.getElementById('crumbTitle').textContent='工单运营中心 / '+page.label;renderNavigation();
   document.getElementById('filters').style.display='none';document.getElementById('scope').style.display='none';
   document.getElementById('liveFilters')?.style.setProperty('display','none');
   const actions=document.querySelector('.title-actions');actions.style.display='';
   actions.innerHTML='<button class="btn" onclick="setPage(\'workorders\')">工单未到账</button><button class="btn" onclick="setPage(\'deposit_tracking\')">存款未到账-跟进记录</button>';
   const pendingTables=page.tables.map(([title,columns,note])=>box(title,'<div class="live-table"><table aria-label="'+E(title)+'"><thead><tr>'+columns.map(label=>'<th>'+E(label)+'</th>').join('')+'</tr></thead><tbody><tr><td colspan="'+columns.length+'"><div class="live-empty">员工测试站尚未接通，记录待接入</div></td></tr></tbody></table></div>',E(note))).join('');
   document.getElementById('page').innerHTML='<div class="workorder-supervisor" data-workorder-supervisor="'+state.page+'"><div class="live-status" role="status"><strong>员工测试站尚未接通</strong><p>'+E(page.summary)+'</p><p>此页为主管视图预览，当前没有已连接的员工记录。</p></div>'+pendingTables+box('数据来源与现有入口','<div style="padding:14px 18px;line-height:1.8"><p>'+E(page.source)+'</p><p>工单未到账：现有 AR / 新 AR 工单日汇总。</p><p>存款未到账-跟进记录：现有录入表与 UPI 核对表的同步记录。</p><p>两个现有入口继续使用原账号的数据范围；员工记录需要单独接通员工测试站的授权数据。</p></div>')+'</div>';
   document.querySelector('.bottom-note').innerHTML='<span>工单主管视图 · 待接通</span><span>员工测试站记录尚未连接</span>';liveHeader();
  }
  const businessLiveHeader=window.liveHeader;
  window.liveHeader=function(){
   if(state.page==='collector_control'){const host=document.querySelector('.top-right'),sample=host.querySelector('.sample'),currency=host.querySelector('span:nth-of-type(3)');if(sample){sample.textContent='采集管理';sample.title='电脑回报的任务状态'}if(currency)currency.textContent='';const activity=document.getElementById('headerActivityV3');if(activity)activity.innerHTML='';return;}
   if(!isSupervisorPage(state.page))return businessLiveHeader();
   const host=document.querySelector('.top-right'),sample=host.querySelector('.sample'),currency=host.querySelector('span:nth-of-type(3)');
   if(sample){sample.textContent='员工测试站 · 待接通';sample.title='员工测试站尚未接通'}
   if(currency)currency.textContent='';
   const activity=document.getElementById('headerActivityV3');if(activity)activity.innerHTML='';
  };
  let snapshotShadow=null;
  let navigationBatch=0,navigationRevision=0,renderingPage=false,localPaginationPaint=false,localPaginationViewport=null;
  function renderCollectorPage(){const field=document.activeElement,editing=field?.id==='collectorComputerName',selection=editing?[field.selectionStart,field.selectionEnd]:null;chrome();document.getElementById('liveFilters')?.style.setProperty('display','none');document.querySelector('.title-actions').innerHTML='';collectorControl?.activate();document.getElementById('page').innerHTML=collectorControl?collectorControl.render():'<div class="live-status" role="alert">采集管理组件尚未载入，请重新加载后台。</div>';if(editing){const next=document.getElementById('collectorComputerName');if(next&&!next.disabled){next.focus({preventScroll:true});next.setSelectionRange?.(...selection)}}document.querySelector('.bottom-note').innerHTML='<span>本机采集管理</span><span>订单入库状态需逐份接入</span>';}
  function renderPage(){clearHiddenDashboardView();syncSuccessIdentity();syncPublishedIdentity();syncFeeLookupIdentity();if(feeLookupBatch&&!currentFeeIntent(feeLookupBatch))cancelFeeLookup();normalizePageDirection();prepareOverviewSections();document.body.classList.add('live-admin');HensemProviderSticky?.clear();if(isWorkorderOperations(state.page)&&workorderOperations){chrome();if(workorderOperations.isDaily())filters();else document.getElementById('liveFilters')?.style.setProperty('display','none');document.getElementById('page').innerHTML=workorderOperations.render();liveHeader();document.querySelector('.bottom-note').innerHTML='<span>工单运营中心</span><span>按当前筛选手动查询</span>';return}if(['deposit_tracking','deposit_statistics'].includes(state.page)){chrome();document.getElementById('liveFilters')?.style.setProperty('display','none');document.getElementById('page').innerHTML=depositIssuesView();liveHeader();document.querySelector('.bottom-note').innerHTML='<span>'+ (state.page==='deposit_tracking'?'员工原表与工单前端跟进记录':'UPI核对原始行与派生统计') +'</span><span>按当前筛选手动查询</span>';return}if(state.page==='provider_config'){chrome();document.getElementById('liveFilters')?.style.setProperty('display','none');document.getElementById('page').innerHTML=providerConfigView();liveHeader();document.querySelector('.bottom-note').innerHTML='<span>Supabase 正式归类读模型</span><span>代收、代付共用分类；冲突与未归类单独列出</span>';return}if(state.page==='teams'||state.page==='platform_systems'){chrome();document.getElementById('liveFilters')?.style.setProperty('display','none');document.getElementById('page').innerHTML=platformAssignmentsView();liveHeader();document.querySelector('.bottom-note').innerHTML='<span>Supabase 团队 / 平台归属</span><span>映射可见；未配置平台单独列出</span>';return}chrome();filters();document.getElementById('page').innerHTML=(phasedReadBusy()&&!(state.page==='providers'&&L.providerReadMode==='published')?'<div class="live-status live-read-phase" role="status">'+E(readPhase.label)+(state.page==='providers'?'':' · 后续统计依次读取')+'</div>':'')+content();HensemProviderSticky?.mount();mountOverviewSections();if((state.page==='overview'&&L.overviewQueried||state.page==='merchants'&&L.pageQueried&&L.status==='all'&&!['orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr'].some(key=>L[key]))&&L.catalogReady&&!L.loading&&!phasedReadBusy()&&!L.feeLookupLoading&&!L.dirty&&!L.error&&!L.restoredPage&&!localPaginationPaint)memberCounts?.ensure();if(L.pageQueried&&(state.page==='events'||state.page==='providers'&&L.results.length>0)&&L.catalogReady&&!L.loading&&!phasedReadBusy()&&!L.queryRetrying&&!L.dirty&&!L.error&&!L.restoredPage&&!localPaginationPaint)submissionAnalysis?.ensure();}
  // Synchronous loader notifications belong to one navigation paint. Reentrant
  // renders from a lazy loader are already reflected by the current render.
  function roleControls(){
   if(window.hensemRoleAccess?.mode!=='assigned')return;
   for(const button of document.querySelectorAll?.('button[onclick]')||[]){const handler=button.getAttribute('onclick')||'';let action='';
    if(/liveExport/.test(handler))action='export';
    else if(/configPermissions/.test(handler))action='grant';
    else if(/configEdit|withdrawNote/.test(handler))action='edit';
    else if(/(?:Query|Load|Retry|liveQuery|liveRefresh|liveRetry|configQuery|workorderOperationsSearch)/.test(handler))action='query';
    if(action&&!roleAllowed(state.page,action)){button.disabled=true;button.title='当前角色没有此操作权限';}
   }
  }
  render=function(){if(navigationBatch||renderingPage)return;renderingPage=true;try{const paint=()=>{renderPageTabs();if(state.page==='collector_control')renderCollectorPage();else if(isSupervisorPage(state.page))renderSupervisorPage();else renderPage();roleControls();snapshotShadow?.sync()};if(submissionAnalysis?.withSnapshot)submissionAnalysis.withSnapshot(paint);else paint()}finally{renderingPage=false}};
 syncFilters=function(){};
 toggleCenterV3=function(id){state.navGroup=state.navGroup===id?'':id;renderNavigation()};

  // A single document owns all tabs. Only small controls are copied; aggregate
  // result objects are shared by reference, never cloned into multiple iframes.
  const pageTabs=new Map([[state.page,{page:state.page}]]);
  const pageFields=('pageQueried overviewQueried comparisonResults comparisonStatus comparisonError comparisonLabel queryNow overviewTab overviewAnalysis overviewSections overviewWorkordersStatus overviewIntake providerIntake providerComparisonIntake queryWarnings queryFailures queryPlatforms queryScope queryPaused multi team providerOptions providerOptionsKey providerOptionsError multiSearch country countryTouched currency platform source provider direction status from to successFrom successTo successBasis retainedContent orderNumber thirdPartyOrderNumber memberId systemOrderId utr page size detail view feeEstimateMode localPage localSize groups results loadedView merchantTrend dirty error progress workorders workordersError workordersUnsupported workordersScope workordersPage workordersSize successApplied successContext successWindows providerExpanded providerSort providerSortAsc matrixMode amountBandProfiles tablePages tableSizes analysisMatrixSelection dailyDay dailyMetric dailyView durationDetail durationGroup durationMode durationOrderQuery durationQuery durationThreshold restoredPage providerReadMode providerPublished publishedWindow').split(' ');
  const copiedControls=new Set(['multi','multiSearch','providerExpanded','tablePages','tableSizes','analysisMatrixSelection']);
  const initialTeamView=Object.fromEntries(pageFields.filter(key=>Object.prototype.hasOwnProperty.call(L,key)).map(key=>[key,copyControls(L[key])]));
  const teamQueryFilterFields=('multi multiSearch team country countryTouched currency platform source provider direction status from to successFrom successTo successBasis orderNumber thirdPartyOrderNumber memberId systemOrderId utr size localSize tableSizes providerOptions providerOptionsKey providerOptionsError matrixMode amountBandProfiles').split(' ');
  function teamWorkspaceTab(entry,key){
   if(!entry.view)return {...entry,page:key};
   if(roleAllowed(key,'query'))return {...entry,page:key,view:{...entry.view,view:'business'}};
   // A view grant permits the directory and controls, not another view's queried facts.
   const view=copyControls(initialTeamView);
   for(const field of teamQueryFilterFields)if(Object.prototype.hasOwnProperty.call(entry.view,field))view[field]=copyControls(entry.view[field]);
   Object.assign(view,{view:'business',dirty:true});
   return {page:key,bootstrap:entry.bootstrap,view};
  }
  const initialDedicated=Object.fromEntries(Object.entries(L).filter(([key])=>/^(fee(?!Lookup)|depositIssues|providerConfig|platformAssignments|teamPlatform)/.test(key)));
  function copyControls(value){if(value===undefined)return value;return JSON.parse(JSON.stringify(value))}
  function scrollNodes(){const seen=new Map();return [...(document.getElementById('page')?.querySelectorAll('*')||[])].map((node,index)=>{const signature=node.id?'id:'+node.id:node.tagName?node.tagName+'|'+String(node.className||''):'index:'+index,ordinal=seen.get(signature)||0;seen.set(signature,ordinal+1);return {node,key:signature+'|'+ordinal}})}
  function pageScroll(){return {x:Number(window.scrollX)||0,y:Number(window.scrollY)||0,children:scrollNodes().map(({node,key})=>({key,x:Number(node.scrollLeft)||0,y:Number(node.scrollTop)||0})).filter(item=>item.x||item.y)}}
  function restorePageScroll(saved,viewport){if(!saved)return;const revision=navigationRevision,restore=()=>{if(revision!==navigationRevision)return;if(viewport)viewport.restoring=true;try{window.scrollTo(saved.x,saved.y);const children=new Map(scrollNodes().map(({key,node})=>[key,node]));for(const item of saved.children||[]){const node=children.get(item.key);if(node){node.scrollLeft=item.x;node.scrollTop=item.y}}}finally{if(viewport){viewport.x=Number(window.scrollX)||0;viewport.y=Number(window.scrollY)||0;viewport.restoring=false}}};restore();if(window.requestAnimationFrame)window.requestAnimationFrame(restore)}
  function savePageTab(){
   const entry=pageTabs.get(state.page);if(!entry)return;
   entry.bootstrap=!L.catalogReady;entry.scroll=pageScroll();entry.view={};for(const key of pageFields)if(Object.prototype.hasOwnProperty.call(L,key))entry.view[key]=copiedControls.has(key)?copyControls(L[key]):L[key];
   if(entry.bootstrap)entry.view.dirty=true;
   for(const key of ['providerIntake','providerComparisonIntake'])if(entry.view[key]?.status==='loading')entry.view[key]={...entry.view[key],status:'error',error:'采集核对已暂停，点击查询重新核对'};
   if(entry.view.overviewIntake)entry.view.overviewIntake=Object.fromEntries(Object.entries(entry.view.overviewIntake).map(([direction,data])=>[direction,data.status==='loading'?{...data,status:'error',error:'采集核对已暂停，点击查询重新核对'}:data]));
   if(L.providerOptionsBusy){entry.view.providerOptionsKey='';entry.view.providerOptionsError='目录读取已暂停，点击查询更新';}
   if(L.overviewSections)entry.view.overviewSections={...L.overviewSections,status:L.overviewSections.status==='loading'?'partial':L.overviewSections.status};
   if(L.overviewWorkordersStatus==='loading')entry.view.overviewWorkordersStatus='paused';
   if(L.merchantTrend?.status==='loading')entry.view.merchantTrend={...L.merchantTrend,status:'paused'};
   if(L.detailBusy)entry.view.error='订单明细读取已暂停，点击查询继续';if(L.workordersLoading)entry.view.workordersError='工单读取已暂停，可单独重试工单';
   if(L.comparisonStatus==='loading'){entry.view.comparisonStatus='error';entry.view.comparisonError='对比读取已暂停，点击查询更新';}
   // Navigation cancellation is resumable work, not a failed platform response.
   if((L.loading||L.queryRetrying)&&L.queryScope===aggregateQueryScope())entry.view.queryPaused=true;
   if(['deposit_tracking','deposit_statistics'].includes(state.page)){entry.depositWorkspace=depositPages.capture?.();entry.deposit=Object.fromEntries(Object.entries(L).filter(([key])=>/^depositIssues/.test(key)&&!/(Serial|Loading)$/.test(key)));if(L.depositIssuesLoading)entry.deposit.depositIssuesError='读取已暂停，点击查询更新';}
   // These modules copy their complete result trees. Save them only with the
   // page that uses them; unrelated tabs must not retain additional copies.
   if(isChannelStatus())entry.channelStatus=channelStatus?.capture();else delete entry.channelStatus;
   if(isDailyComparison())entry.dailyComparison=dailyComparison?.capture();else delete entry.dailyComparison;
   if(['events','providers'].includes(state.page))entry.submissionAnalysis=submissionAnalysis?.capture();else delete entry.submissionAnalysis;
   entry.memberCounts=memberCounts?.capture();entry.pendingSnapshot=pendingSnapshot?.capture();entry.pendingAnalysis=pendingAnalysis?.capture();entry.report=reportData?.capture?.();entry.analysis=analysis?.capture?.();entry.matrixCustom=matrixCustom?.capture();if(isWithdrawPage(state.page))entry.withdraw=withdrawPages.capture?.();
  }
  function restorePageTab(entry){
   const initialized={country:L.country,from:L.from,to:L.to,successFrom:L.successFrom,successTo:L.successTo,successBasis:L.successBasis};
   for(const key of pageFields){if(Object.prototype.hasOwnProperty.call(entry.view,key))L[key]=copiedControls.has(key)?copyControls(entry.view[key]):entry.view[key];else delete L[key]}
   if(entry.bootstrap&&L.catalogReady){for(const key of ['country','from','to','successBasis'])if(!L[key])L[key]=initialized[key];for(const key of ['successFrom','successTo'])if(L[key]==null)L[key]='';entry.bootstrap=false;initialDataDeferred=false;}
   if(entry.deposit){for(const key of Object.keys(L).filter(key=>/^depositIssues/.test(key)&&!/(Serial|Loading)$/.test(key)))delete L[key];Object.assign(L,entry.deposit);L.depositIssuesLoading=false;depositPages.restore?.(entry.depositWorkspace);}
   L.loading=false;L.queryRetrying=false;L.detailBusy=false;L.workordersLoading=false;L.providerOptionsBusy=false;L.restoredPage=true;L.inflightScope='';L.openMulti='';
   if(clearHiddenDashboardView())entry={};
   if(L.overviewSections)L.overviewSections={...L.overviewSections,scope:String(L.serial)+'|'+aggregateQueryScope(),workordersSerial:L.workordersSerial};
   normalizePageDirection();if((providerDirection(state.page)||isSuccessAnalysis())&&L.workordersScope&&L.workordersScope!==workordersScope()){L.workorders=null;L.workordersScope='';L.workordersError='工单筛选已变化，点击重试更新';}channelStatus?.restore(entry.channelStatus);dailyComparison?.restore(entry.dailyComparison);submissionAnalysis?.restore(entry.submissionAnalysis);memberCounts?.restore(entry.memberCounts);pendingSnapshot?.restore(entry.pendingSnapshot);pendingAnalysis?.restore(entry.pendingAnalysis);reportData?.restore?.(entry.report);void teamSheetReports?.discover();analysis?.restore?.(entry.analysis);matrixCustom?.restore(entry.matrixCustom);if(isWithdrawPage(state.page))withdrawPages.restore?.(entry.withdraw);if(state.page==='rates')window.HensemLiveRatesRestored?.resume?.();
  }
  function discardPageTab(key){
   pageTabs.delete(key);if(key==='channel_status')channelStatus?.clear?.();if(key==='daily_comparison')dailyComparison?.clear?.();workorderOperations?.clear?.(key);depositPages.clear?.(key);
   const prefix={rates:/^fee(?!Lookup)/,deposit_tracking:/^depositIssues/,deposit_statistics:/^depositIssues/,provider_config:/^providerConfig/,teams:/^(platformAssignments|teamPlatform)/}[key];
   if(prefix)for(const field of Object.keys(L).filter(field=>prefix.test(field))){if(/Serial$/.test(field))L[field]++;else if(Object.prototype.hasOwnProperty.call(initialDedicated,field))L[field]=copyControls(initialDedicated[field]);else delete L[field]}
   if(key==='rates')window.HensemLiveRatesRestored?.clear?.();if(key==='collected_data')collectedPage.clear?.();if(key==='payout_config')window.HensemLivePayoutConfig?.clear?.();
  }
  window.liveNavClick=function(event,key){if(event&&(event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return true;event?.preventDefault?.();setPage(key);return false};
  function navigationBlocked(){if(configuration.isSaving?.()){toast('归类正在保存或刷新，请稍候');return true}if(withdrawPages.state.noteSaving){toast('备注正在保存，请稍候');return true}return false}
  window.liveClosePage=function(key){if(!pageTabs.has(key)||navigationBlocked())return;const keys=[...pageTabs.keys()],index=keys.indexOf(key),active=key===state.page;discardPageTab(key);if(active){const next=keys[index+1]||keys[index-1]||(roleAllowed('overview')?'overview':pages[0][0]);setPage(next,{fresh:!pageTabs.has(next)});}else renderPageTabs()};
  window.liveCloseOtherPages=function(){if(navigationBlocked())return;for(const key of [...pageTabs.keys()])if(key!==state.page)discardPageTab(key);renderPageTabs()};
  window.liveCloseAllPages=function(){if(navigationBlocked())return;for(const key of [...pageTabs.keys()])discardPageTab(key);clearAggregateCache();providerIntake?.clearCache?.();submissionAnalysis?.clearCache?.();clearFeeLookupCache();setPage(roleAllowed('overview')?'overview':pages[0][0],{fresh:true})};
  function renderPageTabs(){
   let mount=document.getElementById('livePageTabs');if(!mount){mount=document.createElement('nav');mount.id='livePageTabs';mount.setAttribute('aria-label','已打开页面');document.querySelector('.topbar')?.after(mount)}
   if(!document.getElementById('livePageTabsStyle')){const style=document.createElement('style');style.id='livePageTabsStyle';style.textContent='.live-admin #livePageTabs{position:sticky;top:48px;z-index:29;display:flex;align-items:center;gap:4px;min-height:34px;padding:3px 12px;background:#f3f6fc;border-bottom:1px solid #dde5f2}.live-page-tab-list{display:flex;gap:4px;overflow-x:auto;min-width:0;flex:1}.live-page-tab{display:flex;align-items:center;flex-shrink:0;border:1px solid #dce5f3;border-radius:5px;background:#fff;overflow:hidden}.live-page-tab[aria-current="page"]{border-color:#4664ee;background:#edf1ff}.live-page-tab button{border:0;background:transparent;color:#506887;cursor:pointer;white-space:nowrap;font:inherit;font-size:11px;padding:5px 8px}.live-page-tab[aria-current="page"] button{color:#3150d5}.live-page-tab .live-page-close{padding:5px 7px;font-size:15px}.live-page-tab button:focus-visible,#livePageTabs>button:focus-visible{outline:2px solid #4169e1;outline-offset:-2px}#livePageTabs>button{border:0;background:transparent;color:#6a7f9e;white-space:nowrap;font-size:10px;cursor:pointer;padding:5px}.live-admin .subnav>a{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:11px 13px;border-radius:8px;color:inherit;text-decoration:none;font:inherit;font-size:12px}.live-admin .subnav>a.active{background:#304ed1;color:white}.live-admin .subnav>a:focus-visible{outline:2px solid #92b1fa;outline-offset:-2px}html{scroll-padding-top:96px}';document.body.appendChild(style)}
   mount.innerHTML='<div class="live-page-tab-list">'+[...pageTabs.keys()].map(key=>{const label=pages.find(p=>p[0]===key)?.[2]||key;return '<div class="live-page-tab"'+(key===state.page?' aria-current="page"':'')+'><button type="button" onclick="setPage(\''+key+'\')">'+E(label)+'</button><button type="button" class="live-page-close" aria-label="关闭 '+E(label)+'" onclick="liveClosePage(\''+key+'\')">×</button></div>'}).join('')+'</div><button type="button" onclick="liveCloseOtherPages()">关闭其他</button><button type="button" onclick="liveCloseAllPages()">关闭全部</button>';
  }
  setPage=function(key,options={}){if(key==='merchantproviders')key='merchants';if(key==='channelquality')key=roleAllowed('providers')?'providers':roleAllowed('overview')?'overview':pages[0][0];if(key==='platform_systems')key='teams';if(!roleAllowed(key)){toast('当前角色没有此目录权限');return;}if(!pages.some(p=>p[0]===key))return;if(!options.fresh&&key===state.page&&pageTabs.has(key))return;if(navigationBlocked())return;if(isTeamWorkspace(key)){const oldKey=[...pageTabs.keys()].find(isTeamWorkspace);if(oldKey&&oldKey!==key){if(state.page===oldKey)savePageTab();const entry=pageTabs.get(oldKey);pageTabs.delete(oldKey);pageTabs.set(key,teamWorkspaceTab(entry,key));}}if(!pageTabs.has(key)&&pageTabs.size>=12){toast('已打开 12 个页面，请先关闭不需要的页签');return}if(pageTabs.has(state.page))savePageTab();const saved=options.fresh?null:pageTabs.get(key);if(!pageTabs.has(key))pageTabs.set(key,{page:key});navigationBatch++;navigationRevision++;try{const queryInterrupted=(L.loading||L.queryRetrying||L.queryPaused)&&L.queryScope===aggregateQueryScope();configuration.pause?.();if(state.page==='payout_config')window.HensemLivePayoutConfig?.pause?.();if(state.page==='rates')window.HensemLiveRatesRestored?.pause?.();if(isWithdrawPage(state.page))withdrawPages.pause?.();if(isWorkorderOperations(state.page))workorderOperations?.pause();if(['deposit_tracking','deposit_statistics'].includes(state.page))depositPages.pause?.();L.serial++;cancelDataReads();L.providerOptionsSerial++;L.providerOptionsBusy=false;window.hensemLiveCancelRequests?.(['providerOptions']);L.queryRetrying=false;L.queryPaused=queryInterrupted;L.detailSerial++;L.loading=false;L.detailBusy=false;providerOrders.cancel();window.closeDrawer?.();if(saved?.view){state.page=key;state.navGroup=groupForV3(key)?.[0];restorePageTab(saved);location.hash=key;return}if(['deposit_tracking','deposit_statistics'].includes(key)){depositPages.restore?.(null);for(const field of Object.keys(L).filter(field=>/^depositIssues/.test(field)&&!/Serial$/.test(field))){if(Object.prototype.hasOwnProperty.call(initialDedicated,field))L[field]=initialDedicated[field];else delete L[field]}}L.restoredPage=false;window.HensemStatisticWindows?.reset(L);channelStatus?.restore(null);dailyComparison?.restore(null);submissionAnalysis?.restore(null);memberCounts?.restore(null);pendingSnapshot?.restore(null);pendingAnalysis?.restore(null);analysis?.restore?.(null);matrixCustom?.restore(null);reportData?.restore?.(null);if(isWithdrawPage(key))withdrawPages.restore?.(null);if(state.page==='orders'&&key!=='orders'){L.status='all';L.orderNumber='';L.thirdPartyOrderNumber='';L.memberId='';L.systemOrderId='';L.utr='';L.dirty=true}state.page=key;Object.assign(L,{retainedContent:null,successApplied:null,successContext:'',successWindows:[],providerReadMode:'live',providerPublished:null,pageQueried:false,overviewQueried:false,overviewSections:null,overviewWorkordersStatus:'idle',workordersUnsupported:false,results:[],comparisonResults:[],comparisonStatus:'idle',detail:null,workorders:null,queryFailures:[],queryWarnings:[],queryPlatforms:[],queryScope:'',queryPaused:false,providerExpanded:{},error:'',dirty:true});if(key==='overview'){reportData?.cancel();Object.assign(L,{overviewQueried:false,overviewSections:null,overviewWorkordersStatus:'idle',workordersUnsupported:false,results:[],comparisonResults:[],comparisonStatus:'idle',detail:null,workorders:null,queryFailures:[],queryWarnings:[],queryPlatforms:[],queryScope:'',queryPaused:false,providerExpanded:{},dirty:true});}if(key==='orders'&&!orderPlatform()){L.multi.platform=[];L.platform='all';L.detail=null;L.dirty=true;loadProviderOptions()}state.navGroup=groupForV3(key)?.[0];L.view='business';L.localPage=1;if(key==='workorders'){L.direction='all';L.workordersPage=1;L.dirty=true}if(['collection','providers','provider_daily','latency','events'].includes(key))L.direction='charge';if(['payout','stuck','provider_payout'].includes(key))L.direction='withdraw';L.multi.direction=L.direction==='all'?[]:[L.direction];if(key==='stuck')setPendingDefaultPeriod();if(key==='success_analysis'){normalizePageDirection();setSuccessDefaultDate();}if(key==='daily_comparison'){normalizePageDirection();setDailyDefaultDate();}if(key==='channel_status'){L.direction='all';L.multi.direction=[];L.status='all';}L.openMulti='';location.hash=key;render();window.scrollTo(0,0);if(isSupervisorPage(key)){reportData?.cancel();providerOrders.cancel();L.providerOptionsSerial++;if(L.providerOptionsBusy){L.providerOptionsBusy=false;L.providerOptionsKey=''}return}if(key==='overview'){if(!L.catalogReady||initialDataDeferred)initializeLiveData();render();return;}if(!L.catalogReady||initialDataDeferred){initializeLiveData();return}void teamSheetReports?.discover();// Business reads only start from an explicit query action.
}finally{navigationBatch--;render();if(saved?.view)restorePageScroll(saved.scroll);}};
  window.liveTeamView=function(key){if(!isTeamWorkspace(key)||!roleAllowed(key)||!pages.some(page=>page[0]===key)){toast('当前角色没有此团队视图权限');return;}if(key===state.page){L.view='business';L.localPage=1;render();return;}setPage(key);};
  window.liveSet=function(key,value){if(!Object.prototype.hasOwnProperty.call(L,key))return;const newarClockWasSelectable=newarUpdatedClockSelectable();if(key==='country'&&(!countrySelectable(value)||!new Set(teamCatalog().map(p=>p.country).filter(Boolean)).has(value)))return;if(key==='direction'&&!['all','charge','withdraw'].includes(value))return;if(key==='direction'&&(fixedDirection(state.page)||['provider_daily','latency'].includes(state.page)&&value==='all'))return;if(key==='country')L.countryTouched=true;L[key]=value;if(['team','source','platform','provider','direction'].includes(key))L.multi[key]=value&&value!=='all'?[value]:[];if(key==='country'){L.multi.provider=[];L.provider='';}if(key.startsWith('fee')){L.feeSerial++;return;}if(key==='team')alignTeamCountry();if(['team','country','source','platform'].includes(key))reconcileScopeSelections();if(newarClockWasSelectable&&!newarUpdatedClockSelectable())L.successBasis='success';reportData?.cancel();L.serial++;cancelDataReads();L.queryRetrying=false;L.detailSerial++;L.loading=false;L.detailBusy=false;syncCurrency();L.page=1;L.localPage=1;L.dirty=true;render();if(['country','source','team','platform','direction'].includes(key)&&!(state.page==='latency'&&key==='direction'))loadProviderOptions();};
 function alignTeamCountry(){const teams=activeValues('team');if(!teams.length)return;const matches=teamCatalog().filter(p=>countrySelectable(p.country));if(!countrySelectable(L.country)){L.country='';L.countryTouched=true;}else if(!matches.some(p=>p.country===L.country)){L.country=matches.find(p=>p.country)?.country||'';L.countryTouched=true;}L.multi.provider=[];L.provider='';}
 function setMultiValues(key,next){
  const newarClockWasSelectable=newarUpdatedClockSelectable();
  if(!['team','platform','source','provider','direction'].includes(key))return;
  if(key==='direction'&&(fixedDirection(state.page)||['provider_daily','latency'].includes(state.page)))return;
  if(key==='platform'&&state.page==='orders'){next=next.slice(-1);L.openMulti=''}
  L.multi[key]=next;L[key]=next.length===1?next[0]:key==='provider'?'':'all';if(key==='team')alignTeamCountry();if(['team','country','source','platform'].includes(key))reconcileScopeSelections();reportData?.cancel();
  if(key==='direction'&&state.page==='stuck'){L.multi.direction=['withdraw'];L.direction='withdraw'}
  if(newarClockWasSelectable&&!newarUpdatedClockSelectable())L.successBasis='success';


  L.serial++;cancelDataReads();L.queryRetrying=false;L.detailSerial++;L.workordersSerial++;L.workorders=null;L.loading=false;L.detailBusy=false;syncCurrency();L.page=1;L.localPage=1;L.dirty=true;render();
  if(key!=='provider')loadProviderOptions();
 }
 window.liveSetMultiOption=function(key,element){if(!element)return;const current=activeValues(key),value=String(element.value||'');if(key==='platform'&&state.page==='orders'){setMultiValues(key,element.checked?[value]:[]);return}setMultiValues(key,element.checked?[...new Set([...current,value])]:current.filter(v=>v!==value))};

 function setSuccessDefaultDate(){const end=L.to.slice(0,10),parsed=new Date(end+'T00:00:00Z'),date=/^\d{4}-\d{2}-\d{2}$/.test(end)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===end?end:localClock(Date.now(),scopeZone()).slice(0,10);L.from=date+'T00:00:00';L.to=date+'T23:59:59';window.HensemStatisticWindows?.reset(L);}
 function successFullDays(){return L.from.slice(11)==='00:00:00'&&L.to.slice(11)==='23:59:59';}
 function successWindows(platforms,now){if(statisticWindowsEnabled())return platforms.map(p=>({platformId:p.id,name:p.name,timezone:p.timezone,from:L.from,to:L.to,successFrom:L.successFrom,successTo:L.successTo,...statisticRequest(p),clamped:false}));return platforms.map(p=>{const range=HensemLiveCompare.currentWindowFor(L.from,L.to,p.timezone,now);if(!range.valid)throw Error(range.error);if(range.calendarDays>31)throw Error('每次最多31个当地日');if(L.to.slice(0,10)>localClock(now,p.timezone).slice(0,10))throw Error('结束日期不能晚于平台当地今天');return {platformId:p.id,name:p.name,timezone:p.timezone,from:range.currentFrom,to:range.currentTo,startAt:instant(range.currentFrom,p.timezone),endAt:instant(range.currentTo,p.timezone,true),clamped:range.clamped};});}
 function successIdentity(){return JSON.stringify([aggregateAccessContext(),visibleCatalog().map(p=>[p.id,p.source,p.sourceName,p.country,p.timezone,p.currency,p.capabilities]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);}
 function clearSuccessAuthority(){L.serial++;cancelDataReads();L.workordersSerial++;L.retainedContent=null;L.successApplied=null;L.successContext='';L.successWindows=[];L.results=[];L.workorders=null;L.queryPlatforms=[];L.queryFailures=[];L.queryWarnings=[];L.loading=false;L.queryRetrying=false;L.pageQueried=false;L.dirty=true;L.error='查询权限或平台目录已变化，请重新查询';}
 function syncSuccessIdentity(){if(isSuccessAnalysis()&&(L.successContext||L.successApplied)&&(!roleAllowed('success_analysis','query')||(L.successContext||L.successApplied.context)!==successIdentity()))clearSuccessAuthority();}
 function successContent(){
  syncSuccessIdentity();
  const api=window.HensemLiveSuccessAnalysis;if(!api)return '<div class="live-status">成功率分析暂不可用</div>';
  const current=!L.dirty&&L.queryScope===aggregateQueryScope()&&L.successContext===successIdentity();
  if(current){const fields=('pageQueried from to successFrom successTo successBasis queryPlatforms results queryFailures queryWarnings country workorders workordersLoading workordersError workordersUnsupported feeLookupRows feeLookupLoading feeLookupError loading restoredPage progress queryPaused queryRetrying error successWindows').split(' '),view=Object.fromEntries(fields.map(k=>[k,Array.isArray(L[k])?L[k].slice():L[k]]));view.dirty=false;view.workordersTimeUnsupported=!successFullDays();L.successApplied={context:L.successContext,view,workordersScopeMatches:L.workordersScope===workordersScope()};}
  const applied=L.successApplied;if(!applied)return (L.error?'<div class="live-status live-error">'+E(L.error)+'</div>':'')+queryPrompt('请选择日期与时间，点击查询。');
  const view=current?applied.view:{...applied.view,loading:false,queryRetrying:false,queryPaused:!!(applied.view.loading||applied.view.queryRetrying||applied.view.queryPaused),feeLookupLoading:false,feeLookupError:applied.view.feeLookupLoading?'类型读取已暂停':applied.view.feeLookupError,workordersLoading:false,workordersError:applied.view.workordersLoading?'工单读取已暂停':applied.view.workordersError,restoredPage:true},notice=!current?'<div class="live-status" role="status">筛选已修改，下方保留上次查询结果'+(L.error?' · '+E(L.error):'')+'</div>':'';
  return notice+api.render({L:current?{...L,workordersTimeUnsupported:!successFullDays()}:view,ensureFeeLookup:current?ensureFeeLookup:undefined,sortTable:current?sortLoadedTable:undefined,scopeMatches:true,workordersScopeMatches:applied.workordersScopeMatches});
 }
 function setDailyDefaultDate(){const date=new Date(localClock(Date.now(),scopeZone()).slice(0,10)+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-1);const day=date.toISOString().slice(0,10);L.from=day+'T00:00:00';L.to=day+'T23:59:59';window.HensemStatisticWindows?.reset(L);}
 function setPendingDefaultPeriod(){const today=localClock(Date.now(),scopeZone()).slice(0,10),end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);const start=new Date(end);start.setUTCDate(start.getUTCDate()-6);L.from=start.toISOString().slice(0,10)+'T00:00:00';L.to=end.toISOString().slice(0,10)+'T23:59:59'}
 window.livePeriod=function(mode,query=false){reportData?.cancel();const zone=scopeZone(),today=localClock(Date.now(),zone).slice(0,10),date=new Date(today+'T00:00:00Z'),end=new Date(date);if(mode==='yesterday'||mode==='before'){date.setUTCDate(date.getUTCDate()-(mode==='before'?2:1));end.setTime(date.getTime())}if(mode==='week'){date.setUTCDate(date.getUTCDate()-(state.page==='stuck'?7:6));if(state.page==='stuck')end.setUTCDate(end.getUTCDate()-1);}if(mode==='month'){if(state.page==='stuck'){date.setUTCDate(date.getUTCDate()-30);end.setUTCDate(end.getUTCDate()-1);}else date.setUTCDate(1);}L.from=date.toISOString().slice(0,10)+'T00:00:00';L.to=end.toISOString().slice(0,10)+'T23:59:59';L.serial++;cancelDataReads();L.queryRetrying=false;L.detailSerial++;L.dirty=true;L.loading=false;render();if(query)liveQuery()};
 window.liveReset=function(){window.HensemStatisticWindows?.reset(L);if(isChannelStatus())channelStatus?.clear?.();if(isDailyComparison())dailyComparison?.clear?.();L.providerOptionsSerial++;L.providerOptionsBusy=false;L.providerOptionsKey='';L.providerOptions=[];L.providerOptionsError='';window.hensemLiveCancelRequests?.(['providerOptions']);const selectable=visibleCatalog().filter(p=>countrySelectable(p.country)),base=selectable.find(p=>String(p.name||'').toUpperCase()==='91CLUB')||selectable[0]||{};const resetDirection=fixedDirection(state.page)||(['provider_daily','latency'].includes(state.page)?'charge':'all');Object.assign(L,{team:'all',country:base.country||'',countryTouched:false,platform:'all',source:'all',provider:'',direction:resetDirection,status:'all',orderNumber:'',thirdPartyOrderNumber:'',memberId:'',systemOrderId:'',utr:'',page:1,localPage:1,multi:{team:[],platform:[],source:[],provider:[],direction:resetDirection==='all'?[]:[resetDirection]}});if(isChannelStatus()){cancelDataReads();L.dirty=true;L.pageQueried=false;L.error='';render();return;}livePeriod(state.page==='stuck'?'week':'yesterday');};
 function query(p,action,previous=false){normalizePageDirection();if(isSuccessAnalysis()&&previous)throw Error('成功率分析不读取前期对比');if(!L.country||L.country==='all'||!countrySelectable(L.country))throw Error('请选择具体国家后查询。');if(!['all','charge','withdraw'].includes(L.direction))throw Error('请选择代收或代付');if(L.status==='success'&&wgSuccessFilterBlocked(p))throw Error(successFilterNote(p));const published=state.page==='providers'&&L.providerReadMode==='published'&&!L.dirty?L.publishedWindow:null,range=published?{valid:true,calendarDays:1,label:'较前一日同一时段 · 已发布同进度'}:HensemLiveCompare[isSuccessAnalysis()?'currentWindowFor':'windowFor'](L.from,L.to,p.timezone,L.queryNow);if(!range.valid)throw Error(range.error);if(!previous)L.comparisonLabel=range.label;const q={action,...(action==='aggregate'&&(aggregateMode()==='providers'||previous)&&L.status==='all'?{view:'providers'}:{}),platformId:p.id,startAt:published?published[previous?'previousStartAt':'startAt']:instant(previous?range.previousFrom:range.currentFrom,p.timezone),endAt:published?published[previous?'previousEndAt':'endAt']:instant(previous?range.previousTo:range.currentTo,p.timezone,true),direction:L.direction,status:L.status,currency:p.currency||null,offset:(L.page-1)*L.size,limit:L.size};if(range.calendarDays>31)throw Error('每次最多31个当地日');for(const key of ['orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr'])if(L[key]&&(!['thirdPartyOrderNumber','systemOrderId','utr'].includes(key)||orderCapability(p,key)))q[key]=L[key];const providers=providerQueryNames(activeValues('provider',''),p);if(providers.length)q.providers=providers;if(action==='aggregate'&&state.page==='latency'&&!previous&&q.view!=='providers')q.durationVersion=2;if(action==='aggregate'&&q.view!=='providers'&&!isSuccessAnalysis()&&!['time','latency'].includes(state.page)&&L.amountBandProfiles)q.amountBands=Object.fromEntries(Object.entries(L.amountBandProfiles).map(([d,p])=>[d,p.edges]));if(['aggregate','memberDaily'].includes(action)&&statisticWindowsEnabled())Object.assign(q,statisticRequest(p,previous));return q}
 function statisticRequest(platform,previous=false){
  HensemStatisticWindows.ensure(L);
  if(!previous)return HensemStatisticWindows.request(L,platform,instant);
  const copy={...L};for(const [from,to]of [['from','to'],...(HensemStatisticWindows.hasSuccessWindow(L)?[['successFrom','successTo']]:[])]){
   const range=HensemLiveCompare.windowFor(L[from],L[to],platform.timezone,L.queryNow);if(!range.valid)throw Error(range.error);copy[from]=range.previousFrom;copy[to]=range.previousTo;
  }
  return HensemStatisticWindows.request(copy,platform,instant);
 }
 function mergeParts(parts,nativePlatform){
  // A split response's original provider leaves belong to its verified native
  // response, not to a later display-name/provider aggregate. Preserve that
  // provenance before combine() nests the leaves in items.
  const resultGroups=parts.find(part=>part?._preparedResultGroups)?._preparedResultGroups;
  if(resultGroups&&parts.some(part=>JSON.stringify(part._preparedResultGroups)!==JSON.stringify(resultGroups)||JSON.stringify(Object.keys(part.groups||{}).sort())!==JSON.stringify(resultGroups.groups)))throw Error('已准备统计的响应范围不一致');
  const includeGroup=key=>!resultGroups||resultGroups.groups.includes(key);
  const originalParts=parts,text=value=>typeof value==='string'&&value.trim()?value.trim():null,source=value=>text(value)?.toLowerCase().replaceAll('_','')||null;
  const nativeId=text(nativePlatform?.id),nativeCountry=text(nativePlatform?.country),nativeSource=source(nativePlatform?.source);
  const nativeKnown=!!nativeId&&!!nativeCountry&&!!text(nativePlatform?.name)&&['ar','newar','wg','lg','game66','duoli','kb','panda'].includes(nativeSource)&&nativePlatform.reportOnly!==true;
  parts=parts.map(part=>{
   if(!Array.isArray(part?.groups?.provider))return part;
   const p=part.platform,verified=nativeKnown&&text(p?.id)===nativeId&&text(p?.country)===nativeCountry&&source(p?.source)===nativeSource&&!!text(p?.name);
   const identity={platformId:p?.id,platform:p?.name,source:p?.source,country:p?.country};
   const enrichedArrays=new WeakMap();
   function enrichChildren(children,usable){let states=enrichedArrays.get(children);if(!states){states=new Map();enrichedArrays.set(children,states)}if(states.has(usable))return states.get(usable);const result=children.map(child=>enrich(child,usable));states.set(usable,result);return result;}
   function enrich(row,parentVerified){
    if(!row||typeof row!=='object'||Array.isArray(row))return row;
    const missing=value=>value===undefined||value===null||typeof value==='string'&&!value.trim();
    const conflicts=Object.entries(identity).some(([key,value])=>!missing(row[key])&&(typeof row[key]!=='string'||(key==='source'?source(row[key])!==source(value):text(row[key])!==text(value))));
    const usable=!!parentVerified&&!conflicts&&row.nativeFeeIdentityVerified!==false,copy={...row,nativeFeeIdentityVerified:usable};
    if(usable)for(const [key,value]of Object.entries(identity))if(missing(row[key]))copy[key]=value;
    for(const key of ['items','fee_items'])if(Array.isArray(row[key]))copy[key]=enrichChildren(row[key],usable);
    return copy;
   }
   return {...part,groups:{...part.groups,provider:part.groups.provider.map(row=>enrich(row,verified))}};
  });
  if(parts.length===1)return {...parts[0],_parts:originalParts};const first=parts[0],merged={...first,startAt:parts[0]?.startAt,endAt:parts.at(-1)?.endAt,total:parts.some(r=>r.total===null||r.total===undefined||!Number.isFinite(Number(r.total)))?null:parts.reduce((n,r)=>n+Number(r.total),0),summary:combine(parts.flatMap(p=>p.summary||[]),['direction','currency']),groups:{},rows:[],_parts:originalParts};const dimensions={provider:['provider'],daily:['provider','date'],hourly:['hour'],amount:['bucket'],matrix:['hour','bucket'],amount_range:['bucket'],matrix_range:['hour','bucket']};for(const [key,dims]of Object.entries(dimensions))if(includeGroup(key))merged.groups[key]=combine(parts.flatMap(p=>p.groups?.[key]||[]),['direction','currency',...dims]);for(const key of ['latency','latency_thresholds','pending_age','pending_age_thresholds']){if(!includeGroup(key))continue;const groups=new Map();for(const r of parts.flatMap(p=>p.groups?.[key]||[])){const id=[r.direction,r.currency,r.bucket].join('|');if(!groups.has(id))groups.set(id,{...r,count:0,amount:0,valid_count:0,valid_amount:0});const g=groups.get(id);g.count+=Number(r.count||0);g.amount=g.amount===null||r.amount===null?null:g.amount+Number(r.amount||0);g.valid_count+=Number(r.valid_count||0);g.valid_amount=g.valid_amount===null||r.valid_amount===null?null:g.valid_amount+Number(r.valid_amount||0)}merged.groups[key]=[...groups.values()]}// Optional source diagnostics and fee-band facts must survive a split. Missing
 // facts remain unknown; do not manufacture fee counts from success totals.
 for(const row of [...merged.summary,...Object.values(merged.groups).flat()])if(row.items){for(const key of ['negative_amount_count','fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count','fee_low_amount','fee_high_amount','fee_gap_amount']){if(!row.items.some(item=>Object.prototype.hasOwnProperty.call(item,key)))continue;row[key]=row.items.some(item=>item[key]===null||item[key]===undefined)?null:row.items.reduce((sum,item)=>sum+Number(item[key]),0);}}
 if(!parts.some(part=>Object.prototype.hasOwnProperty.call(part,'total')))delete merged.total;merged.latencySummary=[];merged.pendingSummary=[];return merged}
 // Successful reads live only in this authenticated document. Scope/role
 // changes invalidate them; no credentials or results enter browser storage.
 const aggregateCache=new Map(),aggregateInflight=new Map();let preparedAggregates=null,preparedRefreshScope=null;
 let aggregateCacheBytes=0,aggregateCacheContext='';
 const aggregateCacheLimit=128,aggregateCacheByteLimit=16*1024*1024;
 function cancelAggregateReads(){preparedAggregates?.cancel();for(const entry of aggregateInflight.values())entry.controller?.abort();aggregateInflight.clear();}
 function clearAggregateCache(){aggregateCache.clear();aggregateCacheBytes=0;preparedAggregates?.clear();workordersReadCache?.clear();cancelAggregateReads();}
 function aggregateAccessContext(){
  const a=window.hensemRoleAccess||{},s=window.hensemDataScope||{};
  const context=JSON.stringify([s.mode||'document',s.identity||'document',a.mode||'document',a.roleId||'',a.version??null,a.assignmentVersion??null,a.canView??null,Array.isArray(a.permissions)?[...a.permissions].sort():[]]);
  if(context!==aggregateCacheContext){clearAggregateCache();aggregateCacheContext=context;}
  return context;
 }
 function aggregateNativeIdentity(request){const p=visibleCatalog().find(p=>p.id===request.platformId||(p.aliasPlatformIds||[]).includes(request.platformId));return p?JSON.stringify([request.platformId,p.source,p.sourceName,p.country,p.timezone,p.currency,p.capabilities]):null;}
 function aggregateScopeKey(request){const {action,view,direction,offset,limit,...scope}=request;return JSON.stringify([aggregateAccessContext(),aggregateNativeIdentity(request),Object.keys(scope).sort().map(k=>[k,scope[k]])])}
 function aggregateView(request){return request.view||'full'}
 function aggregateComplete(request,result){
  if(request.action!=='aggregate'||!result||typeof result!=='object'||result._aggregateCacheable===false||result._preparedResultGroups||result.platform?.id!==request.platformId||!Array.isArray(result.summary)||!Array.isArray(result.rows)||result.rows.length||!result.groups||!Array.isArray(result.groups.provider))return false;
  if(result.partial===true||result.complete===false||result.available===false||result.error||result.coverage?.complete===false||result.meta?.partial===true)return false;
  if(Date.parse(result.startAt)!==Date.parse(request.startAt)||Date.parse(result.endAt)!==Date.parse(request.endAt))return false;
  return !result._parts||result._parts.every(part=>aggregateComplete({...request,startAt:part.startAt,endAt:part.endAt},part));
 }
 function aggregateTtl(request){
  const p=visibleCatalog().find(p=>p.id===request.platformId||(p.aliasPlatformIds||[]).includes(request.platformId));
  // Full responses contain asOf-dependent pending durations. Never give those
  // a longer history TTL; old provider totals still expire within five minutes.
  const historical=p?.timezone&&localClock(Date.parse(request.endAt)-1,p.timezone).slice(0,10)<localClock(Date.now(),p.timezone).slice(0,10);
  return aggregateView(request)==='providers'&&historical?300000:30000;
 }
 function aggregateCopy(result){return typeof structuredClone==='function'?structuredClone(result):JSON.parse(JSON.stringify(result));}
 function deleteAggregateEntry(key){const entry=aggregateCache.get(key);if(entry){aggregateCacheBytes-=entry.bytes;aggregateCache.delete(key);}}
 function cachedAggregate(request){
  if(request.action!=='aggregate')return null;
  if(!roleAllowed(state.page,'query')||!aggregateNativeIdentity(request)){clearAggregateCache();return null;}
  const scope=aggregateScopeKey(request),providerScope=request.view==='providers'?aggregateScopeKey({...request,durationVersion:2}):null,now=Date.now();
  for(const [key,entry]of [...aggregateCache].reverse()){
   if(now>=entry.expiresAt){deleteAggregateEntry(key);continue}
   // Provider-only views may reuse v2 summaries; legacy duration views must never consume v2 bucket indexes.
   if(entry.scope!==scope&&entry.scope!==providerScope||entry.view!=='full'&&entry.view!==aggregateView(request)||entry.direction!==request.direction&&entry.direction!=='all')continue;
   const narrow=r=>{const keep=row=>request.direction==='all'||row.direction===request.direction,summary=(r.summary||[]).filter(keep).map(row=>({...row}));return {...r,summary,total:request.direction===entry.direction?r.total:request.status==='success'&&summary.some(row=>row.success_count===null)?null:summary.reduce((n,row)=>n+Number(row[request.status==='success'?'success_count':'all_count']||0),0),groups:Object.fromEntries(Object.entries(r.groups||{}).map(([key,rows])=>[key,rows.filter(keep).map(row=>({...row}))])),latencySummary:(r.latencySummary||[]).filter(keep).map(row=>({...row})),pendingSummary:(r.pendingSummary||[]).filter(keep).map(row=>({...row})),rows:[],...(r._parts?{_parts:r._parts.map(narrow)}:{})}};
   aggregateCache.delete(key);aggregateCache.set(key,entry);
   return {...narrow(aggregateCopy(entry.result)),_aggregateCacheHit:true,_aggregateReadAt:entry.at};
  }
  return null;
 }
 function rememberAggregate(request,result,assembled=false){
  if(!roleAllowed(state.page,'query')||!aggregateNativeIdentity(request)||!aggregateComplete(request,result)||result._aggregateCacheHit&&!assembled||result._aggregateAccessContext!==aggregateAccessContext())return;
  const scope=aggregateScopeKey(request),view=aggregateView(request),key=JSON.stringify([scope,view,request.direction]),at=result._aggregateReadAt||Date.now();
  let copy,bytes;try{copy=aggregateCopy(result);bytes=JSON.stringify(copy).length*2;}catch{return;}
  if(bytes>2*1024*1024)return;deleteAggregateEntry(key);aggregateCache.set(key,{scope,view,direction:request.direction,at,expiresAt:at+aggregateTtl(request),bytes,result:copy});aggregateCacheBytes+=bytes;
  while(aggregateCache.size>aggregateCacheLimit||aggregateCacheBytes>aggregateCacheByteLimit)deleteAggregateEntry(aggregateCache.keys().next().value);
 }
 function aggregateRead(request,serial){
  const context=aggregateAccessContext(),native=aggregateNativeIdentity(request);if(serial!==L.serial||!roleAllowed(state.page,'query')||!native)return Promise.reject(Error('查询权限或范围已变化'));
  const key=JSON.stringify([serial,context,native,Object.keys(request).sort().map(k=>[k,request[k]])]),existing=aggregateInflight.get(key);
  if(existing)return existing.promise;
  const controller=typeof AbortController==='function'?new AbortController():null,entry={controller,promise:null};
  entry.promise=Promise.resolve().then(()=>{
   if(controller?.signal.aborted||serial!==L.serial||context!==aggregateAccessContext()||native!==aggregateNativeIdentity(request))throw Error('查询已替换');
   return window.hensemLiveRequest(request,{signal:controller?.signal});
  }).then(result=>{
   if(controller?.signal.aborted||serial!==L.serial||context!==aggregateAccessContext()||native!==aggregateNativeIdentity(request)||!roleAllowed(state.page,'query'))throw Error('查询已替换');
   if(orderSource(L.catalog.find(p=>p.id===request.platformId))==='panda'){
    if(!pandaCoverageMatches(result,request))throw Error('熊猫所选创建窗口完整性尚未确认，请在订单列表查看已入库明细；暂不计入完整汇总');
   }
   return {...result,_aggregateReadAt:Date.now(),_aggregateAccessContext:context};
  }).catch(error=>{if(serial===L.serial&&!controller?.signal.aborted&&context===aggregateAccessContext()&&native===aggregateNativeIdentity(request)&&['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(error?.code)){clearAggregateCache();if(isSuccessAnalysis())clearSuccessAuthority();}throw error;})
   .finally(()=>{if(aggregateInflight.get(key)===entry)aggregateInflight.delete(key);});
  aggregateInflight.set(key,entry);return entry.promise;
 }
 // Retain only the already-authorized exact publication. Historical provider
 // queries may outlast the short real-time TTL while their independent
 // supplementary reads finish; revisiting the same native/window must not
 // discard that completed main result. New providers still use server projection.
 function preparedCompletionTtl(q,platform){
  if(!providerDirection(state.page)||q.view!=='providers'||q.status!=='all'||(q.successBasis??'success')!=='success'||!['ar','newar','kb'].includes(orderSource(platform)))return 30000;
  const clocks=['startAt','endAt',...(q.successStartAt?['successStartAt','successEndAt']:[])];
  if(clocks.some(key=>typeof q[key]!=='string'||!Number.isFinite(Date.parse(q[key]))||/[.]\d*[1-9]\d*(?:Z|[+-]\d\d:\d\d)$/.test(q[key])))return 30000;
  if(Date.parse(q.startAt)!==Date.parse(q.successStartAt||q.startAt)||Date.parse(q.endAt)!==Date.parse(q.successEndAt||q.endAt)||Date.parse(q.endAt)>Date.now())return 30000;
  try{if(clocks.some(key=>localClock(Date.parse(q[key]),platform.timezone).slice(11)!=='00:00:00'))return 30000;}catch{return 30000;}
  return 300000;
 }
 // Read the selected summary first. Unseen provider filters use the same
 // server-prepared base on demand instead of downloading every filter result.
 function preparedNativePlatform(id){
  // Display country/team aliases never replace the exact authorized source
  // identity echoed by a publication. Keep the visible-directory gate too.
  if(!visibleCatalog().some(p=>p.id===id&&!p.reportOnly))return null;
  return L.catalog.find(p=>p.id===id)||null;
 }
 preparedAggregates=window.HensemPreparedAggregates?.create({request:(q,options)=>window.hensemLiveRequest(q,options),context:()=>roleAllowed(state.page,'view')&&roleAllowed(state.page,'query')?state.page+'|'+aggregateAccessContext():'',completedReuseContext:()=>roleAllowed(state.page,'view')&&roleAllowed(state.page,'query')?aggregateAccessContext():'',platform:preparedNativePlatform,publicationVersion:2,providerLeafAliases:true,maxConcurrent:2,maxBatchSize:3,completedCacheTtlMs:preparedCompletionTtl,completedCacheMaxBytes:96*1024*1024,derivedPollMaxMs:60000,derivedPollIntervalMs:1500,derivedPollMaxAttempts:40});
 const usesPreparedAggregate=request=>statisticWindowsEnabled()&&request.action==='aggregate'&&request.view!=='drilldown'&&!['orderNumber','thirdPartyOrderNumber','systemOrderId','memberId','utr'].some(key=>request[key]);
 window.addEventListener?.('pagehide',()=>{clearAggregateCache();providerIntake?.clearCache?.();clearFeeLookupCache();});
 async function readAggregate(request,serial,allowCache=false,bounded=false,isCurrent=()=>true){
  if(!isCurrent())throw Error('查询已替换');
  if(usesPreparedAggregate(request)){
   if(!preparedAggregates)throw Error('统计读取组件未载入，请重新加载页面');
   const context=aggregateAccessContext(),page=state.page;let result;
   try{result=await preparedAggregates.read(request,{...((request.view||'full')==='full'&&['time','amount','latency'].includes(page)?{responseProfile:page+'-v1'}:{}),forceRefresh:preparedRefreshScope?.serial===serial&&preparedRefreshScope.page===page&&preparedRefreshScope.context===context,isCurrent:()=>isCurrent()&&serial===L.serial&&page===state.page&&context===aggregateAccessContext()&&roleAllowed(page,'view')&&roleAllowed(page,'query')});}
   catch(error){if(['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(error?.code))clearAggregateCache();throw error;}
   if(orderSource(L.catalog.find(p=>p.id===request.platformId))==='panda'&&!pandaCoverageMatches(result,request,true))throw Error('熊猫所选创建窗口完整性尚未确认；已核验截止范围的证据无效，请重新读取');
   return {...mergeParts([result],L.catalog.find(p=>p.id===request.platformId)),_aggregateReadAt:Date.parse(result._preparedPublication.computedAt),_aggregateAccessContext:context,_aggregateView:request.view||'full'};
  }
  const context=aggregateAccessContext(),native=aggregateNativeIdentity(request);
  const current=()=>isCurrent()&&serial===L.serial&&context===aggregateAccessContext()&&!!native&&native===aggregateNativeIdentity(request)&&roleAllowed(state.page,'query');
  if(allowCache){const cached=cachedAggregate(request);if(cached){await Promise.resolve();if(!current())throw Error('查询已替换');return cached}}
  if(serial!==L.serial||!roleAllowed(state.page,'query')||!native)throw Error('查询权限或范围已变化');
  const parts=[],boundedProviderRead=bounded||isSuccessAnalysis()||(state.page==='overview'&&request.view==='providers')||!!providerDirection(state.page)||isFlowPage(state.page),day=86400000;
  // Only a real timeout switches AR overview windows to <= 1 hour. Reads
  // stay sequential within each platform; the two-platform worker limit and
  // exact half-open boundaries are unchanged. A failing <= 1h read stops.
  const hourlyTimeoutFallback=state.page==='overview'&&request.action==='aggregate'&&request.view==='providers'&&orderSource(L.catalog.find(p=>p.id===request.platformId))==='ar';
  async function read(q,depth=0){
   if(!current())throw Error('查询已替换');
   try{const cached=(allowCache||L.queryRetrying)&&q!==request?cachedAggregate(q):null;const result=cached||await aggregateRead(q,serial);if(!current())throw Error('查询已替换');const part={...result,_aggregateCacheable:!!cached||aggregateComplete(q,result),startAt:q.startAt,endAt:q.endAt,_aggregateView:cached?cached._aggregateView||aggregateView(q):aggregateView(q)};parts.push(part);if(q!==request)rememberAggregate(q,part)}
   catch(e){
    if(!current())throw Error('查询已替换');
    const from=Date.parse(q.startAt),to=Date.parse(q.endAt),width=to-from;
    if(!/超时|timeout/i.test(e.message))throw e;
    if(hourlyTimeoutFallback&&width>3600000){
     for(let cursor=from;cursor<to;cursor+=3600000)await read({...q,startAt:new Date(cursor).toISOString(),endAt:new Date(Math.min(cursor+3600000,to)).toISOString()},0);
    }else if(boundedProviderRead&&width>day){
     for(let cursor=from;cursor<to;cursor+=day)await read({...q,startAt:new Date(cursor).toISOString(),endAt:new Date(Math.min(cursor+day,to)).toISOString()},0);
    }else if(width>3600000&&(!boundedProviderRead||depth<3)){
     const mid=new Date(Math.floor((from+to)/2000)*1000).toISOString();await read({...q,endAt:mid},depth+1);await read({...q,startAt:mid},depth+1);
    }else throw e;
   }
  }
  const from=Date.parse(request.startAt),to=Date.parse(request.endAt),platform=L.catalog.find(p=>p.id===request.platformId);
  // Production EXPLAIN for this exact AR source showed a 16.5s full day;
  // peak two-hour full and four-hour provider reads fit the 8s server budget.
  // Keep all filters and the independent creation/success clocks unchanged.
  const largeAr=request.action==='aggregate'&&request.platformId==='5e952cbb-e42f-d6b1-a24a-a0d42d165df9'&&orderSource(platform)==='ar'&&['all','charge'].includes(request.direction);
  const initialWidth=largeAr?(request.view==='providers'?4:2)*3600000:boundedProviderRead&&!isSuccessAnalysis()?day:Infinity;
  if(to-from>initialWidth){for(let cursor=from;cursor<to;cursor+=initialWidth)await read({...request,startAt:new Date(cursor).toISOString(),endAt:new Date(Math.min(cursor+initialWidth,to)).toISOString()})}else await read(request);if(!current())throw Error('查询已替换');const merged=mergeParts(parts,platform);merged._aggregateView=parts.every(part=>part._aggregateView==='full')?'full':'providers';merged._aggregateReadAt=Math.min(...parts.map(part=>part._aggregateReadAt||Date.now()));merged._aggregateCacheHit=parts.some(part=>part._aggregateCacheHit===true);if(merged.platform)merged.platform=displayIdentity(merged.platform);rememberAggregate(request,merged,true);return merged;
 }
 // The merchant ledger needs provider totals. Read the chart dimensions only
 // when its trend tab is requested; keep the ledger until every platform ends.
 async function loadMerchantTrend(){
  if(state.page==='merchants'&&L.view==='trend'&&phasedReadBusy()){deferredMerchantTrend=true;return;}
  if(state.page!=='merchants'||L.view!=='trend'||!L.pageQueried||L.loading||L.dirty||!L.catalogReady||L.error||!roleAllowed('merchants','query')||L.loadedView==='full')return;
  const scope=aggregateQueryScope(),serial=L.serial;
  if(L.queryScope!==scope||L.merchantTrend?.scope===scope&&L.merchantTrend.status==='loading')return;
  const platforms=L.queryPlatforms.slice(),prior=L.merchantTrend?.scope===scope?L.merchantTrend:null,completed=new Map((prior?.results||[]).map(r=>[r.platform?.id,r]));
  const trend={scope,status:'loading',results:[...completed.values()],done:completed.size,total:platforms.length,error:''};L.merchantTrend=trend;beginReadPhases(serial);setReadPhase(serial,'按需读取订单趋势');render();
  const current=()=>serial===L.serial&&L.merchantTrend===trend&&state.page==='merchants'&&L.view==='trend'&&!L.dirty&&L.queryScope===scope&&roleAllowed('merchants','query');
  try{for(const platform of platforms){
   if(!current())return;if(completed.has(platform.id))continue;
   try{const request=query(platform,'aggregate');delete request.view;const result=await readAggregate(request,serial,true,true);if(!current())return;completed.set(platform.id,result);}
   catch(error){if(!current())return;trend.status='error';trend.error=error.message||'读取失败';render();return;}
   trend.results=platforms.map(p=>completed.get(p.id)).filter(Boolean);trend.done=trend.results.length;render();
  }
  if(!current())return;trend.status='ready';L.results=trend.results;L.loadedView='full';render();
  }finally{endReadPhases(serial);}
 }
 window.liveMerchantTrend=loadMerchantTrend;
 // Read deeper overview sections in place, only when visible or explicitly requested.
 // Keep their fresh source snapshot separate from the already displayed provider totals.
 let overviewObserver=null,overviewPaginationScroll=null;
 function clearOverviewPaginationScroll(){if(overviewPaginationScroll){window.removeEventListener?.('scroll',overviewPaginationScroll);overviewPaginationScroll=null}}
 function prepareOverviewSections(){
  clearOverviewPaginationScroll();
  if(overviewObserver){overviewObserver.disconnect();overviewObserver=null}
  const active=state.page==='overview'&&L.overviewQueried&&L.catalogReady&&!L.dirty;
  const scope=active?String(L.serial)+'|'+aggregateQueryScope():null;
  if(L.overviewSections?.scope===scope)return;
  if(L.overviewWorkordersStatus==='loading'&&L.overviewSections?.workordersSerial===L.workordersSerial){L.workordersSerial++;L.workordersLoading=false}
  if(state.page==='overview'&&(L.overviewSections||active)){L.workorders=null;L.workordersError='';L.workordersUnsupported=false}
  L.overviewWorkordersStatus='idle';
  L.overviewSections=scope?{scope,status:'idle',done:0,attempted:0,total:selected().length,failures:[],results:[]}:null;
 }
 function overviewAnalysisRender(body){
  const analysis=L.overviewSections;
  if(!analysis?.done||L.loadedView==='full')return body();
  const primary=L.results;
  try{L.results=analysis.results;return body()}finally{L.results=primary}
 }
 function mountOverviewSections(){
  if(L.restoredPage)return;
  if(state.page!=='overview'||!L.overviewQueried||L.loading||L.dirty||L.error||!L.catalogReady||typeof window.IntersectionObserver!=='function')return;
  const scope=L.overviewSections?.scope,seen=new WeakSet(),viewport=localPaginationViewport,skipInitial=localPaginationPaint,waitForScroll=skipInitial&&viewport&&typeof window.addEventListener==='function';
  const observer=overviewObserver=new window.IntersectionObserver(entries=>{
   if(overviewObserver!==observer||scope!==L.overviewSections?.scope||state.page!=='overview'||L.loading||L.dirty)return;
   // Replacing table rows also replaces the section nodes. That first observer
   // notification is a paint effect, not a request to fetch another report.
   // Scroll restoration may clamp twice as the layout settles. Until a real
   // scroll remounts the observer, those layout-only entries stay suppressed.
   if(waitForScroll||skipInitial&&viewport?.restoring)return;
   if(skipInitial)entries=entries.filter(entry=>{const known=seen.has(entry.target);seen.add(entry.target);return known});
   if(entries.some(entry=>entry.isIntersecting&&entry.target.hasAttribute('data-live-overview-analysis'))&&L.overviewSections?.status==='idle')window.liveOverviewAnalysis();
   if(entries.some(entry=>entry.isIntersecting&&entry.target.hasAttribute('data-live-overview-workorders'))&&L.overviewWorkordersStatus==='idle'&&!L.workorders&&!L.workordersLoading&&!L.workordersError)window.liveOverviewWorkorders();
  },{rootMargin:'160px 0px',threshold:0});
  const targets=[...(document.getElementById('page')?.querySelectorAll('[data-live-overview-analysis],[data-live-overview-workorders]')||[])];targets.forEach(node=>observer.observe(node));
  if(waitForScroll){
   // A user may scroll before the observer's first asynchronous notification,
   // or remain inside its intersection band. Reobserve at the actual viewport
   // on that first scroll, so neither case can strand a visible lazy section.
   overviewPaginationScroll=()=>{
    if(overviewObserver!==observer||viewport.restoring)return;
    if((Number(window.scrollX)||0)===viewport.x&&(Number(window.scrollY)||0)===viewport.y)return;
    clearOverviewPaginationScroll();observer.disconnect();mountOverviewSections();
   };
   window.addEventListener('scroll',overviewPaginationScroll,{passive:true});
  }
 }
 window.liveOverviewWorkorders=async function(){
  if(state.page!=='overview'||!L.overviewQueried||L.loading||L.dirty||!L.catalogReady||L.overviewWorkordersStatus==='loading')return;
  prepareOverviewSections();const analysis=L.overviewSections;
  L.overviewWorkordersStatus='loading';const pending=workordersLoad();analysis.workordersSerial=L.workordersSerial;await pending;
  if(analysis!==L.overviewSections||state.page!=='overview')return;
  L.overviewWorkordersStatus=L.workordersUnsupported?'unavailable':L.workordersError?'error':'ready';render();
 };
 window.liveOverviewAnalysis=async function(){
  if(state.page!=='overview'||!L.overviewQueried||L.loading||L.dirty||!L.catalogReady||L.error)return;
  prepareOverviewSections();const analysis=L.overviewSections,serial=L.serial;
  if(!analysis||analysis.status==='loading'||analysis.status==='ready')return;
  if(L.loadedView==='full'){analysis.results=L.results.slice();analysis.done=analysis.results.length;analysis.attempted=analysis.done;analysis.status='ready';render();return}
  const platforms=selected(),completed=new Map(analysis.results.map(result=>[result.platform?.id,result])),failures=new Map(analysis.failures.map(f=>[f.id,f]));
  const pending=platforms.filter(platform=>!completed.has(platform.id));analysis.status='loading';analysis.total=platforms.length;render();
  // One platform at a time; a slow analysis cannot consume the initial summary queue.
  for(const platform of pending){
   if(serial!==L.serial||analysis!==L.overviewSections||state.page!=='overview'||L.dirty)return;
   try{const request=query(platform,'aggregate');delete request.view;const result=await readAggregate(request,serial,true,true);
    if(serial!==L.serial||analysis!==L.overviewSections||state.page!=='overview'||L.dirty)return;
    completed.set(platform.id,result);failures.delete(platform.id);
   }catch(error){if(serial!==L.serial||analysis!==L.overviewSections||state.page!=='overview'||L.dirty)return;failures.set(platform.id,{id:platform.id,name:platform.name,message:error.message||'读取失败'})}
   analysis.results=platforms.map(p=>completed.get(p.id)).filter(Boolean);analysis.done=analysis.results.length;analysis.failures=[...failures.values()];analysis.attempted=analysis.done+analysis.failures.length;render();
  }
  if(serial!==L.serial||analysis!==L.overviewSections)return;
  analysis.status=analysis.failures.length?(analysis.done?'partial':'error'):'ready';render();
 };
 function aggregateQueryScope(){return JSON.stringify([isTeamWorkspace(state.page)?'teamops':state.page,selected().map(p=>p.id),L.from,L.to,L.successFrom,L.successTo,L.successBasis,L.direction,L.status,activeValues('provider'),L.orderNumber,L.memberId,L.systemOrderId,L.thirdPartyOrderNumber,L.overviewAnalysis])}


 async function loadOverviewIntake(serial){
  const from=L.from?.slice(0,10),to=L.to?.slice(0,10),failed=new Set((L.queryFailures||[]).map(p=>p.id)),results=new Map(L.results.map(r=>[r.platform?.id,r]));
  // Inspect only successful empty reads. Populated platforms already have
  // order evidence, and failed aggregates must not be relabelled as empty.
  for(const direction of L.direction==='all'?['charge','withdraw']:[L.direction]){
   if(serial!==L.serial||state.page!=='overview')return;
   const platforms=L.queryPlatforms.filter(p=>{const r=results.get(p.id);return !p.reportOnly&&!failed.has(p.id)&&r&&Array.isArray(r.summary)&&!r.summary.some(row=>row.direction===direction)&&(r.summary.length||r.total!=null&&Number(r.total)===0)&&!Object.values(r.groups||{}).some(rows=>Array.isArray(rows)&&rows.some(row=>row.direction===direction));});
   if(!platforms.length)continue;
   const publish=data=>{if(serial===L.serial&&state.page==='overview'){L.overviewIntake={...L.overviewIntake,[direction]:{...data,direction}};render();}};
   publish({status:'loading',from,to,platforms:[],error:''});
   try{if(!providerIntake)throw Error('采集核对暂不可用');publish(await providerIntake.load({platforms,direction,from,to,onProgress:publish}));}
   catch(e){publish({status:'error',from,to,platforms:[],error:e.message||'采集核对失败'});}
  }
 }
 async function loadProviderIntake(serial,previous=false,concurrency=2,isCurrent=()=>serial===L.serial){
  if(state.page==='overview')return previous?undefined:loadOverviewIntake(serial);
  if(!providerDirection(state.page)||state.page==='providers'&&L.providerReadMode==='published')return;
  const key=previous?'providerComparisonIntake':'providerIntake',range=HensemLiveCompare.windowFor(L.from,L.to,scopeZone(),L.queryNow);
  const from=(previous?range.previousFrom:L.from)?.slice(0,10),to=(previous?range.previousTo:L.to)?.slice(0,10);
  L[key]={status:'loading',from,to,platforms:[],error:''};render();
  try{if(!providerIntake)throw Error('采集核对暂不可用');const result=await providerIntake.load({platforms:L.queryPlatforms.slice(),direction:providerDirection(state.page),from,to,concurrency,isCurrent,onProgress:progress=>{if(isCurrent()){L[key]=progress;render();}}});if(isCurrent())L[key]=result;}
  catch(e){if(isCurrent())L[key]={status:'error',from,to,platforms:[],error:e.message||'采集核对失败'};}
  finally{if(isCurrent())render();}
 }



 const publishedViewFields=('team country currency platform source provider direction status from to successFrom successTo successBasis orderNumber thirdPartyOrderNumber memberId systemOrderId utr multi queryNow queryScope queryPlatforms queryWarnings queryFailures results comparisonResults comparisonStatus comparisonError comparisonLabel providerIntake providerComparisonIntake workorders workordersError workordersUnsupported workordersScope feeLookupRows feeLookupError publishedWindow').split(' ');
 function publishedIdentity(){return window.HensemProviderPublished?.contextKey(aggregateAccessContext(),visibleCatalog())||'';}
 function cancelPublishedRead(){publishedController?.abort();publishedController=null;if(L.providerPublished?.loading)L.providerPublished.loading=false;}
 function clearPublishedAuthority(){submissionAnalysis?.clearCache?.();const details=document.querySelector('[data-provider-publication-details]');if(details){window.closeDrawer?.();details.innerHTML='';}L.serial++;cancelDataReads();L.providerPublished=null;L.publishedWindow=null;L.providerReadMode='published';L.results=[];L.comparisonResults=[];L.providerIntake=null;L.providerComparisonIntake=null;L.workorders=null;L.queryPlatforms=[];L.queryFailures=[];L.queryWarnings=[];L.loading=false;L.error='查询权限或平台目录已变化，请重新查询';submissionAnalysis?.restore(null);}
 function syncPublishedIdentity(){if(state.page!=='providers'||!L.providerPublished)return;if(!roleAllowed('providers','query')||L.providerPublished.context!==publishedIdentity())clearPublishedAuthority();}
 function capturePublishedView(){const p=L.providerPublished;if(state.page!=='providers'||!p?.bundle||p.context!==publishedIdentity()||L.dirty)return;p.view=Object.fromEntries(publishedViewFields.map(k=>[k,['multi'].includes(k)?copyControls(L[k]):L[k]]));}
 function withPublishedView(paint){const view=L.providerPublished?.view;if(!view)return paint();const keys=[...Object.keys(view),'dirty','loading','error','queryPaused','queryRetrying'],saved=Object.fromEntries(keys.map(k=>[k,L[k]]));Object.assign(L,view,{dirty:false,loading:false,error:'',queryPaused:false,queryRetrying:false});try{return paint()}finally{Object.assign(L,saved)}}
 function publishedNotice(){
  const p=L.providerPublished;if(!p)return '';
  const bundle=p.bundle,label=bundle?.window&&!p.appliedWindow?'整日汇总尚未发布':bundle?({ready:p.appliedWindow?.intraday?'已发布截至汇总（非全天）':'已发布汇总',stale:bundle?.version===2?'发布版本需更新':'已发布汇总已过期',building:'汇总正在生成',missing:'汇总尚未齐备',unsupported:'当前范围尚未发布汇总'}[bundle.status]):'读取已发布汇总';
  const applied=p.request?'印度 · '+p.request.currency+' · '+p.request.startAt.slice(0,10)+' · '+p.request.platformIds.length+' 平台 · '+(p.appliedProviders?.length?p.appliedProviders.join(' / '):'全部三方'):'';
  const cutoff=bundle?.window&&(!p.appliedWindow||p.appliedWindow.intraday)?' · 截至 '+(p.appliedWindow||bundle.window).localCutoff.replace('T',' ')+'（不含，印度时间）':'';
  const publicationTime=bundle?.version===2&&bundle.computedAt?' · 更新于 '+new Date(Date.parse(bundle.computedAt)+19800000).toISOString().slice(0,19).replace('T',' ')+publicationRefreshLabel([bundle]):'';
  const alerts=[L.dirty?'筛选已修改，保留上次结果':'',p.error?'更新失败':'',p.projectionError?'去重合计未齐备':'',(bundle?.missing||[]).length?'缺 '+bundle.missing.length+' 项统计':''].filter(Boolean);
  return '<div class="provider-publication-bar" data-provider-published role="status"><strong>'+E(label)+'</strong><span>'+E(applied+cutoff+publicationTime)+'</span>'+(p.loading?'<span class="provider-publication-progress" title="'+E(phasedReadBusy()?readPhase.label:'正在读取最新发布结果')+'">更新中…</span>':'')+(alerts.length?'<span class="provider-publication-warning" title="'+E([p.error,p.projectionError,...alerts].filter(Boolean).join('；'))+'">'+E(alerts.join(' · '))+'</span>':'')+'<span class="provider-publication-actions"><button type="button" class="link" onclick="liveProviderPublishedDetails()">数据说明</button><button type="button" class="link" onclick="liveQuery(true)" '+(p.loading?'disabled':'')+'>读取最新汇总</button><button type="button" class="link" onclick="liveProviderRealtimeQuery()" '+(p.loading?'disabled':'')+'>' +(statisticWindowsEnabled()?'读取统一汇总':'实时明细查询')+'</button></span></div>';
 }
 window.liveProviderPublishedDetails=function(){
  if(state.page!=='providers')return;
  syncPublishedIdentity();if(!roleAllowed('providers','query'))return;const p=L.providerPublished,bundle=p?.bundle;if(!p)return;
  const missing=(bundle?.missing||[]).map(m=>(bundle.platforms.find(x=>x.platform.id===m.platformId)?.platform.name||m.platformId)+' / '+({current:'本期',previous:'前期'}[m.period]||m.period)+' / '+({orders:'订单',submission:'剔除',intake:'采集核对'}[m.component]||m.component)+'：'+({missing:'未发布',building:'生成中',failed:'生成失败',stale:bundle?.version===2?'版本需更新':'已过期',unsupported:'尚未支持'}[m.state]||m.state));
  const window=p.appliedWindow||bundle?.window,scope=p.request?'日期 '+p.request.startAt.slice(0,10)+' · '+p.request.platformIds.length+' 个平台 · '+(p.appliedProviders?.length?p.appliedProviders.join(' / '):'全部三方'):'';
  openDrawer('已发布汇总 · 数据说明','<div data-provider-publication-details><p>'+E(scope)+'</p>'+(window?'<p>印度 · INR · '+E(window.localStartAt.replace('T',' ')+' 至 '+window.localCutoff.replace('T',' '))+'（不含，印度时间）'+(window.intraday||!p.appliedWindow?' · 非全天':'')+'</p>':'')+'<p>来源完整性以采集回执为准；生成时间 '+E(bundle?.computedAt||'—')+(bundle?.version===2&&bundle.nextRefreshAt?'；下次计划 '+E(bundle.nextRefreshAt):'')+'。工单按完整自然日另行读取，当前费率单独更新。</p>'+[p.error,p.projectionError].filter(Boolean).map(message=>'<p class="live-error">'+E(message)+'</p>').join('')+(missing.length?'<ul>'+missing.map(message=>'<li>'+E(message)+'</li>').join('')+'</ul>':'')+'</div>');
 };
 function publishedContent(){
  const p=L.providerPublished;if(!p)return '<div class="live-status live-error">'+E(L.error||'请点击查询读取已发布汇总')+'</div>';
  const notice=publishedNotice();if(!p.view?.results?.length)return notice;
  return notice+withPublishedView(()=>HensemProviderSummary.render({L,E,N,C,R,plus,successTimeSummary,successTimeUnavailable,combine,groupRows,box,table,pager,submissionAnalysis,sourceBasis:successBasisNote(),feeForRow,ensureFeeLookup:()=>Promise.resolve(),providerCell,openDrawer:(title,html)=>openDrawer(title,html),render:()=>render()},'charge'));
 }
 const publishedRequestKey=request=>JSON.stringify({...request,platformIds:request.platformIds.slice().sort()});
 // Keep one authorized, complete base publication per page. Provider choices
 // are projections of that base, never separate eighteen-platform order reads.
 function reusablePublication(previous,request,now){
  if(!previous?.bundle?.complete||previous.bundle.status!=='ready'||previous.error||!previous.appliedWindow||publishedRequestKey(previous.request)!==publishedRequestKey(request))return false;
  const age=now-previous.readAt,day=request.startAt.slice(0,10),today=new Date(now+19800000).toISOString().slice(0,10),ttl=day<today?300000:30000,due=previous.bundle.nextDueAt;
  return Number.isFinite(age)&&age>=0&&age<ttl&&!(day<today&&previous.appliedWindow.intraday)&&(previous.bundle.version===2||!due||Date.parse(due)>now);
 }
 async function loadPublishedProviders(force){
  if(!roleAllowed('providers','query')){clearPublishedAuthority();render();return;}
  if(force)submissionAnalysis?.clearCache?.();
  const api=window.HensemProviderPublished,scope=aggregateQueryScope(),context=publishedIdentity();
  if(L.providerPublished?.loading&&!L.dirty)return;
  const platforms=selected().slice(),providers=activeValues('provider').slice(),request=api.requestFor(platforms,L.from.slice(0,10)),old=L.providerPublished?.context===context?L.providerPublished:null,serial=++L.serial;
  const reuse=!force&&reusablePublication(old,request,Date.now());
  cancelDataReads();const controller=new AbortController();publishedController=controller;
  const current=()=>serial===L.serial&&state.page==='providers'&&!L.dirty&&scope===aggregateQueryScope()&&!controller.signal.aborted&&context===publishedIdentity()&&roleAllowed('providers','query');
  L.providerReadMode='published';L.providerPublished={...old,context,loading:true,error:''};L.pageQueried=true;L.restoredPage=false;L.dirty=false;L.loading=true;L.error='';L.queryScope=scope;L.inflightScope=scope;L.queryNow=Date.now();beginReadPhases(serial);prepareFeeLookupQuery(force);setReadPhase(serial,'读取已发布代收汇总');
  try{
   const bundle=reuse?old.bundle:api.validate(await window.hensemLiveRequest(request,{signal:controller.signal}),request,platforms);if(!current())return;
   const projection=api.project(bundle,providers),projected=projection.bundle;
   const appliedWindow=api.appliedWindow(bundle,request,L.queryNow);
   if(appliedWindow)submissionAnalysis?.applyPublished(projected,platforms,{providers:projection.providers});else submissionAnalysis?.restore(null);
   Object.assign(L,{publishedWindow:appliedWindow,results:appliedWindow?projected.platforms.map(p=>p.current.orders).filter(Boolean):[],comparisonResults:appliedWindow?projected.platforms.map(p=>p.previous.orders).filter(Boolean):[],comparisonStatus:appliedWindow&&bundle.complete?'ready':'error',comparisonError:appliedWindow&&bundle.complete?'':'发布范围或版本尚未齐备，暂不计算汇总对比',comparisonLabel:appliedWindow?.intraday?'较前一日同一时段 · 已发布同进度':'较前一日同一时段',queryPlatforms:platforms,queryWarnings:[],queryFailures:platforms.filter(p=>!bundle.platforms.find(e=>e.platform.id===p.id)?.current.orders).map(p=>({id:p.id,name:p.name,message:'订单汇总尚未发布'})),queryPaused:false,queryRetrying:false,providerIntake:null,providerComparisonIntake:null,workorders:null,workordersError:'',workordersUnsupported:false,workordersScope:'',workordersLoading:false,loading:false,loadedView:'providers',localPage:1,tablePages:{}});
   L.providerPublished={context,bundle,request,appliedWindow,readAt:reuse?old.readAt:Date.now(),appliedProviders:projection.providers,projectionComplete:projection.projectionComplete,loading:true,error:'',view:null};capturePublishedView();render();
   if(bundle.status==='unsupported'||!appliedWindow)return;
   setReadPhase(serial,'核对采集目录与已发布证据');
   try{
    const catalog=reuse&&old.intakeCatalog?old.intakeCatalog:await window.hensemLiveRequest({action:'intakeCoverage',operation:'orderCatalog'},{signal:controller.signal});if(!current())return;
    const intake=api.intake(bundle,'current',catalog,platforms),previous=api.intake(bundle,'previous',catalog,platforms);L.providerIntake=intake;L.providerComparisonIntake=previous;
    L.providerPublished.intakeCatalog=catalog;
   }catch(e){if(!current())return;if(api.denied(e))throw e;L.providerIntake={status:'error',platforms:[],error:e.message||'采集目录核对失败'};L.providerComparisonIntake={...L.providerIntake};}
   capturePublishedView();setReadPhase(serial,'读取当前费率与未到账工单');
   await ensureFeeLookup(false,true);if(!current())return;capturePublishedView();
   await workordersLoad(false,true,force);if(!current())return;
   capturePublishedView();
   // Provider unions require published distinct-member evidence. Do not join
   // a newer live computation to an immutable order publication or fan out
   // from a normal provider selection. Explicit realtime remains available.
   if(!projection.projectionComplete)L.providerPublished.projectionError='所选三方去重合计尚未发布；订单结果已筛选，可用实时明细查询核对去重统计';

  }catch(e){if(!current())return;if(api.denied(e)){clearPublishedAuthority();}else{L.providerPublished={...L.providerPublished,loading:false,error:e.message||'已发布汇总读取失败'};if(L.providerPublished.view&&L.providerPublished.view.queryScope!==aggregateQueryScope())L.dirty=true;}}
  finally{if(serial===L.serial){publishedController=null;L.loading=false;if(L.providerPublished)L.providerPublished.loading=false;endReadPhases(serial);render();}}
 }
 async function exportPublishedOrCurrent(){
  if(state.page!=='providers'||L.providerReadMode!=='published')return exportCurrentTable();
  syncPublishedIdentity();const p=L.providerPublished;if(!canExportCurrentPage()){toast('当前角色没有导出权限');return;}
  if(!p?.bundle?.complete||!p.projectionComplete||!p.appliedWindow||!p.view||p.loading||L.dirty||p.view.queryScope!==aggregateQueryScope()||phasedReadBusy()||p.view.providerIntake?.status!=='ready'||p.view.providerComparisonIntake?.status!=='ready'||!Array.isArray(p.view.feeLookupRows)||p.view.feeLookupError||!p.view.workorders&&!p.view.workordersUnsupported||p.view.workordersError&&!p.view.workordersUnsupported){toast('请先读取完整的已发布汇总后导出');return;}
  const serial=L.serial,context=p.context,controller=new AbortController();publishedController?.abort();publishedController=controller;
  try{const api=window.HensemProviderPublished,request={...p.request,export:true},next=await window.hensemLiveRequest(request,{signal:controller.signal});if(serial!==L.serial||state.page!=='providers'||p!==L.providerPublished||controller.signal.aborted||context!==publishedIdentity()||!canExportCurrentPage()||L.dirty||p.view.queryScope!==aggregateQueryScope())return;api.validate(next,request,p.view.queryPlatforms);if(!next.complete||api.generation(next)!==api.generation(p.bundle)){toast('发布结果已变化，请刷新并查看后再导出');return;}return withPublishedView(()=>exportCurrentTable());}
  catch(e){if(serial!==L.serial||controller.signal.aborted||context!==publishedIdentity())return;if(window.HensemProviderPublished.denied(e)){clearPublishedAuthority();render();}else toast(e.message||'导出权限核对失败');}
  finally{if(publishedController===controller)publishedController=null;}
 }

  window.liveQuery=function(force=!usesQueryCache(state.page)){return window.liveLoad(force,true)};
  window.liveRefresh=()=>window.liveLoad(true,true,false,true);
  window.liveProviderRealtimeQuery=()=>state.page==='providers'&&roleAllowed('providers','query')?window.liveLoad(true,true,true):Promise.resolve();
  window.liveLoad=async function(force=true,manual=false,realtime=false,refreshPrepared=false){
  if((isTeamWorkspace(state.page)||isSuccessAnalysis()||isDailyComparison()||isChannelStatus())&&!roleAllowed(state.page,'query')){toast('当前角色没有此视图查询权限');return;}
  normalizePageDirection();
  if(isSupervisorPage(state.page)){render();return}
  if(!manual)return;
  const queryPage=state.page,queryNavigation=navigationRevision;
  if(!L.catalogReady){await initializeLiveData();if(!L.catalogReady||state.page!==queryPage||navigationRevision!==queryNavigation)return;}if(!L.country&&!L.countryTouched&&reportData&&state.page!=='stuck'){const catalog=await reportData.loadCatalog();if(state.page!==queryPage||navigationRevision!==queryNavigation)return;if(catalog?.length){L.country=catalog.find(p=>p.country&&countrySelectable(p.country))?.country||'';syncCurrency();livePeriod('yesterday',false);}}L.pageQueried=true;if(state.page==='overview')L.overviewQueried=true;if(force)workordersReadCache?.clear();
  if(state.page==='collected_data'){await collectedPage.load(true);return}if(state.page==='payout_config'){await HensemLivePayoutConfig.refresh();return}if(isWithdrawPage(state.page)){await autoWithdrawLoad(true);return}if(['deposit_tracking','deposit_statistics'].includes(state.page)){await depositIssuesLoad(true);return}if(state.page==='provider_config'){await providerConfigLoad();return}if(state.page==='teams'||state.page==='platform_systems'){await platformAssignmentsLoad();return}if(isWorkorderOperations(state.page)&&workorderOperations){await workorderOperations.load(true);return}if(state.page==='rates'){await liveRates(true);return}
  if(!L.country||!countrySelectable(L.country)){cancelDataReads();L.serial++;L.loading=false;L.queryRetrying=false;L.dirty=true;L.error='请选择具体国家后查询。';render();return;}
  if(isChannelStatus()){cancelDataReads();L.restoredPage=false;L.error='';if(!channelStatus){L.error='平台通道调整暂不可用';render();return;}await channelStatus.load();return;}
  if(isDailyComparison()){cancelDataReads();L.restoredPage=false;L.error='';L.queryNow=Date.now();if(force)clearAggregateCache();if(!dailyComparison){L.error='每日对比暂不可用';render();return;}await dailyComparison.load(force,refreshPrepared);return;}
  if(state.page==='stuck'){const serial=++L.serial;cancelDataReads();L.restoredPage=false;L.dirty=false;L.error='';L.loading=true;L.queryNow=Date.now();render();try{if(!pendingAnalysis)throw Error('代付中分析暂不可用');await pendingAnalysis.load(force);}catch(e){if(serial===L.serial)L.error=e.message||'读取失败';}finally{if(serial===L.serial){L.loading=false;render();}}return;}
  if(state.page==='events'){if(!L.dirty&&(L.loading||phasedReadBusy()))return;const queryNow=!force&&!L.dirty&&(submissionAnalysis?.canReuseWindow?.()||Date.now()>=L.queryNow&&Date.now()-L.queryNow<30000)?L.queryNow:Date.now(),serial=++L.serial;cancelDataReads();L.restoredPage=false;L.dirty=false;L.error='';L.queryNow=queryNow;L.loading=true;beginReadPhases(serial);render();try{if(window.HensemAmountBands)await prepareAmountBands(serial);if(serial!==L.serial)return;if(L.dirty){L.loading=false;return;}L.loading=false;setReadPhase(serial,'读取刷单风控统计');await submissionAnalysis?.load(force);}catch(e){if(serial===L.serial)L.error=e.message||'读取失败';}finally{if(serial===L.serial)L.loading=false;endReadPhases(serial);}return;}
  if(state.page==='orders'&&!orderPlatform()){L.serial++;cancelDataReads();L.queryRetrying=false;L.detailSerial++;L.loading=false;L.detailBusy=false;L.results=[];L.detail=null;L.error='';L.queryWarnings=[];L.queryFailures=[];L.queryPlatforms=[];L.queryScope='';L.comparisonResults=[];L.comparisonStatus='idle';L.dirty=true;providerOrders.cancel();loadProviderOptions();render();return}
  if(teamSheetReports?.onlyReports()){const reportSerial=++L.serial;cancelDataReads();L.providerReadMode='live';L.providerPublished=null;L.publishedWindow=null;L.restoredPage=false;L.dirty=false;L.loading=true;L.error='';L.results=[];L.queryPlatforms=[];L.queryFailures=[];render();try{await teamSheetReports.load({force:refreshPrepared});}finally{if(reportSerial===L.serial){L.loading=false;render();}}return;}
  if(!realtime&&state.page==='providers'&&(!window.HensemStatisticWindows||HensemStatisticWindows.same(L))&&window.HensemProviderPublished?.eligible({page:state.page,L,platforms:selected(),visible:selectedVisible(),providers:activeValues('provider'),now:Date.now()}))return loadPublishedProviders(force);
  L.providerReadMode='live';L.providerPublished=null;L.publishedWindow=null;
  try{if(statisticWindowsEnabled())HensemStatisticWindows.validate(L)}catch(e){L.error=e.message;L.dirty=true;render();return;}
  const scope=aggregateQueryScope();
  if(state.page==='providers'&&(L.retainedContent?.queryScope!==scope||L.retainedContent?.providerReadMode!=='live'))L.retainedContent=null;
  if(!L.catalogReady||(L.loading||phasedReadBusy())&&!L.dirty&&L.inflightScope===scope)return;L.inflightScope=scope;
  // Within the real-time TTL reuse the same exact as-of window, not a wider
  // interval pretending that an older cached result already covers new seconds.
  const queryNow=!force&&usesQueryCache(state.page)&&!L.dirty&&L.queryScope===scope&&Date.now()>=L.queryNow&&Date.now()-L.queryNow<30000?L.queryNow:Date.now();
  let successRange=null;if(isSuccessAnalysis()){syncSuccessIdentity();try{successRange=successWindows(selected(),queryNow);}catch(e){L.error=e.message;L.dirty=true;render();return;}}L.restoredPage=false;const platforms=selected();if(force){clearAggregateCache();providerIntake?.clearCache?.();}loadProviderOptions();const serial=++L.serial;cancelDataReads();preparedRefreshScope=refreshPrepared?{serial,page:state.page,context:aggregateAccessContext()}:null;L.merchantTrend=null;L.overviewIntake=null;L.providerIntake=null;L.providerComparisonIntake=null;L.queryScope=scope;L.queryPaused=false;L.queryPlatforms=platforms.slice();L.queryFailures=[];L.queryRetrying=false;providerOrders.cancel();L.detailSerial++;L.workordersSerial++;L.workorders=null;L.workordersLoading=false;L.workordersError='';L.workordersScope='';if(isSuccessAnalysis()){L.pageQueried=true;L.successContext=successIdentity();L.successWindows=successRange;L.successApplied=null;}L.queryNow=queryNow;L.comparisonResults=[];L.comparisonStatus='idle';L.comparisonError='';L.error='';L.queryWarnings=[];L.dirty=false;L.loading=true;L.progress=statisticWindowsEnabled()?'正在读取已准备统计…':'正在读取正式订单…';L.detail=null;L.page=1;L.localPage=1;L.tablePages={};L.results=[];L.loadedView=L.status==='all'?aggregateMode():'full';beginReadPhases(serial);prepareFeeLookupQuery(force);memberCounts?.beginQuery?.(force);render();
  if(teamSheetReports?.hasReports())void teamSheetReports.load({force:refreshPrepared});
  let index=0,done=0;const results=[];let submissionBatch=null,cancelProgressPaint=()=>{};
  try{
   if(!isSuccessAnalysis()&&window.HensemAmountBands)await prepareAmountBands(serial);if(serial!==L.serial)return;if(L.dirty){L.loading=false;return;}
   if(state.page==='providers')submissionBatch=submissionAnalysis?.startWithOrders(force);
   const requests=platforms.map(p=>query(p,'aggregate'));if(state.page==='orders'&&platforms.length===1&&orderSource(platforms[0])==='panda'){L.loading=false;await liveDetails();return;}
   // Paint completed prepared platforms while other platforms are pending. One
   // frame shares the same query identity; a cancelled or changed scope cannot
   // repaint a newer screen with an earlier partial result.
   const preparedProgress=statisticWindowsEnabled(),progressPage=state.page,progressContext=preparedProgress?aggregateAccessContext():null,progressNatives=preparedProgress?JSON.stringify(requests.map(aggregateNativeIdentity)):null;
   let progressPending=false,progressFrame=null,progressClosed=false;
   function paintProgress(){progressPending=false;progressFrame=null;if(progressClosed||serial!==L.serial||state.page!==progressPage||!L.loading||L.dirty||scope!==aggregateQueryScope()||progressContext!==aggregateAccessContext()||progressNatives!==JSON.stringify(requests.map(aggregateNativeIdentity))||!roleAllowed(progressPage,'view')||!roleAllowed(progressPage,'query'))return;render();}
   function scheduleProgressPaint(){if(progressClosed||progressPending)return;progressPending=true;if(typeof window.requestAnimationFrame==='function')progressFrame=window.requestAnimationFrame(paintProgress);else Promise.resolve().then(paintProgress);}
   cancelProgressPaint=()=>{progressClosed=true;if(progressFrame!==null&&typeof window.cancelAnimationFrame==='function')window.cancelAnimationFrame(progressFrame);progressFrame=null;progressPending=false;};
   async function worker(){while(index<requests.length&&serial===L.serial){const i=index++;if(phasedReadBusy()&&!statisticWindowsEnabled())setReadPhase(serial,'读取 '+platforms[i].name+' 的当期订单');try{const r=await readAggregate(requests[i],serial,!force);if(serial!==L.serial)return;results[i]=r}catch(e){if(serial!==L.serial)return;if(['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED'].includes(String(e?.code||''))){L.retainedContent=null;L.results=[];L.comparisonResults=[];L.serial++;cancelDataReads();L.loading=false;L.error='登录或查询权限已变化，请重新验证';render();return;}if(['stale','invalid'].includes(e?.status))L.retainedContent=null;L.queryFailures.push({id:platforms[i].id,name:platforms[i].name,message:e.message||'读取失败',status:e.status||'failed'});L.queryWarnings=L.queryFailures.map(f=>f.name+'：'+f.message)}if(serial!==L.serial)return;done++;L.results=results.filter(Boolean);L.progress='正式数据读取：完整返回 '+results.filter(Boolean).length+' / '+requests.length+' 个平台'+(L.queryWarnings.length?'，未完成 '+L.queryWarnings.length+' 个':'')+'；已处理 '+done+' 个';if(preparedProgress)scheduleProgressPaint();else render()}}
   // Main deposit orders get two bounded workers. Supplementary exclusions
   // start only after every order worker settles, then keep their single lane.
   await Promise.all(Array.from({length:Math.min(statisticWindowsEnabled()?50:state.page==='providers'?2:phasedReadBusy()?1:2,requests.length)},()=>worker()));cancelProgressPaint();if(serial!==L.serial)return;
   L.results=results.filter(Boolean);L.providerOptions=[...new Set([...L.providerOptions,...L.results.flatMap(r=>(r.groups?.provider||[]).map(g=>window.HensemProviderNames?.canonical(g.provider,L.country)??g.provider)).filter(Boolean)])].sort();
   if(state.page==='overview'&&L.direction!=='charge'){
    // Keep render-driven supplementary reads gated until the bounded snapshot
    // queue settles. Today's pending value still reads these aggregate results.
    pendingSnapshotPhase=serial;
    try{await pendingSnapshot?.load(force);}finally{if(pendingSnapshotPhase===serial)pendingSnapshotPhase=null;}
    if(serial!==L.serial)return;
   }
   L.loading=false;
   if(state.page==='providers'&&requests.length&&!L.results.length){
    submissionAnalysis?.cancel();L.comparisonStatus='error';L.comparisonError='当前订单统计未准备，暂不读取前期对比';render();return;
   }
   if(state.page==='providers'&&phasedReadBusy()){
    // One query-owned budget covers both supplementary lanes, starting only
    // after the main table settles. Completed statistics remain available.
    setReadPhase(serial,L.queryFailures.length?'主表读取未完成，正在补充已返回范围的统计':'主表已完成，正在补充统计');
    const phase=readPhase,deadlineAt=Date.now()+60000;let stopped=false,timer,release;
    const deadline=new Promise(resolve=>{release=resolve;});
    const owned=()=>serial===L.serial&&readPhase===phase&&!L.dirty;
    const current=()=>!stopped&&owned()&&Date.now()<deadlineAt;
    const close=()=>{if(stopped)return;stopped=true;clearTimeout(timer);release();};
    phase.cancelSupplementary=close;
    const pauseAtDeadline=()=>{
     if(stopped||!owned()){close();return;}close();
     const message='补充统计已达 60 秒，未完成部分已暂停；已完成结果保留，可单独重试';
     const feePending=L.feeLookupLoading;cancelFeeLookup();if(feePending||L.feeLookupRows===null)L.feeLookupError=message;
     submissionAnalysis?.pauseSupplementary();
     if(L.comparisonStatus==='loading'){cancelAggregateReads();L.comparisonStatus='error';L.comparisonError=message;}
     else if(L.comparisonStatus==='idle'){L.comparisonStatus='error';L.comparisonError=message;}
     workordersReadCache?.cancel();L.workordersSerial++;L.workordersLoading=false;if(!L.workorders&&!L.workordersUnsupported)L.workordersError=message;
     providerIntake?.cancel();for(const key of ['providerIntake','providerComparisonIntake'])if(L[key]?.status==='loading')L[key]={...L[key],status:'error',error:message};
     L.progress=message;render();
    };
    timer=setTimeout(pauseAtDeadline,60000);
    const exclusions=(async()=>{try{if(!submissionBatch)return;for(const platform of platforms){if(!current())return;await submissionBatch.read(platform.id);}if(current())await submissionBatch.finish();}catch(e){if(current()){submissionAnalysis?.cancel();toast('剔除统计未完成，请重试未完成平台');}}})();
    const attachments=(async()=>{
     await ensureFeeLookup(false,true,current);if(!current())return;
     // Prepared comparison does not wait for independent workorder evidence.
     if(!statisticWindowsEnabled()&&platforms.length)await workordersLoad(false,true,false,current);if(!current())return;
     if(L.queryWarnings.length){L.comparisonStatus='error';L.comparisonError='当前平台数据未完整，暂不比较昨日';}
     else await liveComparison(serial,!force,1,current);if(!current())return;
     if(statisticWindowsEnabled()&&platforms.length)await workordersLoad(false,true,false,current);if(!current())return;
     await loadProviderIntake(serial,false,1,current);if(!current())return;
     if(!L.queryWarnings.length)await loadProviderIntake(serial,true,1,current);
    })();
    try{const settled=await Promise.race([Promise.allSettled([exclusions,attachments]),deadline]);if(current()&&settled?.[1].status==='rejected')toast('补充统计未完成，请重试；已完成数据保留');}
    finally{if(!stopped&&owned()&&Date.now()>=deadlineAt)pauseAtDeadline();else close();}
    return;
   }
   // Source-day reconciliation is supplementary evidence. A slow check must
   // not hold the previous-period figures or workorder attachment behind it.
   if(isSuccessAnalysis()){render();if(platforms.length)await workordersLoad();return;}
   if(phasedReadBusy()){
    setReadPhase(serial,'读取费率目录');await ensureFeeLookup(false,true);
    if(serial!==L.serial)return;
    if(L.queryWarnings.length){L.comparisonStatus='error';L.comparisonError='当前平台数据未完整，暂不比较昨日';}
    else{setReadPhase(serial,'读取昨日对比');await liveComparison(serial,!force,1);}
    if(serial!==L.serial)return;setReadPhase(serial,'核对当期采集完整性');await loadProviderIntake(serial,false,1);
    if(serial!==L.serial)return;if(!L.queryWarnings.length){setReadPhase(serial,'核对前期采集完整性');await loadProviderIntake(serial,true,1);}
    if(serial!==L.serial)return;if(providerDirection(state.page)&&platforms.length){setReadPhase(serial,'读取未到账工单');await workordersLoad(false,true);}
    if(serial!==L.serial)return;if(state.page==='merchants'&&L.status==='all'&&!['orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr'].some(key=>L[key])){setReadPhase(serial,'读取会员人数');await memberCounts?.ensure(false,1);}
    return;
   }
   const intakeRead=loadProviderIntake(serial);if(serial!==L.serial)return;
   if(L.queryWarnings.length){L.comparisonStatus='error';L.comparisonError='当前平台数据未完整，暂不比较昨日';render();await intakeRead;return}
   render();await Promise.all([state.page==='orders'?liveDetails():Promise.resolve(),liveComparison(serial,!force),(platforms.length&&state.page==='overview'&&L.overviewAnalysis)?workordersLoad():Promise.resolve(),intakeRead]);
  }catch(e){if(serial!==L.serial)return;L.error=e.message||'读取失败';L.loading=false;render()}finally{cancelProgressPaint();endReadPhases(serial)}
 };
 // Opening or restoring a provider tab can reuse payment aggregates without a
 // main query. Its workorders still need their own matching date/direction scope.
 function ensureProviderWorkorders(retry=false,inPhase=false){
  if(state.page==='providers'&&L.providerReadMode==='published'&&!retry&&!inPhase)return;
  if(!(providerDirection(state.page)||isSuccessAnalysis())||!L.catalogReady||L.loading||phasedReadBusy()&&!inPhase||L.queryRetrying||L.dirty)return;
  if(isSuccessAnalysis()&&(!roleAllowed(state.page,'query')||!successFullDays()||L.queryScope!==aggregateQueryScope()))return;
  const sameScope=L.workordersScope===workordersScope();
  if(retry&&L.workordersScope&&!sameScope)return;
  if(sameScope&&(L.workordersLoading||L.workorders&&!retry||L.workordersUnsupported||L.workordersError&&!retry))return;
  return workordersLoad(true,inPhase,retry);
 }
 window.liveProviderWorkordersRetry=async function(){await ensureProviderWorkorders(true);capturePublishedView()};
 // A matching captured scope authorizes retry on every aggregate page, including risk.
 // Keep completed results; navigation resumes only missing or failed platforms.
 window.liveRetryFailed=async function(resume=false){
  if(state.page==='providers'&&L.providerReadMode==='published'){if(!L.dirty)return window.liveQuery(true);return;}
  if((isTeamWorkspace(state.page)||isSuccessAnalysis()||isDailyComparison()||isChannelStatus())&&!roleAllowed(state.page,'query')){toast('当前角色没有此视图查询权限');return;}
  
  if(L.loading||phasedReadBusy()||L.dirty||L.queryRetrying||!L.catalogReady||L.queryScope!==aggregateQueryScope()||(!L.queryFailures.length&&!(resume&&L.queryPaused)))return;
  const platforms=L.queryPlatforms.slice(),failureMap=new Map(L.queryFailures.map(f=>[f.id,f])),tasks=platforms.filter(p=>failureMap.has(p.id)||resume&&!L.results.some(r=>r.platform?.id===p.id));
  L.queryPaused=false;L.restoredPage=false;
  if(!tasks.length){render();return;}
  const completed=new Map(L.results.map(r=>[r.platform?.id,r])),serial=++L.serial;
  cancelDataReads();beginReadPhases(serial);resumeFeeLookupIntent();providerOrders.cancel();L.detailSerial++;L.queryRetrying=true;L.error='';L.comparisonStatus='error';L.comparisonError='当前平台数据未完整，暂不比较昨日';render();let index=0;
  async function worker(){while(index<tasks.length&&serial===L.serial){const platform=tasks[index++];try{
   const result=await readAggregate(query(platform,'aggregate'),serial,false);if(serial!==L.serial)return;completed.set(platform.id,result);failureMap.delete(platform.id);
  }catch(e){if(serial!==L.serial)return;failureMap.set(platform.id,{id:platform.id,name:platform.name,message:e.message||'读取失败',status:e.status||'failed'})}
   L.results=platforms.map(p=>completed.get(p.id)).filter(Boolean);L.queryFailures=[...failureMap.values()];L.queryWarnings=L.queryFailures.map(f=>f.name+'：'+f.message);render();
  }}
  try{
   await Promise.all(Array.from({length:Math.min(phasedReadBusy()?1:2,tasks.length)},()=>worker()));
   if(serial!==L.serial)return;L.queryRetrying=false;if(!L.queryFailures.length){L.comparisonStatus='idle';L.comparisonError=''}L.providerOptions=[...new Set([...L.providerOptions,...L.results.flatMap(r=>(r.groups?.provider||[]).map(g=>window.HensemProviderNames?.canonical(g.provider,L.country)??g.provider)).filter(Boolean)])].sort();render();
   if(state.page==='providers'&&!L.results.length)return;
   if(!isSuccessAnalysis())await loadProviderIntake(serial,false,phasedReadBusy()?1:2);if(serial===L.serial)await ensureProviderWorkorders(false,true);
  }finally{if(serial===L.serial)L.queryRetrying=false;endReadPhases(serial);}

 };
 async function liveComparison(serial,allowCache=false,concurrency=2,isCurrent=()=>serial===L.serial){if(state.page==='providers'&&L.providerReadMode==='published')return;if(!isCurrent()||isSuccessAnalysis()||isDailyComparison())return;if(L.results.some(r=>r.pandaCoverage?.reason==='verified_created_prefix_only')){L.comparisonStatus='error';L.comparisonError='本期仅有已核验截止范围，暂不与前期整日统计比较';L.comparisonResults=[];return;}if(statisticWindowsEnabled()&&selected().some(p=>{const q=statisticRequest(p);return Date.parse(q.endAt)>L.queryNow||Date.parse(q.successEndAt)>L.queryNow})){L.comparisonStatus='error';L.comparisonError='当前时间段尚未结束，待同口径前期汇总准备完成后比较';L.comparisonResults=[];return;}L.comparisonStatus='loading';render();let index=0,failed=false;const results=[];try{const requests=selected().map(p=>query(p,'aggregate',true));async function worker(){while(index<requests.length&&!failed&&isCurrent()){const i=index++;try{const r=await readAggregate(requests[i],serial,allowCache,false,isCurrent);if(!isCurrent()||failed)return;results[i]=r}catch(e){failed=true;throw e}}}const workers=Math.min(statisticWindowsEnabled()?50:concurrency,requests.length);await Promise.all(Array.from({length:workers},()=>worker()));if(!isCurrent())return;L.comparisonResults=results;L.comparisonStatus='ready';render()}catch(e){if(!isCurrent())return;L.comparisonResults=[];L.comparisonStatus='error';L.comparisonError='前期数据读取未完成：'+(e.message||'请重试');render()}}
 async function readDetails(p,serial){const cached=L.results.find(r=>r.platform?.id===p.id),parts=cached?._parts;if(!parts||parts.length<2)return window.hensemLiveRequest(query(p,'details'));const ordered=[...parts].sort((a,b)=>Date.parse(b.startAt)-Date.parse(a.startAt)),total=ordered.reduce((n,r)=>n+Number(r.total||0),0),rows=[];let skip=(L.page-1)*L.size;for(const part of ordered){if(serial!==L.detailSerial)throw Error('查询已替换');const n=Number(part.total||0);if(skip>=n){skip-=n;continue}const request={...query(p,'details'),startAt:part.startAt,endAt:part.endAt,offset:skip};const response=await window.hensemLiveRequest(request);if(serial!==L.detailSerial)throw Error('查询已替换');if(Number(response.total)!==n)throw Error('源订单已更新，请重新查询以同步总数与分页');rows.push(...(response.rows||[]).slice(0,L.size-rows.length));skip=0;if(rows.length>=L.size)break;}return {platform:p,total,rows,limit:L.size,offset:(L.page-1)*L.size,hasMore:L.page*L.size<total};}
 window.liveDetails=async function(){if(!L.catalogReady)return;const p=orderPlatform();if(!p)return;const serial=++L.detailSerial;L.error='';L.detailBusy=true;L.detail=null;render();try{const r=await readDetails(p,serial);if(serial!==L.detailSerial)return;const max=Math.max(1,Math.ceil(Number(r.total||0)/L.size));if(L.page>max){L.page=max;L.detailBusy=false;return liveDetails()}L.detail=r;L.detailBusy=false;render()}catch(e){if(serial!==L.detailSerial)return;L.detailBusy=false;L.error=e.message;render()}};
 L.detailSerial=0;
 const providerOrders=HensemProviderOrders.create({L,E,N,C,table,box,formatTime,successTimeLabel,query,orderFieldValue,request:(r,options)=>window.hensemLiveRequest(r,options),publishedWindow:()=>state.page==='providers'&&L.providerReadMode==='published'&&!L.dirty?L.publishedWindow:null,openDrawer:(title,html)=>openDrawer(title,html)});
 window.liveChoosePlatform=function(id){
  if(!L.catalog.some(p=>p.id===id||(p.aliasPlatformIds||[]).includes(id)))return;
  const filters={country:L.country,from:L.from,to:L.to,successFrom:L.successFrom,successTo:L.successTo,successBasis:L.successBasis,direction:L.direction,team:L.team,source:L.source,provider:L.provider,multi:JSON.parse(JSON.stringify(L.multi))};
  setPage('orders');if(state.page!=='orders')return;
  reportData?.cancel();L.serial++;cancelDataReads();L.detailSerial++;providerOrders.cancel();
  Object.assign(L,filters,{platform:id,page:1,pageQueried:false,restoredPage:false,loading:false,detailBusy:false,detail:null,results:[],comparisonResults:[],queryPaused:false,queryRetrying:false,queryWarnings:[],queryFailures:[],queryScope:'',error:'',dirty:true});
  L.multi.platform=[id];L.multi.direction=L.direction==='all'?[]:[L.direction];L.providerOptionsSerial++;L.providerOptionsKey='';L.providerOptions=[];L.providerOptionsBusy=false;L.providerOptionsError='';syncCurrency();render();
 };
 window.liveProvider=function(name){if(isSuccessAnalysis()||state.page==='providers'){L.serial++;cancelDataReads();L.workordersSerial++;L.loading=false;L.queryRetrying=false;}cancelFeeLookup();L.provider=name;L.multi.provider=name?[name]:[];L.page=1;L.dirty=true;render()};
 window.liveView=function(view){if(view!=='trend'&&L.merchantTrend?.status==='loading')L.merchantTrend.status='paused';L.view=view;L.localPage=1;render();if(state.page==='merchants'&&view==='trend')return loadMerchantTrend();};
 // Changing a loaded table's page is presentation-only. Keep its data, pending
 // requests and scroll position, without opportunistic supplementary reads.
 function renderLocalPagination(){const saved=pageScroll(),viewport={x:saved.x,y:saved.y,restoring:true};localPaginationPaint=true;localPaginationViewport=viewport;try{render()}finally{localPaginationPaint=false;localPaginationViewport=null}restorePageScroll(saved,viewport)}
  window.livePage=function(page,kind){if(!Number.isInteger(page)||page<1)return;if(kind.startsWith('ref-')){const id=kind.slice(4);L.tablePages=L.tablePages||{};L.tablePages[id]=page;renderLocalPagination()}else if(kind==='fee'){L.feePage=Math.min(page,Math.max(1,Math.ceil(Number(L.fees?.total||0)/L.feeSize)));liveRates(true)}else if(kind==='server'){L.page=Math.min(page,Math.max(1,Math.ceil(Number(L.detail?.total||0)/L.size)));liveDetails()}else if(kind==='workorders'){L.workordersPage=page;workordersLoad()}else if(kind==='auto-withdraw'){L.autoWithdrawPage=page;autoWithdrawLoad()}else if(kind==='deposit-issues'){L.depositIssuesPage=page;depositIssuesLoad()}else if(kind==='provider-config'){L.providerConfigPage=page;providerConfigLoad()}else if(kind==='platform-assignments'){L.platformAssignmentsPage=page;platformAssignmentsLoad()}else{L.localPage=page;renderLocalPagination()}};
  window.livePageSize=function(size,kind){if(![20,30,50,100,500].includes(Number(size)))return;if(kind.startsWith('ref-')){const id=kind.slice(4);L.tableSizes=L.tableSizes||{};L.tablePages=L.tablePages||{};L.tableSizes[id]=Number(size);L.tablePages[id]=1;renderLocalPagination()}else if(kind==='fee'){L.feeSize=Number(size);L.feePage=1;liveRates(true)}else if(kind==='server'){L.size=Number(size);L.page=1;liveDetails()}else if(kind==='workorders'){L.workordersSize=Number(size);L.workordersPage=1;workordersLoad()}else if(kind==='auto-withdraw'){L.autoWithdrawSize=Number(size);L.autoWithdrawPage=1;autoWithdrawLoad()}else if(kind==='deposit-issues'){L.depositIssuesSize=Number(size);L.depositIssuesPage=1;depositIssuesLoad()}else if(kind==='provider-config'){L.providerConfigSize=Number(size);L.providerConfigPage=1;providerConfigLoad()}else if(kind==='platform-assignments'){L.platformAssignmentsSize=Number(size);L.platformAssignmentsPage=1;platformAssignmentsLoad()}else{L.localSize=Number(size);L.localPage=1;renderLocalPagination()}};
  window.depositIssuesLoad=depositIssuesLoad;
 window.liveJump=function(kind,max){const n=Number(document.getElementById('live-jump-'+kind)?.value);if(Number.isInteger(n)&&n>=1&&n<=max)livePage(n,kind)};
 window.liveOrder=function(index){const r=L.detail?.rows?.[index];if(!r)return;const p=L.detail.platform,zone=p?.timezone;if(orderSource(p)==='panda'){openDrawer('订单详情 · '+(r.order_number||r.order_no||''),box('订单明细',table(['字段','值'],HensemProviderOrders.pandaRows(r,p,{E,N,formatTime}))));return;}openDrawer('订单详情 · '+(r.order_number||r.order_no||''),box('订单与关联字段',table(['字段','值'],[['订单号',E(r.order_number||r.order_no||'—')],['系统 ID',E(orderFieldValue(p,'systemOrderId',r.system_order_id||r.id)||'—')],['三方订单号',E(orderFieldValue(p,'thirdPartyOrderNumber',r.third_party_order_number||r.provider_order_number)||'—')],['会员 ID',E(r.member_id||'—')],['UTR',E(orderFieldValue(p,'utr',r.utr)||'未提供')],['平台',E(p?.name)],['团队',E(p?.team||'未绑定团队')],['国家',E(p?.country)],['包网系统',E(p?.source)],['三方',E(r.provider)],['原始三方',E(r.raw_provider===undefined?'接口未提供':r.raw_provider==null||r.raw_provider===''?'（空）':r.raw_provider)],['原始类型',E(r.channel_type||'—')],['归类依据',E(providerOrders.reason(r))],['方向',directionName(r.direction)],...HensemProviderOrders.moneyRows(r,{E,N}),['实际金额',N(r.actual_amount)+(r.currency?' '+E(r.currency):'')],['订单状态',E(statName(r.status_group||r.status))],...(window.HensemOrderBusiness?.rows(r,p,{E,N,formatTime})||[])]))+box('提交与成功统计时间',table(['创建时间',successTimeLabel(p,L.detail),'数据同步时间','时区'],[[E(formatTime(r.created_at,zone)),E(formatTime(r.success_at,zone)),E(formatTime(r.synced_at,zone)),E(zone)]]))+box('费用与费率依据',table(['估算手续费','实际手续费','费率版本','费率生效时间'],[[N(r.fee_version_estimated_amount),N(orderFieldValue(p,'recordedFee',r.withdraw_fee)),detailFeeVersion(r),E(formatTime(r.fee_version_effective_from,zone))]]),detailFeeState(r)))};

 window.liveRates=async function(force=false,reset=false){if(L.feeView!=='normalized'&&window.HensemLiveRatesRestored){L.dirty=false;HensemLiveRatesRestored.resume();render();if(force||!HensemLiveRatesRestored.snapshot().hasGrid)await HensemLiveRatesRestored.load();return}if(L.fees&&!force){render();return}if(reset)L.feePage=1;const serial=++L.feeSerial;L.feeLoading=true;L.feeError='';L.dirty=false;render();try{if(!L.feeCountry||!countrySelectable(L.feeCountry))throw Error('请选择具体国家后查询。');const request={action:'rates',scopeType:L.feeScope,offset:(L.feePage-1)*L.feeSize,limit:L.feeSize};if(L.feeCountry!=='all')request.country=L.feeCountry;if(L.feeQuery)request.query=L.feeQuery;const result=await window.hensemLiveRequest(request);if(serial!==L.feeSerial)return;const max=Math.max(1,Math.ceil(Number(result.total||0)/L.feeSize));if(L.feePage>max){L.feePage=max;L.feeLoading=false;return liveRates(true)}L.fees=result;}catch(e){if(serial!==L.feeSerial)return;L.feeError=e.message}finally{if(serial===L.feeSerial){L.feeLoading=false;state.page==='rates'&&render()}}};
 function exportCurrentTable(){if(['auto_withdraw','withdraw_operators'].includes(state.page)&&!withdrawPages.canExport()){toast('请先查询当前筛选条件，读取完成后再导出');return;}if(!isDailyComparison()&&statisticWindowsEnabled()&&(L.dirty||L.loading||L.queryRetrying||L.queryPaused||L.queryFailures.length||L.error||!L.results.length)){toast('请先查询并读取完成后再导出');return;}if(isSuccessAnalysis()){syncSuccessIdentity();if(L.dirty||!L.pageQueried||L.loading||L.queryRetrying||L.queryPaused||L.queryFailures.length||L.error||!L.successApplied||L.queryScope!==aggregateQueryScope()){toast('请先查询并读取完成后再导出');return;}}if(state.page==='deposit_statistics'&&L.depositIssuesSection==='recovery'){if(canExportCurrentPage())return depositPages.export?.();return;}if(!canExportCurrentPage()){toast('当前角色没有导出权限');return}if(isSupervisorPage(state.page)){toast('员工测试站尚未接通，暂无可导出记录');return}if((isDailyComparison()||isChannelStatus())&&(L.dirty||!L.pageQueried||!(isChannelStatus()?channelStatus:dailyComparison)?.canExport?.())){toast('请先查询当前筛选条件，读取完成后再导出');return;}const page=document.getElementById('page'),tables=[...page.querySelectorAll('table')].filter(t=>!t.closest?.('.deposit-inline-detail,.wo-reconciliation-expanded'));if(!tables.length&&!isDailyComparison()&&!isChannelStatus()){toast('当前没有可导出的表格');return}const rows=isChannelStatus()?channelStatus.exportRows():isDailyComparison()?dailyComparison.exportRows():tables.flatMap(t=>[...t.querySelectorAll(':scope > thead > tr, :scope > tbody > tr:not(.provider-expanded-row), :scope > tfoot > tr')].filter(tr=>!tr.closest?.('.deposit-inline-detail,.wo-reconciliation-expanded')).map(tr=>[...tr.cells].map(td=>td.innerText)));if(!rows.length){toast('当前没有可导出的表格');return;}if(['auto_withdraw','withdraw_operators'].includes(state.page))rows.unshift(...(withdrawPages.exportMeta()||[]));if(!isDailyComparison()&&['overview','collection','payout','providers','provider_payout','teamops','teamcountries','teamplatforms','merchants','merchantproviders','risk','time','amount','matrix','provider_daily'].includes(state.page)&&rows.some(row=>row.some(value=>/估算手续费|代收手续费|代付手续费/.test(String(value)))))rows.unshift(['手续费口径',L.feeEstimateMode==='historical'?'按订单创建时生效费率估算；仅汇总已匹配部分。':'按当前费率估算（非历史实际手续费）；成功金额 × 费率 + 成功笔数 × 单笔费用；仅汇总已匹配部分。']);if(!isDailyComparison()&&!isChannelStatus()&&successBasisNote())rows.unshift(['统计口径',successBasisNote()+' 其他来源保留各自成功统计口径。']);if(statisticWindowsEnabled()&&newarCreatedSuccessRows().length)rows.unshift(['申请单当前成功口径',newarCreatedSuccessBasis]);if(state.page==='providers'&&L.providerReadMode==='published'){const p=L.providerPublished;rows.unshift(['发布汇总口径',(p.appliedWindow?.intraday?'截至 '+p.appliedWindow.localCutoff+'（不含，印度时间）的已发布汇总，非全天；':'整日已发布计算结果；')+'来源完整性以采集回执为准，不表示资金已到账'],['本期窗口（UTC，左闭右开）',p.bundle.window.startAt,p.bundle.window.endAt],['前期窗口（UTC，左闭右开）',p.bundle.window.previousStartAt,p.bundle.window.previousEndAt],['最早生成时间（UTC）',p.bundle.computedAt],['工单口径','完整自然日，独立读取；当前费率单独更新']);}if(!isDailyComparison()&&statisticWindowsEnabled()&&!(state.page==='providers'&&L.providerReadMode==='published')){rows.unshift(['创建时间（平台当地，含起止秒）',L.from,L.to],...(L.successFrom&&L.successTo?[[newarUpdatedClockSelectable()&&L.successBasis==='source_updated'?"源订单更新时间（平台当地，含起止秒）":"独立成功时间（平台当地，含起止秒）",L.successFrom,L.successTo]]:[[newarUpdatedClockSelectable()&&L.successBasis==='source_updated'?"源订单更新时间":"成功时间",newarUpdatedClockSelectable()&&L.successBasis==='source_updated'?"未手填独立时间；按创建日期范围及源订单更新时间统计，不代表实际到账时间":"未手填独立时间；按查询日期及来源成功/更新时间规则统计"]]),...L.results.map(r=>['已准备统计窗口（UTC，左闭右开）',r.platform?.name,r.platform?.timezone,r.startAt,r.endAt,r.successStartAt,r.successEndAt,r.successBasis,r._preparedPublication?.computedAt||'',r._preparedPublication?.sourceComplete===true?'来源完整性已确认':'来源完整性尚未确认',r.pandaCoverage?.reason==='verified_created_prefix_only'?'实际创建截止（不含，非全天）':'',r.pandaCoverage?.reason==='verified_created_prefix_only'?r.pandaCoverage.dataCutoff:'']));}if(isSuccessAnalysis()&&!statisticWindowsEnabled()){rows.unshift(['所选当地时间（含起止秒）',L.from,L.to],...(L.successWindows||[]).map(w=>['实际查询窗口（UTC，左闭右开）',w.name,w.platformId,w.timezone,w.startAt,w.endAt,w.clamped?'截至查询时刻，非全天':'']),['工单口径',successFullDays()?'按所选完整自然日范围去重汇总，独立读取':'不支持自定义时段；未读取工单，工单成功率不可用']);}const quote=v=>'"'+String(/^[=+@\-\t\r]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"',url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=state.page==='providers'&&L.providerReadMode==='published'&&L.publishedWindow?.intraday?'Hensem-代收汇总-截至-'+L.publishedWindow.localCutoff.replaceAll(':','-')+'-非全天.csv':'Hensem-当前页-'+state.page+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前可见表格页')};
  let initialLoad=null,initialDataDeferred=false;
  function initializeLiveData(){
   if(['access','rules','ip','login_logs','operation_logs','workorder_permissions','collector_control'].includes(state.page)){render();return Promise.resolve();}
   if(initialLoad)return initialLoad;
   if(L.catalogReady){initialDataDeferred=false;render();return Promise.resolve();}
   L.catalogLoading=true;L.catalogError='';L.error='';render();
   initialLoad=(async()=>{try{
    const r=await window.hensemLiveRequest({action:'catalog'});
    if(!Array.isArray(r?.platforms)||r.withdrawPlatforms!==undefined&&!Array.isArray(r.withdrawPlatforms))throw Error('平台目录响应不完整，请重试');
    L.catalog=r.platforms;L.withdrawCatalog=r.withdrawPlatforms||[];L.catalogReady=true;void teamSheetReports?.discover();
    const initialCatalog=visibleCatalog().filter(p=>countrySelectable(p.country)),preferred=initialCatalog.find(p=>String(p.name||'').toUpperCase()==='91CLUB')||initialCatalog[0]||{};
    L.country=preferred.country||initialCatalog.find(p=>p.country)?.country||'';L.platform='all';L.source='all';L.multi={team:[],platform:[],source:[],provider:[],direction:L.direction==='all'?[]:[L.direction]};
    syncCurrency();L.providerConfigCountry=L.country;livePeriod(state.page==='stuck'?'week':'yesterday',false);
    initialDataDeferred=false;L.overviewQueried=false;L.pageQueried=false;L.dirty=true;render();
   }catch(e){L.catalogError=e.message||'目录暂不可用，请重试';render()}
   finally{initialLoad=null;L.catalogLoading=false;L.initialReadComplete=true;window.liveHeader?.()}})();return initialLoad;
  }
  window.liveRetryCatalog=()=>initializeLiveData();
  window.liveExport=exportPublishedOrCurrent;
  if(window.HENSEM_PROVIDER_SNAPSHOT_SHADOW===true&&window.HensemProviderSnapshotShadow)snapshotShadow=HensemProviderSnapshotShadow.mount({request:(q,o)=>window.hensemLiveRequest(q,o),context:()=>({enabled:window.HENSEM_PROVIDER_SNAPSHOT_SHADOW===true,page:state.page,access:window.hensemRoleAccess,scope:window.hensemDataScope,catalog:L.catalog}),document});
  if(isSupervisorPage(state.page))render();else initializeLiveData();
})();

