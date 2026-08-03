// 24J RAW正式同步版（历史自动补齐 backfill-next）
// 自动出款 + 提现操作人直接读取 AR_RAW_2026，不再读取“数据/操作人统计”展示页。
// action: ping | check-date | sync-date | backfill-next
// Header: x-sync-secret = SYNC_SECRET
// Verify JWT with legacy secret = OFF

import { createClient } from "jsr:@supabase/supabase-js@2";

type Values = string[][];
const DEFAULT_ARCHIVE_ID = "1YILuFYg4ZMASsDTsDMiF4-YKp7SLU6ouVopbK5LVQxc";

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function s(v: unknown) { return String(v ?? "").replace(/\u00a0/g, " ").trim(); }
function n(v: unknown) { const x = Number(s(v).replace(/,/g, "")); return Number.isFinite(x) ? x : 0; }
function i(v: unknown) { return Math.trunc(n(v)); }
function normDate(v: unknown) {
  const x = s(v).replace(/\//g, "-").replace(/\./g, "-");
  const m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}` : "";
}
function validDate(v: string) { return /^20\d{2}-\d{2}-\d{2}$/.test(v); }
function monthSuffix(v: string) { return v.slice(0,7).replace("-","_"); }
function avg(total: number, count: number) { return count > 0 ? Number((total / count).toFixed(6)) : 0; }
function secText(v: number) {
  const x = Math.max(0, Math.round(v || 0));
  const h = Math.floor(x/3600), m = Math.floor((x%3600)/60), ss = x%60;
  if (h) return `${h}时${m}分${ss}秒`;
  if (m) return `${m}分${ss}秒`;
  return `${ss}秒`;
}

const PANGHU_BRAZIL_PLATFORMS = new Set([
  "VIP345","KKVIP","KK345","FF555","TPTP","AA45","F75","25RR",
  "8599BET","9596BET","8566BET","5V555","58EE","27FF","222O",
  "32QQ","67VIP","222VIP","345F","234T","888HH","BET5697",
  "96F","45FF","76PP","56L","559K","2V222","5C555"
]);

function normalizePlatformName(platform: unknown): string {
  const p = s(platform);
  if (!p) return "";
  const upper = p.toUpperCase();
  const map: Record<string,string> = {
    "INDIA82": "82LOTTERY",
    "82LOTTERY": "82LOTTERY",
    "RAJAGAME": "RAJA",
    "RAJA": "RAJA",
    "222VIP.COM": "222VIP",
    "222-VIP": "222VIP",
    "67-VIP": "67VIP",
    "DHANIWIN": "DHANI.WIN",
    "DHANI.WIN": "DHANI.WIN",
    "POPZAR": "POPZAR",
  };
  return map[p] || map[upper] || p;
}

function mapCountryGroup(country: unknown, platform: unknown): string {
  const c = s(country);
  const p = normalizePlatformName(platform);

  if (p === "DHANI.WIN" && (c === "IN" || c === "印度" || !c)) return "印度";
  if (p === "POPZAR" && (c === "PK" || c === "巴基斯坦" || !c)) return "巴基斯坦";

  if (PANGHU_BRAZIL_PLATFORMS.has(p.toUpperCase())) return "胖虎巴西";
  if (c === "哥伦比亚" || c === "墨西哥" || c === "智利") return "南美";

  if (c === "IN") return "印度";
  if (c === "PK") return "巴基斯坦";
  if (c === "BR") return "巴西";
  if (c === "VN") return "越南";
  if (c === "ID") return "印尼";
  if (c === "MY") return "马来";
  if (c === "MM") return "缅甸";
  if (c === "PH") return "菲律宾";

  return c || "未知";
}
function hmap(headers: string[]) {
  const m = new Map<string,number>(); headers.forEach((x,k)=>m.set(s(x).toLowerCase(),k)); return m;
}
function cell(m: Map<string,number>, row: string[], key: string) {
  const k = m.get(key.toLowerCase()); return k === undefined ? "" : s(row[k]);
}
function keySecret(v: string) { return s(v).replace(/^"|"$/g, "").replace(/\\n/g, "\n"); }
function b64url(input: Uint8Array|string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin=""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function importKey(pem: string) {
  const clean = pem.replace("-----BEGIN PRIVATE KEY-----","").replace("-----END PRIVATE KEY-----","").replace(/\s+/g,"");
  const bin = atob(clean), bytes = new Uint8Array(bin.length);
  for (let k=0;k<bin.length;k++) bytes[k]=bin.charCodeAt(k);
  return crypto.subtle.importKey("pkcs8",bytes.buffer,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
}
async function googleToken(email: string, privateKey: string) {
  const now = Math.floor(Date.now()/1000);
  const a=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const b=b64url(JSON.stringify({iss:email,scope:"https://www.googleapis.com/auth/spreadsheets.readonly",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const unsigned=`${a}.${b}`;
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",await importKey(privateKey),new TextEncoder().encode(unsigned));
  const assertion=`${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const data=await res.json();
  if (!res.ok || !data?.access_token) throw new Error(`Google 登录失败：${JSON.stringify(data)}`);
  return String(data.access_token);
}
async function valuesGet(bookId: string, range: string, token: string): Promise<Values> {
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(bookId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  let last: unknown=null;
  for (let a=1;a<=3;a++) {
    try {
      const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
      const data=await res.json();
      if (res.ok) return (data.values||[]) as Values;
      last=new Error(`Google HTTP ${res.status}: ${JSON.stringify(data)}`);
      if (res.status<500 && res.status!==429) break;
    } catch(e) { last=e; }
    await new Promise(r=>setTimeout(r,a*600));
  }
  throw last instanceof Error ? last : new Error("Google 读取失败");
}
async function hash(text: string) {
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function upsertChunks(client:any, table:string, rows:any[]) {
  for (let p=0;p<rows.length;p+=400) {
    const {error}=await client.from(table).upsert(rows.slice(p,p+400),{onConflict:"id"});
    if (error) throw new Error(`${table} upsert 失败：${error.message}`);
  }
}

function parseDaily(values: Values, target: string) {
  if (!values.length) return [];
  const m=hmap(values[0]);
  const req=["stat_date","system_name","country","platform","total_count","success_count","reject_count","auto_count","manual_count","total_handle_seconds","handle_count"];
  for (const k of req) if (!m.has(k)) throw new Error(`raw_daily 缺少字段：${k}`);
  const out:any[]=[];
  for (let r=1;r<values.length;r++) {
    const row=values[r]||[]; if (normDate(cell(m,row,"stat_date"))!==target) continue;
    const rawCountry=cell(m,row,"country");
    const rawPlatform=cell(m,row,"platform");
    const platform=normalizePlatformName(rawPlatform);
    const country=mapCountryGroup(rawCountry, platform);
    const system=cell(m,row,"system_name");
    if (!country || !platform) continue;
    const totalSec=n(cell(m,row,"total_handle_seconds")), handleCount=n(cell(m,row,"handle_count")), avgSec=avg(totalSec,handleCount);
    out.push({statDate:target,system,country,platform,total:i(cell(m,row,"total_count")),success:i(cell(m,row,"success_count")),rejected:i(cell(m,row,"reject_count")),autoCount:i(cell(m,row,"auto_count")),manualCount:i(cell(m,row,"manual_count")),totalHandleSeconds:totalSec,handleCount,avgSec,avgTimeText:secText(avgSec),sourceUpdatedAt:cell(m,row,"updated_at")});
  }
  return out;
}
function parseOperator(values: Values, target: string) {
  if (!values.length) return [];
  const m=hmap(values[0]);
  const req=["stat_date","system_name","country","platform","operator","processed_count","reject_count","total_handle_seconds","handle_count"];
  for (const k of req) if (!m.has(k)) throw new Error(`raw_operator_daily 缺少字段：${k}`);
  const out:any[]=[];
  for (let r=1;r<values.length;r++) {
    const row=values[r]||[]; if (normDate(cell(m,row,"stat_date"))!==target) continue;
    const rawCountry=cell(m,row,"country");
    const rawPlatform=cell(m,row,"platform");
    const platform=normalizePlatformName(rawPlatform);
    const country=mapCountryGroup(rawCountry, platform);
    const operator=cell(m,row,"operator");
    const system=cell(m,row,"system_name");
    if (!country || !platform || !operator) continue;
    const totalSec=n(cell(m,row,"total_handle_seconds")), handleCount=n(cell(m,row,"handle_count")), avgSec=avg(totalSec,handleCount);
    out.push({statDate:target,system,country,platform,operator,processed:i(cell(m,row,"processed_count")),rejected:i(cell(m,row,"reject_count")),totalHandleSeconds:totalSec,handleCount,avgSec,avgTimeText:secText(avgSec),sourceUpdatedAt:cell(m,row,"updated_at")});
  }
  return out;
}
function byCountry(rows:any[]) {
  const m=new Map<string,number>();
  for (const r of rows) m.set(r.country,(m.get(r.country)||0)+1);
  return Array.from(m.entries()).map(([country,rows])=>({country,rows})).sort((a,b)=>a.country.localeCompare(b.country,"zh-CN"));
}


function isoAfterMinutes(minutes:number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function updateBackfillTask(client:any, date:string, patch:any) {
  const { error } = await client
    .from("auto_withdraw_history_backfill")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("data_date", date);
  if (error) throw new Error(`历史补齐任务状态更新失败：${error.message}`);
}

async function loadRawForDate(archiveId:string, token:string, date:string) {
  const suf=monthSuffix(date);
  const dailySheet=`raw_daily_${suf}`;
  const operatorSheet=`raw_operator_daily_${suf}`;
  const [dailyValues,operatorValues]=await Promise.all([
    valuesGet(archiveId,`'${dailySheet}'!A1:Z50000`,token),
    valuesGet(archiveId,`'${operatorSheet}'!A1:Z50000`,token),
  ]);
  const daily=parseDaily(dailyValues,date);
  const operators=parseOperator(operatorValues,date);
  return {
    dailySheet,
    operatorSheet,
    daily,
    operators,
    dailyCountries:byCountry(daily),
    operatorCountries:byCountry(operators),
  };
}

async function syncLoadedDate(client:any, date:string, loaded:any) {
  const {
    dailySheet, operatorSheet, daily, operators,
    dailyCountries, operatorCountries
  } = loaded;

  const runAt=new Date().toISOString();

  const dbDaily=await Promise.all(daily.map(async (r:any)=>({
    id:await hash(`auto|${r.statDate}|${r.system}|${r.country}|${r.platform}`),
    data_date:r.statDate,
    country:r.country,
    platform:r.platform,
    total:r.total,
    success:r.success,
    rejected:r.rejected,
    auto_count:r.autoCount,
    manual_count:r.manualCount,
    avg_seconds:r.avgSec,
    avg_time_text:r.avgTimeText,
    source_sheet:dailySheet,
    raw:r,
    source_updated_at:runAt,
    updated_at:runAt
  })));

  const dbOperators=await Promise.all(operators.map(async (r:any)=>({
    id:await hash(`operator|${r.statDate}|${r.system}|${r.country}|${r.platform}|${r.operator}`),
    data_date:r.statDate,
    country:r.country,
    platform:r.platform,
    account:r.operator,
    processed:r.processed,
    rejected:r.rejected,
    avg_seconds:r.avgSec,
    avg_time_text:r.avgTimeText,
    source_sheet:operatorSheet,
    raw:r,
    source_updated_at:runAt,
    updated_at:runAt
  })));

  await upsertChunks(client,"auto_withdraw_daily",dbDaily);
  await upsertChunks(client,"withdraw_operator_daily",dbOperators);

  if (dbDaily.length) {
    const {error}=await client
      .from("auto_withdraw_daily")
      .delete()
      .eq("data_date",date)
      .eq("source_sheet",dailySheet)
      .lt("updated_at",runAt);
    if (error) throw new Error(`清理自动出款旧行失败：${error.message}`);
  }

  if (dbOperators.length) {
    const {error}=await client
      .from("withdraw_operator_daily")
      .delete()
      .eq("data_date",date)
      .eq("source_sheet",operatorSheet)
      .lt("updated_at",runAt);
    if (error) throw new Error(`清理操作人旧行失败：${error.message}`);
  }

  const dm=new Map(dailyCountries.map((x:any)=>[x.country,x.rows]));
  const om=new Map(operatorCountries.map((x:any)=>[x.country,x.rows]));
  const countries=Array.from(
    new Set([
      ...dailyCountries.map((x:any)=>x.country),
      ...operatorCountries.map((x:any)=>x.country)
    ])
  ).sort((a:any,b:any)=>String(a).localeCompare(String(b),"zh-CN"));

  const statusRows:any[]=[];
  for (const country of countries) {
    const dc=Number(dm.get(country)||0);
    const oc=Number(om.get(country)||0);
    statusRows.push({
      data_date:date,
      country,
      dataset:"auto_withdraw",
      status:dc>0?"success":"source_not_ready",
      row_count:dc,
      google_ready:dc>0,
      supabase_ready:dc>0,
      last_attempt_at:runAt,
      last_success_at:dc>0?runAt:null,
      message:dc>0?`RAW已同步 ${dc} 行`:"RAW未找到该国家自动出款数据",
      updated_at:runAt
    });
    statusRows.push({
      data_date:date,
      country,
      dataset:"operator",
      status:oc>0?"success":"source_not_ready",
      row_count:oc,
      google_ready:oc>0,
      supabase_ready:oc>0,
      last_attempt_at:runAt,
      last_success_at:oc>0?runAt:null,
      message:oc>0?`RAW已同步 ${oc} 行`:"RAW未找到该国家操作人数据",
      updated_at:runAt
    });
  }

  if (statusRows.length) {
    const {error}=await client
      .from("auto_withdraw_sync_status")
      .upsert(statusRows,{onConflict:"data_date,country,dataset"});
    if (error) throw new Error(`同步状态写入失败：${error.message}`);
  }

  return {
    runAt,
    dbDaily,
    dbOperators,
    dailyCountries,
    operatorCountries,
    dailySheet,
    operatorSheet,
  };
}

async function claimNextBackfillTask(client:any) {
  const now = new Date().toISOString();
  const today = new Date();
  const yesterday = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()-1
  )).toISOString().slice(0,10);

  const {data:tasks,error}=await client
    .from("auto_withdraw_history_backfill")
    .select("data_date,status,attempts,next_retry_at")
    .in("status",["pending","retry","source_not_ready"])
    .lte("data_date",yesterday)
    .order("data_date",{ascending:true})
    .limit(20);

  if (error) throw new Error(`读取历史补齐任务失败：${error.message}`);

  const task=(tasks||[]).find((x:any)=>!x.next_retry_at || x.next_retry_at<=now);
  if (!task) return null;

  const attempts=Number(task.attempts||0)+1;
  const {data:claimed,error:claimError}=await client
    .from("auto_withdraw_history_backfill")
    .update({
      status:"running",
      attempts,
      last_attempt_at:now,
      next_retry_at:null,
      message:"正在从 RAW 归档补齐",
      updated_at:now
    })
    .eq("data_date",task.data_date)
    .eq("status",task.status)
    .select("data_date,status,attempts")
    .maybeSingle();

  if (claimError) throw new Error(`领取历史补齐任务失败：${claimError.message}`);
  return claimed || null;
}

Deno.serve(async (req)=>{
  if (req.method==="OPTIONS") return new Response("ok");
  let client:any=null;
  let claimedDate="";
  try {
    const expectedSecret=Deno.env.get("SYNC_SECRET")||"";
    if (!expectedSecret || (req.headers.get("x-sync-secret")||"")!==expectedSecret) {
      return reply({ok:false,message:"Unauthorized"},401);
    }

    let body:any={};
    try { body=await req.json(); } catch {}

    const action=s(body?.action||"ping").toLowerCase();
    const email=Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")||"";
    const privateKey=keySecret(Deno.env.get("GOOGLE_PRIVATE_KEY")||"");
    const archiveId=Deno.env.get("AUTO_WITHDRAW_ARCHIVE_SHEET_ID")||DEFAULT_ARCHIVE_ID;

    if (!email || !privateKey) throw new Error("Google Secrets 不完整");

    const token=await googleToken(email,privateKey);

    if (action==="ping") {
      return reply({
        ok:true,
        message:"24J RAW正式同步版已部署，历史自动补齐已加入，Google Auth OK",
        archiveSpreadsheetId:archiveId
      });
    }

    const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
    const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if (!supabaseUrl || !serviceRole) throw new Error("Supabase 内置环境变量不完整");
    client=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});

    if (action==="backfill-next") {
      const task=await claimNextBackfillTask(client);
      if (!task) {
        return reply({
          ok:true,
          action,
          done:true,
          message:"目前没有可执行的历史补齐任务"
        });
      }

      claimedDate=s(task.data_date);
      const loaded=await loadRawForDate(archiveId,token,claimedDate);

      if (!loaded.daily.length && !loaded.operators.length) {
        await updateBackfillTask(client,claimedDate,{
          status:"source_not_ready",
          auto_rows:0,
          operator_rows:0,
          next_retry_at:isoAfterMinutes(30),
          message:"RAW 暂无该日数据，30分钟后自动重试"
        });
        return reply({
          ok:true,
          action,
          date:claimedDate,
          done:false,
          status:"source_not_ready",
          message:"RAW 暂无该日数据，已排队稍后重试"
        });
      }

      const synced=await syncLoadedDate(client,claimedDate,loaded);
      const complete=loaded.daily.length>0 && loaded.operators.length>0;

      await updateBackfillTask(client,claimedDate,{
        status:complete?"success":"source_not_ready",
        auto_rows:synced.dbDaily.length,
        operator_rows:synced.dbOperators.length,
        last_success_at:complete?synced.runAt:null,
        next_retry_at:complete?null:isoAfterMinutes(30),
        message:complete
          ?`历史补齐完成：自动出款 ${synced.dbDaily.length} 行，操作人 ${synced.dbOperators.length} 行`
          :`RAW 尚未两套齐全：自动出款 ${synced.dbDaily.length} 行，操作人 ${synced.dbOperators.length} 行`
      });

      return reply({
        ok:true,
        action,
        date:claimedDate,
        status:complete?"success":"source_not_ready",
        written:{
          autoWithdraw:synced.dbDaily.length,
          operator:synced.dbOperators.length
        },
        autoWithdraw:{
          source:synced.dailySheet,
          countries:synced.dailyCountries
        },
        operator:{
          source:synced.operatorSheet,
          included:true,
          countries:synced.operatorCountries
        }
      });
    }

    const date=s(body?.date||"");
    if (!validDate(date)) return reply({ok:false,message:"date 请使用 YYYY-MM-DD"},400);

    const loaded=await loadRawForDate(archiveId,token,date);

    if (action==="check-date") {
      return reply({
        ok:true,
        action,
        date,
        message:"RAW只读检查完成，未写数据库",
        autoWithdraw:{
          source:loaded.dailySheet,
          rows:loaded.daily.length,
          googleReady:loaded.daily.length>0,
          countries:loaded.dailyCountries,
          sample:loaded.daily.slice(0,8)
        },
        operator:{
          source:loaded.operatorSheet,
          included:true,
          rows:loaded.operators.length,
          googleReady:loaded.operators.length>0,
          countries:loaded.operatorCountries,
          sample:loaded.operators.slice(0,8)
        }
      });
    }

    if (action!=="sync-date") {
      return reply({
        ok:false,
        message:"action 请使用 ping / check-date / sync-date / backfill-next"
      },400);
    }

    if (!loaded.daily.length && !loaded.operators.length) {
      return reply({ok:false,message:`${date} RAW 没有数据，拒绝写入`},409);
    }

    const synced=await syncLoadedDate(client,date,loaded);
    const complete=loaded.daily.length>0 && loaded.operators.length>0;

    // 如果该日期已经在历史任务表里，手动 sync-date 也同步更新任务状态。
    const {data:historyRow}=await client
      .from("auto_withdraw_history_backfill")
      .select("data_date")
      .eq("data_date",date)
      .maybeSingle();

    if (historyRow) {
      await updateBackfillTask(client,date,{
        status:complete?"success":"source_not_ready",
        auto_rows:synced.dbDaily.length,
        operator_rows:synced.dbOperators.length,
        last_success_at:complete?synced.runAt:null,
        next_retry_at:complete?null:isoAfterMinutes(30),
        message:complete
          ?`手动同步完成：自动出款 ${synced.dbDaily.length} 行，操作人 ${synced.dbOperators.length} 行`
          :`RAW 尚未两套齐全：自动出款 ${synced.dbDaily.length} 行，操作人 ${synced.dbOperators.length} 行`
      });
    }

    return reply({
      ok:true,
      action,
      date,
      message:"RAW 自动出款 + 提现操作人已正式写入 Supabase",
      written:{
        autoWithdraw:synced.dbDaily.length,
        operator:synced.dbOperators.length
      },
      autoWithdraw:{
        source:synced.dailySheet,
        countries:synced.dailyCountries
      },
      operator:{
        source:synced.operatorSheet,
        included:true,
        countries:synced.operatorCountries
      }
    });

  } catch(e) {
    const msg=e instanceof Error?e.message:String(e);

    // 只有 backfill-next 已领取任务后出错时，才写回 retry。
    if (client && claimedDate) {
      try {
        await updateBackfillTask(client,claimedDate,{
          status:"retry",
          next_retry_at:isoAfterMinutes(15),
          message:`补齐失败，15分钟后重试：${msg}`
        });
      } catch {}
    }

    return reply({ok:false,message:msg},500);
  }
});
