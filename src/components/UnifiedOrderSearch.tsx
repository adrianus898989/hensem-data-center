"use client";
import {useState} from "react";
import OrderDetailSearch from "./OrderDetailSearch";
import NewarDetailSearch from "./NewarDetailSearch";
export default function UnifiedOrderSearch(){
  const [source,setSource]=useState("game66");
  return <><div className="ods-action-row" role="group" aria-label="明细来源"><button className={source==="game66"?"ods-primary":"ods-secondary"} onClick={()=>setSource("game66")}>全部已接入订单</button><button className={source==="newar"?"ods-primary":"ods-secondary"} onClick={()=>setSource("newar")}>NEWAR · 订单 / 工单</button></div>{source==="newar"?<NewarDetailSearch/>:<OrderDetailSearch/>}</>;
}
