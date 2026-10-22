/* Separate, authorized lifecycle evidence. Never changes native or financial DTOs. */
(function(root){
 'use strict';
 const day=value=>{const s=String(value||'').slice(0,10),t=Date.parse(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null;};
 const native=(p,e)=>p?.id===e?.targetId&&['source','sourceName','scopeGroup','country','currency','timezone'].every(k=>typeof p[k]==='string'&&p[k]===e[k]);
 const localDay=(value,zone)=>{const time=Date.parse(value);if(!Number.isFinite(time))return null;try{return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));}catch{return null;}};
 function create({authority}){
  let bound=null,revision='',items=[];
  function replace(catalog){
   bound=authority();revision='';items=[];
   const m=catalog?.platformLifecycle,platforms=catalog?.platforms;
   if(!m||m.version!==1||typeof m.revision!=='string'||!/^[a-f0-9]{32}$/.test(m.revision)||!Array.isArray(m.items)||m.items.length>32||!Array.isArray(platforms))return;
   const seen=new Set();
   for(const item of m.items){
    if(!item||seen.has(item.targetId)||item.evidenceKind!=='user_confirmed_not_operating'||!day(item.confirmedFrom)||!day(item.confirmedThrough)||!day(item.operatingFrom)||item.confirmedFrom>item.confirmedThrough||Date.parse(item.operatingFrom)-Date.parse(item.confirmedThrough)!==86400000||!platforms.some(p=>native(p,item))){items=[];return;}
    seen.add(item.targetId);items.push(Object.freeze({...item}));
   }
   revision=m.revision;
  }
  function evidence(p){if(bound!==authority())return null;return items.find(e=>native(p,e))||null;}
  function range(p,from,to,successFrom,successTo){
   const e=evidence(p),a=day(from),b=day(to);if(!e||!a||!b||a>b)return null;
   const within=(x,y)=>!!x&&!!y&&x<=y&&x>=e.confirmedFrom&&y<=e.confirmedThrough;
   const creationNotOperating=within(a,b),hasSecondary=!!successFrom||!!successTo;
   const notOperating=creationNotOperating&&(!hasSecondary||within(day(successFrom),day(successTo)));
   const intersects=a<=e.confirmedThrough&&b>=e.confirmedFrom;
   if(!intersects)return null;
   return {targetId:p.id,notOperating,creationNotOperating,confirmedFrom:e.confirmedFrom,confirmedThrough:e.confirmedThrough,operatingFrom:e.operatingFrom,label:notOperating?'未营业':'含已确认未营业日期',note:'用户已确认 '+e.confirmedFrom+' 至 '+e.confirmedThrough+' 未营业；营业起始 '+e.operatingFrom+'。未营业不代表已核验的零订单。'};
  }
  function request(p,q){
   if(!q||q.platformId!==p?.id||!Number.isFinite(Date.parse(q.startAt))||!Number.isFinite(Date.parse(q.endAt))||Date.parse(q.endAt)<=Date.parse(q.startAt))return null;
   const a=localDay(q.startAt,p.timezone),b=localDay(new Date(Date.parse(q.endAt)-1).toISOString(),p.timezone);
   const separate=q.successBasis!=='created';
   if(separate&&(!q.successStartAt||!q.successEndAt||!Number.isFinite(Date.parse(q.successStartAt))||!Number.isFinite(Date.parse(q.successEndAt))||Date.parse(q.successEndAt)<=Date.parse(q.successStartAt)))return null;
   return range(p,a,b,separate?localDay(q.successStartAt,p.timezone):null,separate?localDay(new Date(Date.parse(q.successEndAt)-1).toISOString(),p.timezone):null);
  }
  return {replace,evidence,range,request,revision:()=>bound===authority()?revision:''};
 }
 root.HensemPlatformLifecycle={create};
})(typeof window==='undefined'?globalThis:window);
