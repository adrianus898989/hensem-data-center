import {orderTimeRequest,timeMetricKeys,type OrderTimeFilters,type OrderTimePayload,type OrderTimeRow} from "./orderTimeQuery";

export type OrderTimeBatchRequest=ReturnType<typeof orderTimeRequest>&{p_reference_start:string};
export type OrderTimeBatchProgress={completed:number;total:number;active:number};
export type OrderTimeBatchResult={id:string;payload:OrderTimePayload&{start:string;endExclusive:string}};
export type OrderTimeBatchOptions={
  signal?:AbortSignal;
  onProgress?:(progress:OrderTimeBatchProgress)=>void;
  /** Primarily useful for tests; production requests never exceed 45 seconds. */
  requestTimeoutMs?:number;
};
const DAY=86400_000,HOUR=3600_000,INDIA_OFFSET=330*60_000;

/** Disjoint half-open intervals, split on India midnight and business direction. */
export function planOrderTimeBatches(filters:OrderTimeFilters):OrderTimeBatchRequest[] {
  const original=orderTimeRequest(filters),end=Date.parse(original.p_end_at);
  const directions=filters.direction==="all"?["charge","withdraw"] as const:[filters.direction];
  const requests:OrderTimeBatchRequest[]=[];
  for(let start=Date.parse(original.p_start_at);start<end;){
    const nextMidnight=(Math.floor((start+INDIA_OFFSET)/DAY)+1)*DAY-INDIA_OFFSET;
    const stop=Math.min(end,nextMidnight);
    for(const direction of directions)requests.push({...original,p_direction:direction,
      p_start_at:new Date(start).toISOString(),p_end_at:new Date(stop).toISOString(),
      p_reference_start:original.p_start_at});
    start=stop;
  }
  return requests;
}

function abortError():Error {
  const error=new Error("查询已取消。");error.name="AbortError";return error;
}
function statementTimedOut(error:unknown):boolean {
  const value=error as {code?:string;status?:number;message?:string};
  // Never turn a permissions/validation error into repeated backend requests.
  if([401,403].includes(Number(value?.status))||/^(22|28)/.test(String(value?.code||""))||value?.code==="42501")return false;
  if(value?.code==="57014"||value?.code==="ORDER_TIME_NETWORK_TIMEOUT")return true;
  if([400,422].includes(Number(value?.status)))return false;
  return /statement\s+timeout|canceling statement due to statement timeout/i.test(String(value?.message||""));
}
function smallerRequests(request:OrderTimeBatchRequest):OrderTimeBatchRequest[]|null {
  const start=Date.parse(request.p_start_at),end=Date.parse(request.p_end_at),duration=end-start;
  if(duration<2*HOUR)return null;
  // Whole-hour cuts keep the smallest retry at one hour without fractional
  // seconds, gaps, or overlaps (e.g. a three-hour slice becomes one + two).
  const middle=start+Math.max(HOUR,Math.floor(duration/2/HOUR)*HOUR);
  return [{...request,p_end_at:new Date(middle).toISOString()},
    {...request,p_start_at:new Date(middle).toISOString()}];
}

async function fetchShard(request:OrderTimeBatchRequest,fetcher:(request:OrderTimeBatchRequest,signal:AbortSignal)=>Promise<OrderTimePayload>,signal:AbortSignal,timeoutMs:number):Promise<OrderTimePayload> {
  if(signal.aborted)throw abortError();
  const controller=new AbortController();let rejectAbort:(error:Error)=>void=()=>undefined;
  const cancelled=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{controller.abort();rejectAbort(abortError());};
  signal.addEventListener("abort",onAbort,{once:true});
  const timer=setTimeout(()=>{
    rejectAbort(Object.assign(new Error("订单时段读取超时，请缩短时间范围后重试。"),{code:"ORDER_TIME_NETWORK_TIMEOUT"}));
    controller.abort();
  },timeoutMs);
  try {
    const payload=await Promise.race([Promise.resolve().then(()=>fetcher(request,controller.signal)),cancelled]);
    if(signal.aborted)throw abortError();
    if(!Array.isArray(payload?.rows))throw new Error("订单查询返回不完整；未显示部分结果。");
    return payload;
  } finally {
    clearTimeout(timer);signal.removeEventListener("abort",onAbort);
  }
}

