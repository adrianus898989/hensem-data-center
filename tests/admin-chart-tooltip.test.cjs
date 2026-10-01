/* Synthetic aggregate fixtures only. No network, users or real orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),helperSource=fs.readFileSync(path.join(root,'admin-preview/live-chart-tooltip.js'),'utf8');
function helper(){const c={};c.window=c;vm.runInNewContext(helperSource,c);return c.HensemLiveChart;}
const row=(extra={})=>({hour:5,direction:'charge',currency:'INR',all_count:120,success_count:180,created_success_count:110,all_amount:'600.25',success_amount:'900.50',...extra});
test('hour inspection keeps created and success clocks separate and matches chart units',()=>{
 const h=helper(),rows=[row()],counts=[h.series({name:'本期全部',rows,key:'all_count',complete:true}),h.series({name:'本期成功',rows,key:'success_count',complete:true})];
 const html=h.tooltip({series:counts},5);assert.match(html,/05:00–05:59/);assert.match(html,/120 笔/);assert.match(html,/180 笔/);assert.doesNotMatch(html,/110 笔/);
 const money=h.series({name:'本期成功',rows,key:'success_amount',money:true,currency:'INR',complete:true});assert.match(h.tooltip({series:[money]},5),/900\.50 INR/);assert.doesNotMatch(h.tooltip({series:[money]},5),/900\.50 笔/);
 assert.equal(counts[0].points[6],0,'an omitted hour is a real zero only after the full source was read');
});
test('missing, incomplete, mixed-currency and unavailable success data never become fake zeros',()=>{
 const h=helper(),partial=h.series({rows:[row()],key:'all_count',complete:false,coverage:'本期已读 1 / 2 平台 · 来源不完整'});
 assert.equal(partial.points[5],120);assert.equal(partial.points[6],null);assert.match(h.tooltip({series:[partial]},6),/该小时未读取 \/ 来源不完整/);assert.doesNotMatch(h.tooltip({series:[partial]},6),/>0 笔/);
 for(const missing of [null,undefined,'',false,NaN])assert.equal(h.series({rows:[row({all_count:missing})],key:'all_count',complete:true}).points[5],null);
 const mixed=h.series({rows:[row(),row({currency:'BRL'})],key:'all_amount',money:true,complete:true});assert.equal(mixed.points[5],null);assert.match(h.tooltip({series:[mixed]},5),/跨币种不合计/);
 const unavailable=h.series({rows:[row({success_count:0})],key:'success_count',complete:true,unavailable:'尚未接入有效成功时间'});assert.equal(unavailable.points[5],null);assert.match(h.tooltip({series:[unavailable]},5),/尚未接入有效成功时间/);
});
function shell(h){
 const model={series:[h.series({name:'本期全部',rows:[row()],key:'all_count',complete:true,plotted:true,coverage:'本期已读 1 / 1 平台'})],max:120,note:'各平台当地时间'},bounds={left:20,top:30,width:760,height:210},attrs={};
 const tip={id:'synthetic-tip',hidden:true,innerHTML:'',style:{},getBoundingClientRect:()=>({width:240})};
 const guide={setAttribute(k,v){attrs[k]=v}},dot={style:{},setAttribute(){}},marker={style:{display:'none'},querySelector:()=>guide,querySelectorAll:()=>[dot]};
 return {tip,marker,attrs,dataset:{chartModel:JSON.stringify(model)},setAttribute(k,v){attrs[k]=v},getBoundingClientRect:()=>bounds,querySelector(selector){return selector==='svg'?{getBoundingClientRect:()=>bounds}:selector==='.live-chart-tooltip'?tip:selector==='[data-chart-marker]'?marker:null}};
}
test('mouse nearest-hour inspection, touch selection and keyboard navigation share one snapshot',()=>{
 const h=helper(),s=shell(h),before=s.dataset.chartModel;
 h.pointer({clientX:20+43+5*700/23,clientY:100,pointerType:'mouse'},s);assert.equal(s.dataset.chartHour,'5');assert.equal(s.tip.hidden,false);assert.match(s.tip.innerHTML,/120 笔/);assert.equal(s.attrs['aria-describedby'],'synthetic-tip-help synthetic-tip');
 h.pointer({clientX:20,clientY:100,pointerType:'mouse'},s);assert.equal(s.tip.hidden,true,'plot margins do not select a fake hour');
 h.pointer({clientX:20+43+7*700/23,clientY:100,pointerType:'touch'},s);h.leave({pointerType:'touch'},s);assert.equal(s.tip.hidden,false,'a touch tap survives pointer leave');assert.equal(s.dataset.chartHour,'7');
 let prevented=0;const key=k=>h.key({key:k,preventDefault(){prevented++}},s);
 key('End');assert.equal(s.dataset.chartHour,'23');key('ArrowRight');assert.equal(s.dataset.chartHour,'23');key('Home');assert.equal(s.dataset.chartHour,'0');key('ArrowLeft');assert.equal(s.dataset.chartHour,'0');key('ArrowRight');assert.equal(s.dataset.chartHour,'1');key('Escape');assert.equal(s.tip.hidden,true);assert.equal(s.marker.style.display,'none');assert.equal(prevented,6);
 assert.equal(s.dataset.chartModel,before,'inspection does not rewrite aggregate data');
});
test('letterboxed SVG coordinates select the real hour and tooltip stays within its chart',()=>{
 const h=helper(),s=shell(h);s.getBoundingClientRect=()=>({left:10,top:30,width:380,height:190});s.querySelector=((original)=>selector=>selector==='svg'?{getBoundingClientRect:()=>({left:10,top:30,width:380,height:190})}:original(selector))(s.querySelector.bind(s));
 const scale=.5,topInset=(190-210*scale)/2;
 h.pointer({clientX:10+(43+23*700/23)*scale,clientY:30+topInset+50*scale,pointerType:'mouse'},s);assert.equal(s.dataset.chartHour,'23');assert.equal(s.tip.style.left,'132px');
 h.pointer({clientX:10+100,clientY:30+10,pointerType:'mouse'},s);assert.equal(s.tip.hidden,true,'the letterboxed top margin is not data');
});
test('tooltip markup escapes source labels and has an accessible keyboard entry without affecting SVG size',()=>{
 const h=helper(),series=h.series({name:'<img src=x onerror=alert(1)>',rows:[row()],key:'all_count',coverage:'<script>bad</script>'});
 const svg='<svg class="live-chart" viewBox="0 0 760 210" role="img"></svg>',html=h.enhance(svg,{title:'A "chart"',series:[series],max:120});assert.match(html,/tabindex="0" role="group"/);assert.match(html,/role="tooltip" aria-live="polite" aria-atomic="true" hidden/);assert.match(html,/viewBox="0 0 760 210"/);assert.doesNotMatch(html,/<img|<script/);
 const tip=h.tooltip({series:[series]},5);assert.match(tip,/&lt;img/);assert.match(tip,/&lt;script&gt;/);assert.doesNotMatch(tip,/<img|<script/);
});
function actualChart(options={}){
 const live=fs.readFileSync(path.join(root,'admin-preview/live-data.js'),'utf8'),ast=ts.createSourceFile('live-data.js',live,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions=[],variables=[];
 const wantedFunctions=new Set(['plus','groupRows','chartCoverage','inspectChart','overviewChart','chart']),wantedVariables=new Set(['countKeys','amountKeys','empty','E','C']);
 function walk(n){if(ts.isFunctionDeclaration(n)&&wantedFunctions.has(n.name?.text))functions.push(n.getText(ast));if(ts.isVariableDeclaration(n)&&wantedVariables.has(n.name.getText(ast)))variables.push('const '+n.getText(ast)+';');ts.forEachChild(n,walk)}walk(ast);assert.equal(functions.length,6);assert.equal(variables.length,5);
 const p={id:'synthetic-platform'},L={queryPlatforms:[p],results:[{platform:p,groups:{hourly:[row()]}}],comparisonResults:[{platform:p,_aggregateView:'full',groups:{hourly:[row({all_count:80,all_amount:'400.25'})]}}],comparisonStatus:'ready',loadedView:'full',currency:'INR',direction:'charge',from:'2026-09-30T00:00:00',to:'2026-09-30T23:59:59',...options};
 const c={L,selected:()=>L.queryPlatforms,directionName:d=>d==='withdraw'?'代付':'代收',successTimeUnavailable:()=>!!options.successUnavailable};c.window=c;vm.runInNewContext(helperSource,c);vm.runInNewContext(variables.join('\n')+'\n'+functions.join('\n')+'\nwindow.draw=overviewChart;window.drawTime=chart;',c);return c;
}
function modelFrom(html){const encoded=html.match(/data-chart-model="([^]*?)" onpointermove=/)?.[1];assert(encoded);return JSON.parse(encoded.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));}
test('actual overview renderer includes every displayed series, preserves paths and reports source coverage',()=>{
 const c=actualChart(),before=JSON.stringify(c.L),html=c.draw(false,'charge'),model=modelFrom(html);
 assert.deepEqual(model.series.map(s=>s.name),['本期全部','本期成功','前期全部']);assert.deepEqual(model.series.map(s=>s.points[5]),[120,180,80]);assert.equal(model.series[0].coverage,'本期已读 1 / 1 平台');assert.match(html,/stroke-dasharray="5 4"/);assert.match(html,/195\.17391304347825,66\.66666666666667/,'created series keeps its existing coordinates');assert.equal(JSON.stringify(c.L),before);
 const money=modelFrom(c.draw(true,'charge'));assert.equal(money.series[1].points[5],900.5);assert.equal(money.series[1].currency,'INR');assert.equal(money.series[1].money,true);
 c.L.queryPlatforms.push({id:'unread-platform'});const partial=modelFrom(c.draw(false,'charge'));assert.match(partial.series[0].coverage,/1 \/ 2 平台.*来源不完整/);assert.equal(partial.series[0].points[6],null);
 const unavailable=actualChart({successUnavailable:true});const u=modelFrom(unavailable.draw(false,'withdraw'));assert.equal(u.series[1].plotted,false);assert.equal(u.series[1].points[5],null);assert.match(u.series[1].unavailable,/尚未接入有效成功时间/);
 const time=modelFrom(c.drawTime([row()]));assert.equal(time.series.length,2);assert.equal(time.series[1].points[5],180);
});

test('provider-only empty hourly arrays are unrequested; lazy full snapshots confirm genuine zero hours',()=>{
 const p={id:'synthetic-platform'},c=actualChart({loadedView:'providers',results:[{platform:p,groups:{hourly:[]}}],comparisonResults:[{platform:p,groups:{hourly:[]}}]});
 const unloaded=modelFrom(c.draw(false,'charge'));assert.equal(unloaded.series[0].complete,false);assert.equal(unloaded.series[0].points[0],null);assert.match(unloaded.series[0].coverage,/0 \/ 1 平台.*来源不完整/);assert.equal(unloaded.series[2].points[0],null);
 // overviewAnalysisRender temporarily replaces L.results by this full analysis array.
 const results=[{platform:p,groups:{hourly:[]}}];c.L.overviewSections={done:1,total:1,status:'ready',results};c.L.results=results;
 const full=modelFrom(c.draw(false,'charge'));assert.equal(full.series[0].complete,true);assert.equal(full.series[0].points[0],0);assert.equal(full.series[2].points[0],null,'provider-only comparison remains unrequested');
 c.L.queryPlatforms.push({id:'failed-platform'});c.L.overviewSections.status='partial';const partial=modelFrom(c.draw(false,'charge'));assert.equal(partial.series[0].points[0],null);assert.match(partial.series[0].coverage,/1 \/ 2/);
 const filledDisplay=[row({hour:0,all_count:0,success_count:0})];const time=modelFrom(c.drawTime(filledDisplay));assert.equal(time.series[0].points[0],null,'time page default display zeros are not source observations');
});

test('a current full view never turns an unread previous hourly dimension into a zero or a dashed line',()=>{
 const p={id:'synthetic-platform'};
 for(const metadata of [{},{_aggregateView:'providers'}]){
  const c=actualChart({loadedView:'full',comparisonResults:[{platform:p,...metadata,groups:{provider:[row()],hourly:[]}}]});
  for(const money of [false,true]){
   const html=c.draw(money,'charge'),model=modelFrom(html),previous=model.series[2];
   assert.equal(model.series[0].complete,true);assert.equal(model.series[0].points[0],0);
   assert.equal(previous.complete,false);assert.equal(previous.plotted,false);assert(previous.points.every(v=>v===null));
   assert.match(previous.coverage,/前期已读 0 \/ 1 平台.*来源不完整/);assert.doesNotMatch(html,/stroke-dasharray/);
   assert.match(c.HensemLiveChart.tooltip({series:[previous]},0),/该小时未读取 \/ 来源不完整/);
  }
 }
});

test('previous full empty-hour coverage means genuine zeros; incomplete previous reads keep missing hours unknown',()=>{
 const p={id:'synthetic-platform'},c=actualChart({comparisonResults:[{platform:p,_aggregateView:'full',groups:{hourly:[]}}]});
 const fullHtml=c.draw(false,'charge'),full=modelFrom(fullHtml).series[2];
 assert.equal(full.complete,true);assert.equal(full.plotted,true);assert(full.points.every(v=>v===0));assert.match(fullHtml,/stroke-dasharray="5 4"/);
 assert.match(c.HensemLiveChart.tooltip({series:[full]},0),/>0 笔/);
 c.L.queryPlatforms.push({id:'unread-platform'});c.L.comparisonResults[0].groups.hourly=[row({all_count:80})];
 const partialHtml=c.draw(false,'charge'),partial=modelFrom(partialHtml).series[2];
 assert.equal(partial.complete,false);assert.equal(partial.points[5],80);assert.equal(partial.points[6],null);assert.match(partial.coverage,/前期已读 1 \/ 2 平台.*来源不完整/);
 assert.match(partialHtml,/stroke-dasharray="5 4" points="195\.17391304347825,/,'a loaded partial point keeps its comparison styling');
});

function actualAggregateRead(){
 const live=fs.readFileSync(path.join(root,'admin-preview/live-data.js'),'utf8'),ast=ts.createSourceFile('live-data.js',live,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions=[],variables=[];
 const wantedFunctions=new Set(['query','aggregateView','aggregateScopeKey','cachedAggregate','rememberAggregate','readAggregate','mergeParts','combine','plus']),wantedVariables=new Set(['countKeys','amountKeys','empty','aggregateCache']);
 function walk(n){if(ts.isFunctionDeclaration(n)&&wantedFunctions.has(n.name?.text))functions.push(n.getText(ast));if(ts.isVariableDeclaration(n)&&wantedVariables.has(n.name.getText(ast)))variables.push('const '+n.getText(ast)+';');ts.forEachChild(n,walk)}walk(ast);assert.equal(functions.length,9);assert.equal(variables.length,4);
 const p={id:'synthetic-platform',timezone:'UTC',currency:'INR'},calls=[],L={serial:1,catalog:[p],country:'IN',direction:'charge',status:'all',from:'2026-09-29T00:00:00',to:'2026-09-30T23:59:59',queryNow:0,page:1,size:20};
 const c={L,state:{page:'overview'},calls,normalizePageDirection(){},aggregateMode:()=> 'full',providerDirection:()=>null,isFlowPage:()=>false,orderSource:()=> 'ar',displayIdentity:p=>p,activeValues:()=>[],instant:v=>v+'Z',HensemLiveCompare:{windowFor:()=>({valid:true,calendarDays:2,currentFrom:'2026-09-29T00:00:00',currentTo:'2026-09-30T23:59:59',previousFrom:'2026-09-27T00:00:00',previousTo:'2026-09-28T23:59:59'})}};
 c.window=c;c.hensemLiveRequest=async q=>{calls.push({...q});return {platform:p,total:0,summary:[],groups:q.view==='providers'?{provider:[]}:{provider:[],hourly:[]}}};
 vm.runInNewContext(variables.join('\n')+'\n'+functions.join('\n')+'\nwindow.buildQuery=query;window.read=readAggregate;',c);return c;
}

test('actual previous query and split reads preserve their dimension mode while a cached full snapshot stays full',async()=>{
 const c=actualAggregateRead(),p=c.L.catalog[0],request=c.buildQuery(p,'aggregate',true);
 assert.equal(request.view,'providers','the previous period intentionally requests totals without hourly data');
 const provider=await c.read({...request,startAt:'2026-09-27T00:00:00Z',endAt:'2026-09-29T00:00:00Z'},1);
 assert.equal(c.calls.length,2);assert.equal(provider._aggregateView,'providers');assert.equal(provider.groups.hourly.length,0,'split merge creates empty dimension arrays even when not requested');
 const current=actualChart({comparisonResults:[provider]}),previous=modelFrom(current.draw(false,'charge')).series[2];assert.equal(previous.complete,false);assert(previous.points.every(v=>v===null));
 const fullRequest={...request,startAt:'2026-09-25T00:00:00Z',endAt:'2026-09-27T00:00:00Z'};delete fullRequest.view;
 const full=await c.read(fullRequest,1);assert.equal(full._aggregateView,'full');const reads=c.calls.length;
 const cached=await c.read({...fullRequest,view:'providers'},1,true);assert.equal(c.calls.length,reads,'coverage tracking causes no extra request');assert.equal(cached._aggregateView,'full','reusing a full payload does not downgrade its dimension evidence');
 current.L.comparisonResults=[cached];const zero=modelFrom(current.draw(false,'charge')).series[2];assert.equal(zero.complete,true);assert(zero.points.every(v=>v===0));
});
