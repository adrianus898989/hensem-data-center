"use client";
import {useEffect,useRef,useState} from 'react';
import {dashboardBusinessFetch} from '@/lib/dashboardDataClient';
import {dashboardScopeAllows,effectiveDashboardDataScope} from '@/lib/dashboardDataScope';
import type {DashboardProfile} from '@/lib/dashboardAuthClient';
import {parseFilterCandidates,type FilterCandidate} from '@/lib/filterCandidates';

export function useFilterCandidateDirectory(identity:string,profile:DashboardProfile|null){
  const owner=useRef(identity);owner.current=identity;
  const [stored,setStored]=useState<{identity:string;rows:FilterCandidate[]}|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let disposed=false;
    const timer=setTimeout(()=>controller.abort(),30000);
    setLoading(true);setError('');
    void (async()=>{
      try{
        const response=await dashboardBusinessFetch('/api/third-party-filter-options',{signal:controller.signal});
        const payload=await response.json();
        if(!response.ok)throw new Error('筛选候选目录暂不可用，请重试。');
        const rows=parseFilterCandidates(payload.candidates).filter(row=>dashboardScopeAllows(effectiveDashboardDataScope(profile),row.country,row.platform));
        if(!disposed&&!controller.signal.aborted&&owner.current===identity)setStored({identity,rows});
      }catch{if(!disposed&&owner.current===identity){setStored(null);setError('筛选候选目录暂不可用，仍可输入完整通道名称查询。');}}
      finally{clearTimeout(timer);if(!disposed&&owner.current===identity)setLoading(false);}
    })();
    return()=>{disposed=true;clearTimeout(timer);controller.abort();};
  // Scope identity changes clear data; refreshing the token does not rerun queries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[identity,retry]);
  return {rows:stored?.identity===identity?stored.rows:[],loading,error,reload:()=>setRetry(n=>n+1)};
}
