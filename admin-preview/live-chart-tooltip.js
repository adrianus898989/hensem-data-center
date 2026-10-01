/* Hour inspection uses only the chart's authorized aggregate snapshot. */
(function(){
 'use strict';
 let serial=0;
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const known=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v));
 const color=v=>/^#[a-f\d]{6}$/i.test(String(v))?v:'#71829b';
 function series(input){
  const rows=Array.isArray(input.rows)?input.rows:[],currencies=[...new Set(rows.map(r=>r.currency).filter(Boolean))];
  const mixed=input.money&&currencies.length>1,unavailable=input.unavailable||'',complete=input.complete===true;
  const points=Array.from({length:24},(_,hour)=>{
   if(unavailable||mixed)return null;
   const selected=rows.filter(r=>known(r.hour)&&Number(r.hour)===hour);
   if(!selected.length)return complete?0:null;
   if(selected.some(r=>!known(r[input.key])))return null;
   return selected.reduce((sum,r)=>sum+Number(r[input.key]),0);
  });
  return {name:String(input.name||''),color:color(input.color),points,money:!!input.money,
   currency:input.money?(mixed?'多币种（不合计）':currencies[0]||(input.currency!=='all'?input.currency:'')||'币种未提供'):'',
   coverage:String(input.coverage||''),complete,plotted:input.plotted!==false,
   unavailable:unavailable||(mixed?'跨币种不合计':'')};
 }
 function enhance(svg,options){
  const id='live-chart-tip-'+(++serial),model={series:options.series||[],max:Math.max(1,Number(options.max)||1),range:String(options.range||''),note:String(options.note||'全部按创建小时；成功按成功小时；各平台当地时间')};
  const markers='<g data-chart-marker aria-hidden="true" style="display:none"><line data-chart-guide x1="43" x2="43" y1="15" y2="170"/>'+model.series.map((s,i)=>'<circle data-chart-dot="'+i+'" r="3.5" fill="'+color(s.color)+'"/>').join('')+'</g>';
  const image=svg.replace('</svg>',markers+'</svg>');
  return '<div class="live-chart-shell" tabindex="0" role="group" aria-label="'+escape(options.title||'24小时趋势')+'" aria-describedby="'+id+'-help" data-chart-model="'+escape(JSON.stringify(model))+'" onpointermove="HensemLiveChart.pointer(event,this)" onpointerdown="HensemLiveChart.pointer(event,this)" onpointerleave="HensemLiveChart.leave(event,this)" onpointercancel="HensemLiveChart.hide(this)" onfocus="HensemLiveChart.focus(this)" onblur="HensemLiveChart.hide(this)" onkeydown="HensemLiveChart.key(event,this)">'+image+'<span class="live-chart-help" id="'+id+'-help">鼠标靠近折线或触屏点选查看小时数据；左右键切换小时，Home / End 到首尾，Escape 关闭提示。</span><div class="live-chart-tooltip" id="'+id+'" role="tooltip" aria-live="polite" aria-atomic="true" hidden></div></div>';
 }
 function read(shell){try{const m=JSON.parse(shell.dataset.chartModel);return Array.isArray(m.series)?m:null}catch{return null}}
 function tooltip(model,hour){
  const label=String(hour).padStart(2,'0');
  return '<strong>'+label+':00–'+label+':59'+(model.range?' · '+escape(model.range):'')+'</strong>'+model.series.map(s=>{
   const v=s.points?.[hour],number=known(v)?Number(v).toLocaleString('en-US',s.money?{minimumFractionDigits:2,maximumFractionDigits:2}:{}):'—';
   const unit=s.money?' '+escape(s.currency):' 笔',reason=s.unavailable||(!known(v)?(s.complete?'该小时指标未提供':'该小时未读取 / 来源不完整'):'');
   return '<div class="live-chart-tip-series"><span><i style="background:'+color(s.color)+'"></i>'+escape(s.name)+'</span><b>'+number+(known(v)?unit:'')+'</b></div>'+(reason?'<small>'+escape(reason)+'</small>':'');
  }).join('')+'<div class="live-chart-tip-coverage">'+[...new Set(model.series.map(s=>s.coverage).filter(Boolean))].map(escape).join('<br>')+'</div><small>'+escape(model.note)+'</small>';
 }
 function show(shell,hour){
  const model=read(shell),tip=shell.querySelector('.live-chart-tooltip'),marker=shell.querySelector('[data-chart-marker]');
  if(!model||!tip||!Number.isInteger(hour)||hour<0||hour>23)return;
  shell.dataset.chartHour=String(hour);
  tip.innerHTML=tooltip(model,hour);tip.hidden=false;shell.setAttribute('aria-describedby',tip.id+'-help '+tip.id);
  const x=43+hour*700/23,svg=shell.querySelector('svg');
  if(marker){marker.style.display='';const guide=marker.querySelector('[data-chart-guide]');guide?.setAttribute('x1',String(x));guide?.setAttribute('x2',String(x));
   marker.querySelectorAll('[data-chart-dot]').forEach((dot,i)=>{const s=model.series[i],v=s?.points?.[hour];dot.style.display=s?.plotted&&known(v)?'':'none';dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(170-Number(v||0)/model.max*155))});}
  const bounds=svg?.getBoundingClientRect(),parent=shell.getBoundingClientRect(),width=tip.getBoundingClientRect().width;
  if(bounds){const scale=Math.min(bounds.width/760,bounds.height/210),anchor=bounds.left-parent.left+(bounds.width-760*scale)/2+x*scale;tip.style.left=Math.max(8,Math.min(anchor-width/2,parent.width-width-8))+'px';}
 }
 function hide(shell){const tip=shell?.querySelector('.live-chart-tooltip'),marker=shell?.querySelector('[data-chart-marker]');if(tip){tip.hidden=true;shell.setAttribute('aria-describedby',tip.id+'-help')}if(marker)marker.style.display='none';}
 function coordinates(event,svg){
  if(!known(event.clientX)||!known(event.clientY))return null;
  const rect=svg.getBoundingClientRect(),scale=Math.min(rect.width/760,rect.height/210);
  if(!(scale>0))return null;
  return {x:(Number(event.clientX)-rect.left-(rect.width-760*scale)/2)/scale,y:(Number(event.clientY)-rect.top-(rect.height-210*scale)/2)/scale};
 }
 function pointer(event,shell){
  const svg=shell.querySelector('svg'),p=svg&&coordinates(event,svg);
  if(!p||p.x<43||p.x>743||p.y<15||p.y>170){if(event.pointerType!=='touch')hide(shell);return;}
  const hour=Math.max(0,Math.min(23,Math.round((p.x-43)/700*23)));
  if(shell.dataset.chartHour!==String(hour)||shell.querySelector('.live-chart-tooltip')?.hidden)show(shell,hour);
 }
 function leave(event,shell){if(event.pointerType!=='touch'&&typeof document!=='undefined'&&document.activeElement!==shell)hide(shell);}
 function focus(shell){const old=Number(shell.dataset.chartHour);show(shell,Number.isInteger(old)&&old>=0&&old<=23?old:0);}
 function key(event,shell){
  const old=Number(shell.dataset.chartHour),hour=Number.isInteger(old)&&old>=0&&old<=23?old:0;
  if(event.key==='Escape'){event.preventDefault();hide(shell);return;}
  const next=event.key==='ArrowLeft'?Math.max(0,hour-1):event.key==='ArrowRight'?Math.min(23,hour+1):event.key==='Home'?0:event.key==='End'?23:null;
  if(next===null)return;event.preventDefault();show(shell,next);
 }
 window.HensemLiveChart={series,enhance,tooltip,pointer,leave,focus,key,hide};
 if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('pointerdown',event=>{
  document.querySelectorAll('.live-chart-shell').forEach(shell=>{if(!shell.contains(event.target))hide(shell)});
 });
})();
