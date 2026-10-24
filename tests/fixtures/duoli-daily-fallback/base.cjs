const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=process.env.DUOLI_TEST_REPO_ROOT||path.resolve(__dirname,'../../..');
const file=path.join(root,'tests/withdraw-npg-template-serving.test.cjs');
const h=new Function('require','__dirname',fs.readFileSync(file,'utf8').split(/\ntest.afterEach/)[0]+';return{install,value,getDb:()=>db};')(createRequire(file),path.dirname(file));
async function fixture(){await h.install();const db=h.getDb();await db.exec(fs.readFileSync(path.join(__dirname,'actual-private-withdraw_prepared_render.sql'),'utf8'));await db.exec(`delete from public.synthetic_catalog;delete from public.auto_withdraw_daily;delete from public.withdraw_operator_daily;
insert into public.synthetic_catalog select md5('duoli:ID:'||p)::uuid,p,'M8','印尼','ID','duoli','Asia/Jakarta','IDR',p from unnest(array['UANG','FB168','FB333','HOT985','IND666'])p;`);return db;}
const q=(extra={})=>({country:'印尼',view:'auto',startAt:'2026-10-23T00:00:00.000Z',endAt:'2026-10-23T23:59:59.000Z',limit:500,...extra});
const day=(platform,date,values={})=>({data_date:date,country:'印尼',platform,platform_key:platform,total:null,success:null,rejected:null,pending_count:null,unknown_count:null,avg_seconds:null,duration_sample_count:null,duration_total_seconds:null,source_updated_at:null,updated_at:null,operator_rows:[],...values});
function bundle(extra={}){return {wg:[],yash:[],newar:[],ar:[],arHistory:[],game66:{},duoli:['2026-10-22','2026-10-23'].flatMap(date=>['UANG','FB168','FB333','HOT985','IND666'].map(p=>day(p,date))),...extra};}
async function call(db,request=q(),b=bundle()){return(await db.query('select private.withdraw_prepared_render($1,$2)r',[request,b])).rows[0].r;}
async function report(db,p='UANG',date='2026-10-23',n=100,values={}){const v={success:n-3,rejected:2,auto:70,manual:29,avg:60,...values};await db.query('insert into public.auto_withdraw_daily(data_date,country,platform,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)',[date,'印尼',p,n,v.success,v.rejected,v.auto,v.manual,v.avg,date+'T23:59:59Z']);}
module.exports={fixture,q,day,bundle,call,report};
