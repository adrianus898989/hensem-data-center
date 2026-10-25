// Real authenticated bridge, synthetic responses; no credentials or source data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-ready-only-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {load,session,bridge,flush,request,probe}=new Function('require','__dirname',prefix+';return {load,session,bridge,flush,request,probe};')(require,__dirname);
const full={...request,view:'full',amountBands:{charge:[0,100,200,300,400,500,600,700,800,900,1000],withdraw:[0,100,200,300,400,500,600,700,800,900,1000]}};
const compact={...probe,responseProfile:'time-v1',requests:[full]};
for(const assigned of [false,true])test('exact authorized ready pages use unchanged native requests on '+(assigned?'assigned':'owner')+' route',async()=>{
 const h=load();for(const page of ['providers','provider_payout','overview','merchants','teamops','teamcountries','teamplatforms'])await h.api.adminLiveRequest(session,probe,undefined,{assigned,page});
 for(const page of ['teamops','teamcountries','teamplatforms','time'])for(const request of [compact,{...compact,readMode:undefined,requests:[full]}])await h.api.adminLiveRequest(session,request,undefined,{assigned,page});
 assert.equal(h.calls.length,15);assert(h.calls.every(c=>JSON.parse(c.init.body).p_request.requests[0].platformId===request.platformId));
 for(const page of ['overview','merchants','collection','payout','risk','orders','matrix','provider_daily'])await assert.rejects(h.api.adminLiveRequest(session,compact,undefined,{assigned,page}));assert.equal(h.calls.length,15);
});
test('compact ready batches permit 50, ordinary stays 3; mixed views, duration drills and reuse remain rejected',()=>{
 const validate=load().api.validateAdminLiveRequest;assert.equal(validate({...compact,requests:Array(50).fill(full)}).requests.length,50);
 for(const patch of [{requests:Array(51).fill(full)},{readMode:undefined,requests:Array(4).fill(full)},{requests:[full,request]},{responseProfile:'amount-v1'},{responseProfile:'latency-v1'},{forceRefresh:false},{requests:[{...full,durationRange:{minSeconds:0,maxSeconds:60}}]},{providerReuseNames:[]},{providerLeafAliases:'items-fee-items-v1'}])assert.throws(()=>validate({...compact,...patch}));
});
for(const status of [400,500])test('only exact bounded capacity token survives postMessage as fallback code on HTTP '+status,async()=>{
 const h=load({fetch:async()=>({ok:false,status,json:async()=>({code:'54000',message:'prepared_ready_response_capacity'})})}),b=bridge(h,{roleAccess:()=>({mode:'owner',canView:true})}),e=b.event('capacity',compact);e.data.page='teamops';h.send(e);await flush();await flush();assert.equal(b.replies.length,1);assert.equal(b.replies[0].data.code,'PREPARED_READY_RESPONSE_CAPACITY');b.cleanup();
});
for(const [status,body]of [[403,{code:'54000',message:'prepared_ready_response_capacity'}],[401,{code:'54000',message:'prepared_ready_response_capacity'}],[500,{code:'22023',message:'prepared_ready_response_capacity'}],[500,{code:'54000',message:'different'}]])test('error '+status+'/'+body.code+'/'+body.message+' stays closed',async()=>{
 const h=load({fetch:async()=>({ok:false,status,json:async()=>body})});await assert.rejects(h.api.adminLiveRequest(session,compact,undefined,{assigned:true,page:'teamops'}),e=>e.code!=='PREPARED_READY_RESPONSE_CAPACITY');
});
test('ordinary compact reads cannot trigger ready-only capacity fallback',async()=>{
 const h=load({fetch:async()=>({ok:false,status:500,json:async()=>({code:'54000',message:'prepared_ready_response_capacity'})})});await assert.rejects(h.api.adminLiveRequest(session,{...compact,readMode:undefined},undefined,{assigned:false,page:'teamops'}),e=>e.code!=='PREPARED_READY_RESPONSE_CAPACITY');
});
