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
  function index(rows, dimension, scope) {
    if (!Array.isArray(rows)) mismatch();
    const cells = new Map();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !['charge','withdraw'].includes(row.direction) ||
          typeof row.currency !== 'string') mismatch();
      if (row.currency !== scope.currency || scope.direction !== 'all' && row.direction !== scope.direction) mismatch();
      const key=keyOf(row,dimension);
      if (cells.has(key)) mismatch();
      cells.set(key,{all_count:count(row.all_count),success_count:count(row.success_count)});
    }
    return cells;
  }
  const empty = () => ({all_count:0,success_count:0});
  function fold(cells, length) {
    const totals=new Map();
    for (const [key,row] of cells) {
      const group=JSON.stringify(JSON.parse(key).slice(0,length));
      const total=totals.get(group)||empty();
      total.all_count=count(total.all_count + row.all_count);
      total.success_count=count(total.success_count + row.success_count);
      totals.set(group,total);
    }
    return totals;
  }
  function verifyCounts(left,right,fields=['all_count','success_count']) {
    for (const key of new Set([...left.keys(),...right.keys()])) {
      const a=left.get(key)||empty(), b=right.get(key)||empty();
      if (fields.some(field=>a[field]!==b[field])) mismatch();
    }
  }
  function leg(result,scope,startAt,endAt) {
    if (!result || result.platform?.id!==scope.platformId || result.providerHourMatrix!==true ||
        result.complete!==true || result.hasMore!==false || result.successBasis!=null ||
        !equalInstant(result.startAt,startAt) || !equalInstant(result.endAt,endAt)) mismatch();
    const summary=index(result.summary,'summary',scope);
    const hourly=index(result.groups?.hourly,'hourly',scope);
    const providers=index(result.groups?.provider_hour,'provider_hour',scope);
    verifyCounts(fold(providers,3),hourly);
    verifyCounts(fold(hourly,2),summary);
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
  root.HensemHourlyRateWindows={plan,combine};
})(typeof window==='undefined'?globalThis:window);