function mergeRows(payloads:OrderTimePayload[]):OrderTimeRow[] {
  const groups=new Map<string,OrderTimeRow>();
  for(const payload of payloads)for(const row of payload.rows){
    const key=JSON.stringify([row.direction,row.provider,row.channel_type,row.created_date,row.success_date]);
    const previous=groups.get(key);
    if(!previous){groups.set(key,{...row});continue;}
    for(const metric of timeMetricKeys)previous[metric]=Number(previous[metric]||0)+Number(row[metric]||0);
    for(const field of ["first_created_at","first_success_at"] as const){
      const value=row[field];if(value&&(!previous[field]||Date.parse(value)<Date.parse(previous[field]!)))previous[field]=value;
    }
    for(const field of ["last_created_at","last_success_at","last_synced_at"] as const){
      const value=row[field];if(value&&(!previous[field]||Date.parse(value)>Date.parse(previous[field]!)))previous[field]=value;
    }
  }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);
}

/**
 * All selected platforms share a two-request pool. Nothing is returned until
 * every shard succeeds; an error aborts siblings and discards partial results.
 * p_reference_start preserves the original earlier-order classification when
 * the server computes aggregates for smaller time windows.
 */
export async function queryOrderTimeBatches(
  filters:OrderTimeFilters[],
  fetcher:(request:OrderTimeBatchRequest,signal:AbortSignal)=>Promise<OrderTimePayload>,
  options:OrderTimeBatchOptions={},
):Promise<OrderTimeBatchResult[]> {
  if(options.signal?.aborted)throw abortError();
  const originals=new Map<string,ReturnType<typeof orderTimeRequest>>();
  const queue=filters.flatMap(filter=>{
    if(originals.has(filter.platform))throw new Error("平台重复，请合并同一平台的查询条件。");
    originals.set(filter.platform,orderTimeRequest(filter));return planOrderTimeBatches(filter);
  });
  const configuredTimeout=options.requestTimeoutMs??45000;
  if(!Number.isFinite(configuredTimeout)||configuredTimeout<1||configuredTimeout>45000)throw new Error("请求超时设置无效。");
  const controller=new AbortController(),results=new Map<string,OrderTimePayload[]>();
  let completed=0,total=queue.length,active=0,failed=false;
  const report=()=>options.onProgress?.({completed,total,active});
  const outerAbort=()=>controller.abort();
  options.signal?.addEventListener("abort",outerAbort,{once:true});
  try {
    report();
    await new Promise<void>((resolve,reject)=>{
      const fail=(error:unknown)=>{if(failed)return;failed=true;controller.abort();reject(error);};
      const pump=()=>{
        if(failed)return;
        if(controller.signal.aborted){fail(abortError());return;}
        while(active<2&&queue.length){
          const request=queue.shift()!;active++;report();
          void fetchShard(request,fetcher,controller.signal,configuredTimeout).then(payload=>{
            if(failed||controller.signal.aborted)return;
            const chunks=results.get(request.p_platform)||[];chunks.push(payload);results.set(request.p_platform,chunks);
            completed++;
          }).catch(error=>{
            if(failed)return;
            const retry=!controller.signal.aborted&&statementTimedOut(error)?smallerRequests(request):null;
            if(retry){queue.unshift(...retry);total++;}else fail(error);
          }).finally(()=>{active--;if(!failed){report();pump();}});
        }
        if(!active&&!queue.length)resolve();
      };
      pump();
    });
    if(controller.signal.aborted)throw abortError();
    return filters.map(filter=>{
      const chunks=results.get(filter.platform)||[],original=originals.get(filter.platform)!;
      const first=chunks[0];
      if(!first)throw new Error("订单分段查询未完成。");
      return {id:filter.platform,payload:{...first,rows:mergeRows(chunks),basis:filter.basis,
        start:original.p_start_at,endExclusive:original.p_end_at}};
    });
  } finally {
    options.signal?.removeEventListener("abort",outerAbort);
    controller.abort();
  }
}
