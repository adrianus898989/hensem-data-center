/* With explicit success dates, count creations in their selected window and
   successes in theirs. The two windows share the same matrix dimension. */
(function(root){
  'use strict';
  const equalInstant = (a,b) => typeof a === 'string' && typeof b === 'string' &&
    Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
  const validWindow = (from,to) => typeof from === 'string' && typeof to === 'string' &&
    Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) && Date.parse(from) < Date.parse(to);

  function plan(query, matrixRequest) {
    if (query.successBasis === 'source_updated') throw Error('分组统计尚未提供源更新时间口径。');
    if (query.successBasis !== 'success') return [matrixRequest(query)];
    const {startAt,endAt,successStartAt,successEndAt} = query;
    if (!validWindow(startAt,endAt) || !validWindow(successStartAt,successEndAt))
      throw Error('创建时间或成功时间范围不完整。');
    if (equalInstant(startAt,successStartAt) && equalInstant(endAt,successEndAt)) return [matrixRequest(query)];
    const {successBasis,successStartAt:successFrom,successEndAt:successTo,...filters} = query;
    return [matrixRequest(filters),matrixRequest({...filters,startAt:successFrom,endAt:successTo})];
  }

  function mismatch() { throw Error('分组统计与当前筛选的成功或创建笔数未对齐，请重新查询。'); }
  function count(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' ||
        !Number.isSafeInteger(Number(value)) || Number(value) < 0) mismatch();
    return Number(value);
  }
  const hourly={marker:'providerHourMatrix',group:'hourly',cross:'provider_hour',field:'hour'};
  const amount={marker:'providerAmountMatrix',group:'amount_range',cross:'provider_amount_range',field:'bucket'};
  const shape=query=>query.providerAmountMatrix===true?amount:hourly;
  const sameBands=(a,b)=>!!a&&!!b&&['charge','withdraw'].every(direction=>
    JSON.stringify(a[direction])===JSON.stringify(b[direction]));
  function keyOf(row,dimension) {
    const key=[row.direction,row.currency];
    if (dimension === 'hourly' || dimension === 'provider_hour') {
      const hour=count(row.hour);
      if (hour >= 24) mismatch();
      key.push(hour);
    }
    if (dimension === 'amount_range' || dimension === 'provider_amount_range') {
      if (typeof row.bucket!=='string' || !/^(band:[0-9]|below|above|unknown)$/.test(row.bucket)) mismatch();
      key.push(row.bucket);
    }
    if (dimension === 'provider_hour' || dimension === 'provider_amount_range') {
      if (typeof row.provider !== 'string' && row.provider != null) mismatch();
      key.push(row.provider ?? null);
    }
    return JSON.stringify(key);
  }
  const rateFields=['all_count','success_count'];
  const createdFields=[...rateFields,'created_success_count'];
  function index(rows, dimension, scope, fields=rateFields) {
    if (!Array.isArray(rows)) mismatch();
    const cells = new Map();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !['charge','withdraw'].includes(row.direction) ||
          typeof row.currency !== 'string') mismatch();
      if (row.currency !== scope.currency || scope.direction !== 'all' && row.direction !== scope.direction) mismatch();
      const key=keyOf(row,dimension);
      if (cells.has(key)) mismatch();
      const metrics=Object.fromEntries(fields.map(field=>[field,count(row[field])]));
      if (fields===createdFields && (metrics.created_success_count!==metrics.success_count ||
          metrics.success_count>metrics.all_count)) mismatch();
      cells.set(key,metrics);
    }
    return cells;
  }
  const empty = () => ({all_count:0,success_count:0,created_success_count:0});
  function fold(cells, length, fields=rateFields) {
    const totals=new Map();
    for (const [key,row] of cells) {
      const group=JSON.stringify(JSON.parse(key).slice(0,length));
      const total=totals.get(group)||empty();
      for (const field of fields) total[field]=count(total[field]+row[field]);
      totals.set(group,total);
    }
    return totals;
  }
  function verifyCounts(left,right,fields=rateFields) {
    for (const key of new Set([...left.keys(),...right.keys()])) {
      const a=left.get(key)||empty(), b=right.get(key)||empty();
      if (fields.some(field=>a[field]!==b[field])) mismatch();
    }
  }
  function leg(result,scope,startAt,endAt,created=false) {
    const dim=shape(scope);
    if (!result || result.platform?.id!==scope.platformId || result[dim.marker]!==true ||
        (dim===amount && !sameBands(result.amountBands,scope.amountBands)) ||
        result.complete!==true || result.hasMore!==false || (result.successBasis??null)!==(created?'created':null) ||
        !equalInstant(result.startAt,startAt) || !equalInstant(result.endAt,endAt)) mismatch();
    const fields=created?createdFields:rateFields;
    const summary=index(result.summary,'summary',scope,fields);
    const buckets=index(result.groups?.[dim.group],dim.group,scope,fields);
    const providers=index(result.groups?.[dim.cross],dim.cross,scope,fields);
    verifyCounts(fold(providers,3,fields),buckets,fields);
    verifyCounts(fold(buckets,2,fields),summary,fields);
    return {summary,buckets,providers};
  }
  function join(created,success,dimension,dim) {
    return [...new Set([...created.keys(),...success.keys()])].map(key=>{
      const [direction,currency,slot,provider]=JSON.parse(key);
      return {direction,currency,...(dimension==='summary'?{}:{[dim.field]:slot}),
        ...(dimension===dim.cross?{provider}:{}),
        all_count:created.get(key)?.all_count??0,success_count:success.get(key)?.success_count??0};
    }).filter(row=>row.all_count>0 || row.success_count>0);
  }
  function combine(query, main, createdResult, successResult) {
    if (!main || main.platform?.id!==query.platformId || main.complete===false ||
        main.pandaCoverage?.reason==='verified_created_prefix_only' || main.successBasis!=='success' ||
        !equalInstant(main.startAt,query.startAt) || !equalInstant(main.endAt,query.endAt) ||
        !equalInstant(main.successStartAt,query.successStartAt) || !equalInstant(main.successEndAt,query.successEndAt) ||
        query.successBasis!=='success' || !['all','charge','withdraw'].includes(query.direction) || !query.currency) mismatch();
    const dim=shape(query);
    const a=leg(createdResult,query,query.startAt,query.endAt);
    const b=leg(successResult,query,query.successStartAt,query.successEndAt);
    const mainSummary=index(main.summary,'summary',query);
    verifyCounts(a.summary,mainSummary,['all_count']);
    verifyCounts(b.summary,mainSummary,['success_count']);
    return {platform:main.platform,capabilities:main.capabilities,complete:true,hasMore:false,
      startAt:query.startAt,endAt:query.endAt,successStartAt:query.successStartAt,successEndAt:query.successEndAt,
      successBasis:'success',[dim.marker]:true,...(dim===amount?{amountBands:query.amountBands}:{}),total:[...mainSummary.values()].reduce((n,r)=>count(n+r.all_count),0),
      summary:join(a.summary,b.summary,'summary',dim),
      groups:{[dim.group]:join(a.buckets,b.buckets,dim.group,dim),[dim.cross]:join(a.providers,b.providers,dim.cross,dim)}};
  }
  const hourMs=3600000;
  function closedIndiaDay(query, main, platform, now=Date.now()) {
    const start=Date.parse(query.startAt),end=Date.parse(query.endAt);
    // Indian midnight is 18:30 UTC on the preceding date. The RPC end is exclusive.
    if (query.successBasis!=='created' || query.successStartAt!==undefined || query.successEndAt!==undefined ||
        query.status!=='all' || query.currency!=='INR' || platform.timezone!=='Asia/Kolkata' ||
        end-start!==24*hourMs || start%(24*hourMs)!==18.5*hourMs || end>now ||
        !main || main.platform?.id!==platform.id || query.platformId!==platform.id ||
        (main.complete!==true && main._preparedPublication?.status!=='ready') ||
        main.complete===false || main.partial===true || main.available===false || main.error ||
        main.coverage?.calculationComplete===false || main.pandaCoverage?.reason==='verified_created_prefix_only' ||
        main.successBasis!=='created' || main.successStartAt!=null || main.successEndAt!=null ||
        !equalInstant(main.startAt,query.startAt) || !equalInstant(main.endAt,query.endAt) ||
        !Array.isArray(main.summary) || (!main.summary.length && main.total!==0 && main.total!=='0')) return null;
    return [0,6,12,18].map(hour=>({...query,
      startAt:new Date(start+hour*hourMs).toISOString(),endAt:new Date(start+(hour+6)*hourMs).toISOString()}));
  }
  function combineCreatedDay(query,main,parts,{platform=main?.platform,readAt=Date.now()}={}) {
    const windows=closedIndiaDay(query,main,platform,readAt);
    if (!windows || parts.length!==windows.length) mismatch();
    const dim=shape(query),providers=new Map(),buckets=new Map(),summaries=new Map(),providerSummary=new Map();
    const liveAmount=dim===amount&&createdAmountWindow(query,platform,readAt),readWindows=[];
    let total=0;
    function accumulate(target,values) {
      for (const [key,metrics] of values) {
        const prior=target.get(key)||empty();
        for (const field of createdFields) prior[field]=count(prior[field]+metrics[field]);
        target.set(key,prior);
      }
    }
    for (const [i,part] of parts.entries()) {
      const w=windows[i],group=leg(part,query,w.startAt,w.endAt,true);
      if (liveAmount) {
        // Each disjoint slice is its own current-status database read. Check its
        // native identity, total and all four groupings before combining it.
        const checked=verifyAmount(w,part,part,{platform,
          readAt:Number.isFinite(part._matrixReceivedAt)?part._matrixReceivedAt:readAt});
        if(!Number.isFinite(checked._matrixReadAt))mismatch();
        readWindows.push({startAt:w.startAt,endAt:w.endAt,readAt:checked._matrixReadAt});
        total=count(total+count(part.total));
        accumulate(summaries,group.summary);
        accumulate(providerSummary,providerTotals(part.groups.provider,platform.country,w,createdFields));
      } else if (dim===hourly) {
        // Native local hours cannot occur in more than one six-hour slice.
        for(const key of [...group.buckets.keys(),...group.providers.keys()]){
          const hour=JSON.parse(key)[2];
          if(hour<i*6||hour>=(i+1)*6)mismatch();
        }
      }
      accumulate(buckets,group.buckets);
      accumulate(providers,group.providers);
    }
    const published=liveAmount?summaries:index(main.summary,'summary',query,createdFields);
    verifyCounts(fold(buckets,2,createdFields),published,createdFields);
    if (!liveAmount&&Array.isArray(main.groups?.[dim.group]))
      verifyCounts(buckets,index(main.groups[dim.group],dim.group,query,createdFields),createdFields);
    function rows(cells,withProvider) {
      return [...cells].map(([key,metrics])=>{
        const [direction,currency,slot,provider]=JSON.parse(key);
        return {direction,currency,[dim.field]:slot,...(withProvider?{provider}:{}),...metrics};
      });
    }
    const summaryRows=cells=>[...cells].map(([key,metrics])=>{
      const [direction,currency,provider]=JSON.parse(key);
      return {direction,currency,...(provider===undefined?{}:{provider}),...metrics};
    });
    const result={platform:main.platform,capabilities:main.capabilities,complete:true,hasMore:false,
      [dim.marker]:true,...(dim===amount?{amountBands:query.amountBands}:{}),
      startAt:query.startAt,endAt:query.endAt,successBasis:'created',
      total:[...published.values()].reduce((n,r)=>count(n+r.all_count),0),
      summary:liveAmount?summaryRows(published):main.summary,
      groups:{[dim.group]:rows(buckets,false),[dim.cross]:rows(providers,true)}};
    if(liveAmount){
      if(result.total!==total)mismatch();
      result.groups.provider=summaryRows(providerSummary);
      result._matrixReadWindows=readWindows;
      result.asOf=new Date(Math.max(...readWindows.map(r=>r.readAt))).toISOString();
    }
    return result;
  }
  function providerTotals(rows,country,scope,fields=rateFields) {
    // Main-page results may contain multiple raw names for one displayed provider.
    const totals=new Map();
    for(const row of rows){
      if(typeof row.provider!=='string'&&row.provider!=null) mismatch();
      if(!['charge','withdraw'].includes(row.direction) || row.currency!==scope.currency ||
         scope.direction!=='all'&&row.direction!==scope.direction) mismatch();
      const name=String(root.HensemProviderNames?.canonical(row.provider,country)??row.provider??'').trim();
      const key=JSON.stringify([row.direction,row.currency,name]),total=totals.get(key)||empty();
      for(const field of fields)total[field]=count(total[field]+count(row[field]));
      if(fields===createdFields && (count(row.created_success_count)!==count(row.success_count) ||
          count(row.success_count)>count(row.all_count))) mismatch();
      totals.set(key,total);
    }
    return totals;
  }
  function availableAmountDirections(query,main,parts,available){
    const wanted=query.direction==='all'?['charge','withdraw']:[query.direction];
    const directions=wanted.filter(d=>[main,...parts].every(r=>available(r,d)!==false));
    if(!directions.length)throw Error('本范围未提供可核验的成功时间。');
    if(directions.length===wanted.length)return {query,main,parts,directions};
    // An event-clock source can support collections while masking payouts. Only
    // its explicitly unavailable direction may be dropped from these controls.
    const direction=directions[0],excluded=wanted.find(d=>d!==direction);
    function project(r){
      const rows=list=>Array.isArray(list)?list.filter(row=>row?.direction!==excluded):list;
      const summary=rows(r.summary);
      return {...r,summary,...(Array.isArray(summary)&&!summary.length&&r.summary.length?{total:0}:{}),
        groups:Object.fromEntries(Object.entries(r.groups??{}).map(([key,list])=>[key,rows(list)]))};
    }
    return {query:{...query,direction},main:project(main),parts:parts.map(project),directions};
  }
  function createdAmountWindow(query,platform,readAt) {
    if(!Number.isFinite(readAt)||!platform?.timezone||platform.id!==query.platformId||
        query.providerAmountMatrix!==true||query.status!=='all'||query.direction!=='all'||
        query.successBasis!=='created'||query.successStartAt!==undefined||query.successEndAt!==undefined||
        !validWindow(query.startAt,query.endAt))return false;
    const start=Date.parse(query.startAt),end=Date.parse(query.endAt);
    if(start>readAt)return false;
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:platform.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
    return end<=readAt||day.format(end-1)===day.format(readAt);
  }
  function incomplete(r) {
    return !r||r.complete===false||r.hasMore===true||r.partial||r.available===false||r.error||
      r.meta?.partial===true||r.coverage?.calculationComplete===false||
      r.coverage?.complete===false&&r.coverage?.calculationComplete!==true||
      r.pandaCoverage?.reason==='verified_created_prefix_only';
  }
  function verifyAmount(query,main,result,{platform,readAt}={}) {
    const created=query.successBasis==='created',fields=created?createdFields:rateFields;
    // After independent legs have been joined the numerators and denominators
    // belong to different cohorts. Counts in each bucket must match the main page.
    const groups=result.groups;
    const summary=index(result.summary,'summary',query,fields);
    const buckets=index(groups?.amount_range,'amount_range',query,fields);
    const providers=index(groups?.provider_amount_range,'provider_amount_range',query,fields);
    verifyCounts(fold(providers,3,fields),buckets,fields);
    verifyCounts(fold(buckets,2,fields),summary,fields);
    if (incomplete(main)||incomplete(result)||main.platform?.id!==query.platformId||
        (main._parts&&(!Array.isArray(main._parts)||!main._parts.length||main._parts.some(incomplete)))||
        !equalInstant(main.startAt,query.startAt) || !equalInstant(main.endAt,query.endAt) ||
        (main.successBasis??null)!==(query.successBasis??null) ||
        (query.successBasis==='success' && (!equalInstant(main.successStartAt,query.successStartAt) ||
          !equalInstant(main.successEndAt,query.successEndAt))) ||
        !sameBands(result.amountBands,query.amountBands)||
        (main.amountBands||main.groups?.amount_range)&&!sameBands(main.amountBands,query.amountBands)) mismatch();
    const mainSummary=index(main.summary,'summary',query);
    if(createdAmountWindow(query,platform,readAt)){
      // Current stored status and its provider attribution can change after a
      // creation day closes. Validate this read independently: each native RPC
      // produces its totals and all four groupings together. Timeout recovery
      // checks each disjoint slice before adding the separately read results.
      if(result.platform?.id!==platform.id||result.providerAmountMatrix!==true||
          result.complete!==true||result.hasMore!==false||result.successBasis!=='created'||
          result.successStartAt!=null||result.successEndAt!=null||
          !equalInstant(result.startAt,query.startAt)||!equalInstant(result.endAt,query.endAt)||
          main.successStartAt!=null||main.successEndAt!=null||!Array.isArray(groups.provider))mismatch();
      if(main._preparedResultGroups&&main._preparedResultGroups.profile!=='amount-v1')mismatch();
      for(const part of main._parts||[main]){
        if(part.platform?.id!==platform.id||part.successBasis!=='created'||part.successStartAt!=null||
            part.successEndAt!=null||part.coverage?.complete===false&&part.coverage?.calculationComplete!==true||
            (part.amountBands||part.groups?.amount_range)&&!sameBands(part.amountBands,query.amountBands))mismatch();
      }
      for(const key of ['source','sourceName','currency','country','timezone']){
        if([main.platform,result.platform].some(p=>p[key]&&platform[key]&&p[key]!==platform[key]))mismatch();
      }
      if(Array.isArray(main.groups?.amount_range))
        verifyCounts(fold(index(main.groups.amount_range,'amount_range',query),2),mainSummary);
      if(Array.isArray(main.groups?.provider))
        verifyCounts(fold(providerTotals(main.groups.provider,platform.country,query),2),mainSummary);
      const country=platform.country,summaryCount=[...summary.values()].reduce((n,r)=>count(n+r.all_count),0);
      if(count(result.total)!==summaryCount)mismatch();
      verifyCounts(providerTotals(groups.provider,country,query,fields),
        providerTotals(groups.provider_amount_range,country,query,fields),fields);
      const asOf=Date.parse(result.asOf);
      return {...result,_matrixReadAt:Number.isFinite(asOf)?asOf:readAt};
    }
    verifyCounts(mainSummary,summary);
    if (Array.isArray(main.groups?.amount_range)) {
      verifyCounts(index(main.groups.amount_range,'amount_range',query),buckets);
    }
    if(Array.isArray(main.groups?.provider)){
      const country=main.platform.country;
      verifyCounts(providerTotals(main.groups.provider,country,query),providerTotals(groups.provider_amount_range,country,query));
    }
    return result;
  }
  root.HensemHourlyRateWindows={plan,combine,closedIndiaDay,combineCreatedDay,availableAmountDirections,verifyAmount,sameBands};
})(typeof window==='undefined'?globalThis:window);
