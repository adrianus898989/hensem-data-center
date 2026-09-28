/* One scope-wide set of amount boundaries; grouping is performed on source orders. */
(function(root){
 'use strict';
 const defaults={
 INR:{charge:[100,200,300,500,1000,2000,5000,10000,20000,30000,50000]},
 IDR:{charge:[20000,50000,100000,200000,500000,1000000,2000000,5000000,10000000,20000000,50000000],withdraw:[50000,100000,200000,500000,1000000,5000000,10000000,50000000,100000000,500000000,1000000000]},
 BRL:{charge:[5,10,20,50,100,200,500,1000,5000,10000,50000],withdraw:[10,20,50,100,200,500,1000,2000,5000,10000,15000]},
 PKR:{charge:[100,300,500,1000,2000,5000,10000,20000,30000,40000,50000],withdraw:[200,500,1000,2000,5000,10000,15000,20000,30000,40000,50000]},
 VND:{charge:[50000,100000,200000,500000,1000000,2000000,5000000,10000000,50000000,100000000,300000000],withdraw:[100000,200000,500000,1000000,2000000,5000000,10000000,20000000,50000000,100000000,200000000]},
 COP:{charge:[20000,50000,100000,200000,300000,500000,750000,1000000,1250000,1500000,2000000],withdraw:[30000,50000,100000,200000,500000,1000000,2000000,3000000,5000000,7500000,10000000]},
 MXN:{charge:[100,200,300,500,1000,2000,5000,10000,20000,30000,50000]},
 CLP:{charge:[5000,10000,20000,50000,100000,200000,500000,1000000,2000000,3000000,5000000],withdraw:[8000,20000,50000,100000,200000,500000,1000000,2000000,4000000,6000000,8000000]}
 };
 // Countries without confirmed limits retain an explicitly labelled analysis scale.
 const analysisScales={NGN:[100,500,1000,2000,5000,10000,20000,50000,100000,500000,1000000],PHP:[1,10,50,100,200,500,1000,5000,10000,50000,100000]};
 const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
 const valid=edges=>Array.isArray(edges)&&edges.length===11&&edges.every((n,i)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e15&&(!i||n>edges[i-1]));
 function number(value){
  let s=String(value).trim().toLowerCase(),factor=1;
  const suffix=s.match(/(k|m|b|w|万|亿)$/);if(suffix){factor=({k:1e3,m:1e6,b:1e9,w:1e4,'万':1e4,'亿':1e8})[suffix[1]];s=s.slice(0,-suffix[1].length)}
  if(/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s))s=s.replaceAll(',','');
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replaceAll('.','');
  if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s)*factor;return Number.isFinite(n)&&n<=1e15?n:null;
 }
 function parseLimit(value,currency){
  let s=String(value??'').trim();if(!s)return null;
  const codes=s.match(/\b(?:IDR|INR|BRL|PKR|VND|COP|MXN|CLP|NGN|PHP|BDT|USD|USDT)\b/gi)||[];
  if(codes.some(code=>code.toUpperCase()!==currency))return null;
  s=s.replace(/\b(?:IDR|INR|BRL|PKR|VND|COP|MXN|CLP|NGN|PHP|BDT|USD|USDT)\b/gi,'').replace(/\(\s*\)/g,'').trim();
  const match=s.match(/^([\d.,]+\s*(?:[kmbw]|万|亿)?)\s*(?:-|–|—|~|～|至)\s*([\d.,]+\s*(?:[kmbw]|万|亿)?)$/i);if(!match)return null;
  const min=number(match[1].replace(/\s/g,'')),max=number(match[2].replace(/\s/g,''));return min!==null&&max!==null&&min>=0&&max>min?[min,max]:null;
 }
 function rescale(base,min,max){
  if(min===base[0]&&max===base[10])return base.slice();
  const interior=base.slice(1,-1).filter(n=>n>min&&n<max);
  // Preserve familiar anchors, then split the widest relative gap until there are ten bands.
  const edges=[min,...interior,max];
  while(edges.length<11){let idx=0,score=-1;for(let i=0;i<edges.length-1;i++){const width=Math.log1p(edges[i+1])-Math.log1p(edges[i]);if(width>score){score=width;idx=i}}
   const low=edges[idx],high=edges[idx+1],mid=low>0?Math.sqrt(low*high):(low+high)/2,unit=10**Math.max(-2,Math.floor(Math.log10(Math.max(mid,0.01)))-1),rounded=Math.round(mid/unit)*unit;
   const next=rounded>low&&rounded<high?rounded:(low+high)/2;edges.splice(idx+1,0,next);
  }
  return edges;
 }
 function profile({currency='INR',direction='charge',providers=[],limits=[]}={}){
  const preset=defaults[currency],base=(preset?.[direction]||preset?.charge||analysisScales[currency]||[0,10,50,100,200,500,1000,5000,10000,50000,100000]).slice();
  const parsed=limits.map(value=>parseLimit(value,currency)).filter(Boolean),complete=providers.length>0&&parsed.length>0;
  const min=complete?Math.min(...parsed.map(x=>x[0])):base[0],max=complete?Math.max(...parsed.map(x=>x[1])):base[10],edges=rescale(base,min,max);
  return {edges,source:complete?'所选三方限额':preset?'国家参考范围':'分析范围（限额未配置）',currency,direction,providerAdapted:complete};
 }
 function label(bucket,edges){
  if(bucket==='unknown')return '金额缺失';if(bucket==='other')return '其他金额';
  if(!valid(edges))return String(bucket);
  if(bucket==='below')return '< '+fmt(edges[0]);if(bucket==='above')return '> '+fmt(edges[10]);
  const match=String(bucket).match(/^band:([0-9])$/);if(!match)return String(bucket);const i=Number(match[1]);
  return fmt(edges[i])+(i===9?'–':'–< ')+fmt(edges[i+1]);
 }
 function keys(){return Array.from({length:10},(_,i)=>'band:'+i)}
 function rank(bucket,edges){if(bucket==='below')return -1;if(bucket==='above')return 11;if(bucket==='unknown'||bucket==='other')return 12;const m=String(bucket).match(/^band:([0-9])$/);return m?Number(m[1]):Number(String(bucket).replaceAll(',','').match(/\d+(?:\.\d+)?/)?.[0]||Infinity)}
 root.HensemAmountBands={profile,parseLimit,rescale,valid,label,keys,rank,defaults};
})(typeof window==='object'?window:globalThis);
