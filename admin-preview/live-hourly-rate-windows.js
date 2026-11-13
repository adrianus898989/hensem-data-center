/* With explicit success dates, count creations in their selected window and
   successes in theirs. Each source leg contains all 24 platform-local hours. */
(function(root){
  'use strict';
  const equalInstant = (a,b) => typeof a === 'string' && typeof b === 'string' &&
    Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
  const validWindow = (from,to) => typeof from === 'string' && typeof to === 'string' &&
    Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) && Date.parse(from) < Date.parse(to);

  function plan(query, matrixRequest) {
    if (query.successBasis === 'source_updated') throw Error('分时统计尚未提供源更新时间口径。');
    if (query.successBasis !== 'success') return [matrixRequest(query)];
    const {startAt,endAt,successStartAt,successEndAt} = query;
    if (!validWindow(startAt,endAt) || !validWindow(successStartAt,successEndAt))
      throw Error('创建时间或成功时间范围不完整。');
    if (equalInstant(startAt,successStartAt) && equalInstant(endAt,successEndAt)) return [matrixRequest(query)];
    const {successBasis,successStartAt:successFrom,successEndAt:successTo,...filters} = query;
    return [matrixRequest(filters),matrixRequest({...filters,startAt:successFrom,endAt:successTo})];
  }

  function mismatch() { throw Error('分时统计与当前筛选的成功或创建笔数未对齐，请重新查询。'); }
  function count(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' ||
        !Number.isSafeInteger(Number(value)) || Number(value) < 0) mismatch();
    return Number(value);
  }
  function keyOf(row,dimension) {
    const key=[row.direction,row.currency];
    if (dimension !== 'summary') {
      const hour=count(row.hour);
      if (hour >= 24) mismatch();
      key.push(hour);
    }
    if (dimension === 'provider_hour') {
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
    if (!result || result.platform?.id!==scope.platformId || result.providerHourMatrix!==true ||
        result.complete!==true || result.hasMore!==false || (result.successBasis??null)!==(created?'created':null) ||
        !equalInstant(result.startAt,startAt) || !equalInstant(result.endAt,endAt)) mismatch();
    const fields=created?createdFields:rateFields;
    const summary=index(result.summary,'summary',scope,fields);
    const hourly=index(result.groups?.hourly,'hourly',scope,fields);
    const providers=index(result.groups?.provider_hour,'provider_hour',scope,fields);
    verifyCounts(fold(providers,3,fields),hourly,fields);
    verifyCounts(fold(hourly,2,fields),summary,fields);
    return {summary,hourly,providers};
  }
  function join(created,success,dimension) {
    return [...new Set([...created.keys(),...success.keys()])].map(key=>{
      const [direction,currency,hour,provider]=JSON.parse(key);
      return {direction,currency,...(dimension==='summary'?{}:{hour}),
        ...(dimension==='provider_hour'?{provider}:{}),
        all_count:created.get(key)?.all_count??0,success_count:success.get(key)?.success_count??0};
    }).filter(row=>row.all_count>0 || row.success_count>0);
  }
  function combine(query, main, createdResult, successResult) {
    if (!main || main.platform?.id!==query.platformId || main.complete===false ||
        main.pandaCoverage?.reason==='verified_created_prefix_only' || main.successBasis!=='success' ||
        !equalInstant(main.startAt,query.startAt) || !equalInstant(main.endAt,query.endAt) ||
        !equalInstant(main.successStartAt,query.successStartAt) || !equalInstant(main.successEndAt,query.successEndAt) ||
        query.successBasis!=='success' || !['all','charge','withdraw'].includes(query.direction) || !query.currency) mismatch();
    const a=leg(createdResult,query,query.startAt,query.endAt);
    const b=leg(successResult,query,query.successStartAt,query.successEndAt);
    const mainSummary=index(main.summary,'summary',query);
    verifyCounts(a.summary,mainSummary,['all_count']);
    verifyCounts(b.summary,mainSummary,['success_count']);
    return {platform:main.platform,capabilities:main.capabilities,complete:true,hasMore:false,
      startAt:query.startAt,endAt:query.endAt,successStartAt:query.successStartAt,successEndAt:query.successEndAt,
      successBasis:'success',providerHourMatrix:true,total:[...mainSummary.values()].reduce((n,r)=>count(n+r.all_count),0),
      summary:join(a.summary,b.summary,'summary'),
      groups:{hourly:join(a.hourly,b.hourly,'hourly'),provider_hour:join(a.providers,b.providers,'provider_hour')}};
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
  function combineCreatedDay(query,main,parts) {
    const windows=closedIndiaDay(query,main,main.platform);
    if (!windows || parts.length!==windows.length) mismatch();
    const providers=[],hours=[];
    for (const [i,part] of parts.entries()) {
      const w=windows[i],group=leg(part,query,w.startAt,w.endAt,true);
      // These hours are the native local creation hours. Disjoint windows must
      // never supply two contributions for the same provider and hour.
      for (const key of [...group.hourly.keys(),...group.providers.keys()]) {
        const hour=JSON.parse(key)[2];
        if (hour<i*6 || hour>=(i+1)*6) mismatch();
      }
      providers.push(...part.groups.provider_hour);
      hours.push(...part.groups.hourly);
    }
    const hourly=index(hours,'hourly',query,createdFields);
    const published=index(main.summary,'summary',query,createdFields);
    verifyCounts(fold(hourly,2,createdFields),published,createdFields);
    if (Array.isArray(main.groups?.hourly))
      verifyCounts(hourly,index(main.groups.hourly,'hourly',query,createdFields),createdFields);
    return {platform:main.platform,capabilities:main.capabilities,complete:true,hasMore:false,
      providerHourMatrix:true,startAt:query.startAt,endAt:query.endAt,successBasis:'created',
      total:[...published.values()].reduce((n,r)=>count(n+r.all_count),0),
      summary:main.summary,groups:{hourly:hours,provider_hour:providers}};
  }
  root.HensemHourlyRateWindows={plan,combine,closedIndiaDay,combineCreatedDay};
})(typeof window==='undefined'?globalThis:window);
