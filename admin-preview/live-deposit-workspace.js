/* Authenticated adapter for the source-export reconciliation presentation.
 * Source workorder KYC connection and manual Sheet checks remain separate. */
(function(root){
 'use strict';
 root.HensemLiveDepositWorkspace={create(ctx){
  const {L,E,C,N,table,request,render,formatTime}=ctx;
  let panel;
  const enumValue=(value,allowed)=>allowed.includes(value)?value:allowed[0];
  const sourceEvidence=r=>{
   const sources=Array.isArray(r.sources)?r.sources:[];
   return sources.length?table(['系统 / 文件','来源页 / 行','全部页 / 行','工单','原金额 / 币种'],sources.map(s=>[
    E(s.sourceSystem||'未提供')+' · '+E(s.sourceFile||'未提供'),E(s.sourceTab||'未提供')+' / '+C(s.sourceRow),E(s.allSourceTab||'未提供')+' / '+C(s.allSourceRow),E(s.workOrderId||'未提供'),s.amount==null?'—':E(String(s.amount)+' '+(s.currency||'币种未提供'))
   ]),'deposit-entry-full-detail')+(r.sourcesTruncated?'<p>来源行较多，当前仅展示已返回的来源。</p>':''):
    E(r.sourceFile||'未提供')+' · '+E(r.sourceTab||'未提供')+' · '+(r.sourceRow==null?'多个来源，请核对原文件':'第 '+C(r.sourceRow)+' 行');
  };
  const onlineEvidence=r=>Array.isArray(r.onlineSources)&&r.onlineSources.length?table(['原表行','原金额','三方','原表分类','人工 KYC / UTR'],r.onlineSources.map(s=>[C(s.sourceRow),s.amount==null?'—':E(String(s.amount)),E(s.provider||'未提供'),E(s.confirmation||s.status||'未提供'),E(s.manualKyc||s.kycCorrect||'未提供')+' / '+E(s.manualUtr||s.utrMatch||'未提供')]),'deposit-entry-full-detail')+(r.onlineSourcesTruncated?'<p>在线来源共 '+C(r.onlineSourceCount)+' 行，当前展示部分。</p>':''):'未提供';
  const detailValues=r=>[
   ['平台',E(r.platform||'未提供')],['原支付订单',E(r.paymentOrderId||'未提供')],['原工单',E(r.workOrderId||'未提供')],
   ['原导出 KYC 连接',E(({connected:'已连接',disconnected:'未连接',unknown:'待核实'})[r.kycStatus]||'待核实')],
   ['文件标签',E(r.declaredFileKyc||'未提供')],['原工单处理状态',E(r.sourceWorkorderState||'未提供')],
   ['原金额',r.amount==null?'—':E(String(r.amount)+' '+(r.currency||'币种未提供'))],['原三方',E(r.provider||'未提供')],
   ['在线匹配',E(r.matchStatus||'未比较')],['在线原表状态',E(r.onlineState||'未提供')],
   ['人工 KYC 核验',E(r.manualKyc||'未提供')],['人工 UTR 核验',E(r.manualUtr||'未提供')],
   ['到账核实',E(r.receiptState==='received_verified'?'已核实入款':r.receiptState==='unreceived_verified'?'已核实未入款':'待核实')],
   ['来源证据',sourceEvidence(r)],['在线来源证据',onlineEvidence(r)],
   ['重复来源行',C(r.exportRows)],['员工跟进记录',C(r.followupCount)],['最后跟进',E(r.lastFollowupAt||'未提供')],['三方回复',E(r.providerReply||'未提供')]
  ];
  panel=root.HensemLiveKycReconciliation.create({id:'deposit-source-kyc',queryLabel:'工单号 / 原支付单号',
   onRender:render,
   onQuery:async f=>{
    const q={action:'depositStatistics',section:'kyc',country:'印度',dimension:enumValue(f.dimension,['platform','provider','date','orders']),kycStatus:enumValue(f.kycStatus,['all','connected','disconnected','unknown']),processing:f.processing,matchStatus:f.matchStatus,offset:f.offset,limit:f.limit,dateMode:f.from||f.to?'range':'all'};
    if(q.dateMode==='range'){if(!f.from||!f.to)throw Error('请同时填写开始日期和结束日期');q.startAt=f.from+'T00:00:00.000Z';q.endAt=f.to+'T23:59:59.000Z'}
    if(f.query)q.query=f.query;if(f.platform)q.platform=f.platform;if(f.provider)q.provider=f.provider;
    const data=await request(q);return {...data,updatedAt:data.updatedAt?formatTime(data.updatedAt,'Asia/Kolkata'):undefined};
   },
   onDetail:info=>{
    if(info.dimension==='orders'){ctx.openDrawer?.('原订单核对 · '+(info.row.platform||''),table(['字段','内容'],detailValues(info.row),'deposit-entry-full-detail'));return}
    const f={...info.filters,dimension:'orders',offset:0};
    if(info.dimension==='platform')f.platform=info.key;
    else if(info.dimension==='provider')f.provider=info.key;
    else if(info.dimension==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(info.key||''))return;f.from=info.key;f.to=info.key}
    if(panel.restoreFilters(f))return panel.query();
   },
   onExplain:info=>ctx.openDrawer?.(info.title,'<p>'+E(info.text).replace(/\n/g,'</p><p>')+'</p>')
  });
  root.depositKycDate=kind=>{
   const f=panel.getState();let range;
   if(kind==='all'){f.from='';f.to=''}else{
    range=kind==='today'?root.HensemWorkorderUI.today('印度',L.catalog):root.HensemWorkorderUI.currentMonth('印度',L.catalog);
    f.from=range.from;f.to=range.to;
   }
   f.offset=0;if(panel.restoreFilters(f))return panel.query();
  };
  function manifest(){
   const sources=panel.getSnapshot()?.sourceManifest?.batches||[];
   return sources.length?'<div class="deposit-import-sources">'+sources.map(s=>'<span title="'+E(s.label||s.fileName)+'">'+E(s.label||s.fileName)+' · '+C(s.rowCount)+' 行</span>').join('')+'</div>':'';
  }
  return {render:()=>'<div class="deposit-source-actions"><span>印度 · 原导出数据</span><div><button class="btn" onclick="depositKycDate(\'today\')">今天</button><button class="btn" onclick="depositKycDate(\'month\')">本月</button><button class="btn" onclick="depositKycDate(\'all\')">全部日期</button></div></div>'+manifest()+panel.render(),load:()=>panel.query(),pause:()=>panel.pause(),capture:()=>panel.capture(),restore:value=>panel.restore(value),clear:()=>panel.clear(),destroy:()=>panel.dispose()};
 }};
})(window);
