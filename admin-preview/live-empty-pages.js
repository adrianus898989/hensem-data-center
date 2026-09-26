/* Formal-data empty layouts. No order, identity, log, rule, or source fixture is
 * read. Load before live-data.js; gapPage may call HensemLiveEmpty.render(page).
 * Layout references: workorders-detail, risk-columns, analysis-pages,
 * system-pages and entity-config-ui. Controls only change this local empty view.
 */
(function (root) {
  'use strict';
  const E = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const choice = (key, label, options) => ({key, label, options});
  const text = (key, label, type = 'text') => ({key, label, type});
  const source = choice('source', '数据来源', [['all','全部来源'],['AR','AR'],['NEW_AR','NEW_AR'],['GAME66','GAME66']]);
  const direction = choice('direction', '业务方向', [['all','全部方向'],['charge','代收'],['withdraw','代付']]);
  const status = choice('status', '业务状态', [['all','全部状态'],['success','成功'],['pending','处理中'],['failed','失败'],['rejected','拒绝'],['unknown','未知']]);
  const binding = choice('binding', '配置状态', [['all','全部状态'],['assigned','已绑定'],['unassigned','未绑定']]);
  const dates = [text('from', '起始时间', 'datetime-local'), text('to', '截止时间', 'datetime-local')];
  const businessFields = [text('platform','平台'),text('provider','三方'),direction,...dates];
  const schema = {
    workorders: {title:'未到账工单', note:'工单来源未接入', metrics:['提交金额','提交笔数','已到账金额','已到账笔数','未到账金额','未到账笔数'], fields:[text('workorderId','工单 ID'),text('orderNumber','订单号'),text('platform','平台'),text('provider','三方'),...dates,choice('arrivalStatus','到账状态',[['all','全部状态'],['arrived','已到账'],['pending','未到账'],['unknown','待核验']]),choice('group','汇总维度',[['provider','三方'],['platform','平台'],['team','团队'],['country','国家']])], tabs:[['summary','同批汇总'],['arrival','到账时效'],['waiting','未到账等待'],['orders','逐笔工单']]},
    dropped: {title:'掉单核对',note:'独立掉单核对标记未接入',metrics:['掉单关联金额','掉单订单笔数','代收掉单金额','代付掉单金额'],fields:[...businessFields,text('orderNumber','订单号'),status]},
    anomaly: {title:'异常核对',note:'异常事件与独立核对标记未接入',metrics:['异常关联金额','异常订单笔数','异常中成功金额','异常中处理中金额'],fields:[...businessFields,text('orderNumber','订单号'),text('type','异常类型'),status]},
    events: {title:'风险事件',note:'风险事件流水未接入',metrics:['风险事件','待核查','高风险事件','已跟进'],fields:[text('eventId','事件编号'),text('provider','三方'),direction,choice('level','风险级别',[['all','全部级别'],['high','高风险'],['attention','关注']]),choice('handling','处理状态',[['all','全部状态'],['pending','待核查'],['following','跟进中'],['closed','已处理']]),...dates]},
    rules: {title:'预警规则',note:'正式规则与自动调度未接入',metrics:['规则数量','已启用规则','涉及三方','最近执行'],fields:[text('rule','规则名称'),text('provider','三方'),direction,choice('enabled','启用状态',[['all','全部状态'],['enabled','启用'],['disabled','停用']])]},
    access: {title:'账号与角色权限',note:'后台账号与工单账号分开管理',metrics:[],fields:[]},
    ip: {title:'IP 白名单',note:'正式 IP 策略与访问日志未接入',metrics:['规则数量','启用规则','适用账号','拦截记录'],fields:[text('rule','规则名称'),text('cidr','IP / CIDR'),text('account','适用账号'),choice('surface','适用入口',[['all','全部入口'],['login','后台登录'],['api','采集 API'],['both','登录与采集 API']]),choice('enabled','规则状态',[['all','全部状态'],['enabled','启用'],['disabled','停用']])]},
    login_logs: {title:'登录日志',note:'认证审计未接入',metrics:['登录记录','登录成功','登录失败','活跃会话'],fields:[text('account','账号'),text('ip','IP'),text('client','客户端'),choice('result','登录结果',[['all','全部结果'],['success','成功'],['failed','失败']]),...dates]},
    operation_logs: {title:'操作日志',note:'正式操作审计未接入',metrics:['操作记录','操作完成','权限拒绝','涉及模块'],fields:[text('account','操作者'),text('requestId','请求 ID'),text('resource','资源'),text('module','模块'),text('action','动作'),choice('result','操作结果',[['all','全部结果'],['success','完成'],['denied','拒绝'],['failed','失败']]),...dates]},
    teams: {title:'团队平台配置',note:'正式团队平台绑定未接入',metrics:['原始平台','已绑定平台','未绑定平台','团队数量'],fields:[source,text('rawPlatform','原始平台'),text('team','归属团队'),text('country','归属国家'),binding]},
    provider_config: {title:'三方配置',note:'正式三方名称映射未接入',metrics:['原始三方','已归类三方','未归类三方','统一三方'],fields:[source,text('rawProvider','原始三方'),text('canonicalProvider','统一三方'),choice('binding','配置状态',[['all','全部状态'],['assigned','已归类'],['unassigned','未归类']])]},
    platform_systems: {title:'平台包网系统配置',note:'正式业务包网绑定未接入',metrics:['原始平台','已绑定平台','未绑定平台','包网系统'],fields:[source,text('rawPlatform','原始平台'),text('system','包网系统'),binding]}
  };
  const views = Object.create(null);
  function initial(page) {
    const draft = Object.fromEntries(schema[page].fields.map(field => [field.key,field.options?.[0]?.[0] || '']));
    return {draft, applied:{...draft}, tab:schema[page].tabs?.[0]?.[0] || '', type:'all', permission:'pages', waitMode:'duration', page:1, limit:20, searched:false};
  }
  function get(page) { return schema[page] ? (views[page] || (views[page] = initial(page))) : null; }
  function tabs(page, key, options) {
    return '<div class="tabs" role="tablist">'+options.map(([value,label])=>'<button type="button" role="tab" aria-selected="'+(get(page)[key]===value)+'" class="'+(get(page)[key]===value?'on':'')+'" onclick="HensemLiveEmpty.tab(\''+page+'\',\''+value+'\',\''+key+'\')">'+E(label)+'</button>').join('')+'</div>';
  }
  function field(page, spec) {
    const value = get(page).draft[spec.key] || '', label = E(spec.label);
    const attributes = ' aria-label="'+label+'" data-empty-field="'+spec.key+'"';
    const callback = 'HensemLiveEmpty.change(\''+page+'\',\''+spec.key+'\',this.value)';
    return '<label class="ps-field-v4" style="flex:0 1 174px;min-width:130px;max-width:230px"><span>'+label+'</span>'+(spec.options
      ? '<select'+attributes+' onchange="'+callback+'">'+spec.options.map(([key,name])=>'<option value="'+E(key)+'"'+(key===value?' selected':'')+'>'+E(name)+'</option>').join('')+'</select>'
      : '<input'+attributes+' type="'+(spec.type||'text')+'"'+(spec.type==='datetime-local'?' step="1"':' maxlength="200"')+' value="'+E(value)+'" placeholder="'+label+'" oninput="'+callback+'">')+'</label>';
  }
  function searchBar(page) {
    return '<section class="panel ps-panel-v4" aria-label="'+E(schema[page].title)+'查询" style="padding:12px 16px"><form style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px" onsubmit="event.preventDefault();HensemLiveEmpty.search(\''+page+'\')">'+schema[page].fields.map(spec=>field(page,spec)).join('')+'<div class="ps-actions-v4"><button type="submit" class="btn primary">查询</button><button type="button" class="btn" onclick="HensemLiveEmpty.reset(\''+page+'\')">重置</button></div></form></section>';
  }
  function emptyTable(headers, label, searched = false) {
    return '<div class="live-table"><table aria-label="'+E(label)+'"><thead><tr>'+headers.map(header=>'<th>'+E(header)+'</th>').join('')+'</tr></thead><tbody><tr class="live-empty-row"><td colspan="'+headers.length+'"><div class="live-empty">'+(searched?'当前筛选：':'')+'暂无可展示记录 · 未接入</div></td></tr></tbody></table></div>';
  }
  function panel(page,title,headers,note='',actions='') {
    return '<section class="panel"><div class="panel-head"><h2>'+E(title)+'</h2>'+actions+'</div>'+emptyTable(headers,title,get(page).searched)+(note?'<div class="live-panel-note">'+E(note)+'</div>':'')+'</section>';
  }
  function disabled(label) { return '<button class="btn small" type="button" disabled title="正式服务未接入">'+E(label)+'</button>'; }
  function metrics(page) {
    return '<div class="kpis dense-metrics">'+schema[page].metrics.map(label=>'<div class="kpi"><div class="kpi-label">'+E(label)+'</div><div class="kpi-value">—</div><small>未接入</small></div>').join('')+'</div>';
  }
  function pager(page) {
    return '<div class="live-pagination" style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:10px 0"><span>总记录 — · 未接入</span><label>每页 <select aria-label="每页条数" onchange="HensemLiveEmpty.pagechange(\''+page+'\',1,this.value)">'+[20,30,50,100,500].map(n=>'<option'+(get(page).limit===n?' selected':'')+'>'+n+'</option>').join('')+'</select></label><button class="btn small" type="button" disabled>上一页</button><span>页码 —</span><button class="btn small" type="button" disabled>下一页</button></div>';
  }
  const orderHeaders = ['订单 ID','订单号','平台','三方','方向','订单金额','业务状态','创建时间','核对状态','操作'];
  function workorders(page) {
    const s=get(page), group=s.draft.group || 'provider', title={provider:'三方',platform:'平台',team:'团队',country:'国家'}[group];
    let html='<div class="wo-navigation">'+tabs(page,'type',[['all','全部'],['collection','存款未到账'],['payout','提款未到账']])+tabs(page,'tab',schema[page].tabs)+'</div>';
    html+='<div class="wo-stats"><span>笔数到账率 <b>—</b></span><span>金额到账率 <b>—</b></span><span>涉及平台 <b>—</b></span><span>涉及三方 <b>—</b></span><span>关联订单 <b>—</b></span></div>';
    if(s.tab==='summary')return html+panel(page,'同批工单汇总',[title,'类型','平台数','提交金额','提交笔数','到账金额','到账笔数','未到账金额','未到账笔数','笔数到账率','金额到账率'],'提交日期同批工单');
    if(s.tab==='orders')return html+panel(page,'逐笔工单',['工单 ID','订单号','平台','三方','提交时间／日期','到账确认时间','工单金额','到账状态','操作']);
    const waiting=s.tab==='waiting';
    if(waiting)html+=tabs(page,'waitMode',[['duration','精确等待'],['days','日期账龄']]);
    return html+panel(page,waiting?'未到账等待分档':'到账时效分档',['类型',waiting&&s.waitMode==='days'?'日期账龄':'时长档位','金额','工单笔数','笔数占比','金额占比'])
      +'<div class="grid equal">'+panel(page,'累计超过阈值',['类型','超过时长','金额','工单笔数','笔数占比','金额占比'])+panel(page,'时间字段核验',['类型','有效时间笔数','缺少时间笔数','时间冲突笔数','平均耗时','P95'])+'</div>';
  }
  function access() {
    return '<div class="grid equal" data-account-entries><section class="panel"><div class="panel-head"><h2>后台账号</h2></div><div style="padding:18px"><p>管理后台登录账号、角色、模块权限、数据范围与密码。</p><button type="button" class="btn primary" onclick="HensemLiveEmpty.openAccounts(\'open-accounts\')">管理后台账号</button></div></section><section class="panel"><div class="panel-head"><h2>工单账号</h2></div><div style="padding:18px"><p>管理工单系统的主管、员工、审计员与团队平台范围。工单账号独立于后台账号。</p><button type="button" class="btn primary" onclick="HensemLiveEmpty.openAccounts(\'open-workorder-accounts\')">管理工单账号</button></div></section></div><p class="live-panel-note" role="status" id="hle-account-message">后台账号按已有管理权限开放；工单账号仅总管理员可管理。新版查看授权仍在右上角。</p>';
  }
  function openAccounts(command) {
    if(command!=='open-accounts'&&command!=='open-workorder-accounts')return false;
    if(typeof root.hensemOpenAccountManager==='function')return root.hensemOpenAccountManager(command);
    const node=root.document?.getElementById('hle-account-message');if(node)node.textContent='账号管理入口尚未就绪，请刷新后重试。';return false;
  }

  function rules(page) {
    const names=['掉单率','未代付金额','订单成功率','当前三方占比','异常订单数','超期未付笔数'];
    return '<section class="panel"><div class="panel-head"><h2>六项风险阈值</h2>'+disabled('保存规则')+'</div><div class="rule-grid">'+names.map(name=>'<div class="rule-card"><h3>'+name+'</h3><div class="rule-input"><label>关注阈值</label><input aria-label="'+name+'关注阈值" disabled placeholder="未接入"></div><div class="rule-input"><label>高风险阈值</label><input aria-label="'+name+'高风险阈值" disabled placeholder="未接入"></div></div>').join('')+'</div></section>'
      +'<div class="grid equal">'+panel(page,'判定保护条件',['最低订单量','超期账龄','数据不足处理','多项命中处理'])+panel(page,'当前规则预览',['三方','方向','当前建议','主要触发因素'])+'</div>';
  }
  function body(page) {
    if(page==='workorders')return workorders(page);
    if(page==='access')return access(page);
    if(page==='rules')return rules(page);
    if(page==='dropped')return '<div class="grid equal">'+panel(page,'掉单业务状态',['业务状态','掉单金额','掉单笔数','笔数占比'])+panel(page,'平台掉单分布',['平台','掉单金额','掉单笔数','掉单率','操作'])+'</div>'+panel(page,'三方掉单核对',['三方','方向','全部金额','全部笔数','掉单金额','掉单笔数','掉单率','处理中笔数','失败笔数','同时异常笔数','操作'])+panel(page,'掉单订单明细',orderHeaders);
    if(page==='anomaly')return '<div class="grid equal">'+panel(page,'异常类型分布',['异常类型','关联金额','关联笔数','笔数占比'])+panel(page,'异常业务状态',['业务状态','关联金额','关联笔数','估算手续费'])+'</div>'+panel(page,'三方异常核对',['三方','方向','全部金额','全部笔数','异常金额','异常笔数','异常占比','处理中笔数','失败笔数','同时掉单笔数','操作'])+panel(page,'异常订单明细',['异常类型',...orderHeaders]);
    if(page==='events')return panel(page,'风险事件队列',['事件编号','三方','方向','级别','触发规则','关联金额','关联笔数','发现时间','处理状态','详情']);
    if(page==='login_logs')return panel(page,'登录日志',['账号','登录时间','IP','客户端','登录结果','失败原因','白名单结果','会话状态','详情'])+panel(page,'失败原因分布',['失败原因','记录数']);
    if(page==='operation_logs')return panel(page,'操作日志',['操作者','操作时间','模块','动作','资源','变更摘要','结果','请求 ID','详情'])+panel(page,'配置变更记录',['操作','操作时间','变更前','变更后']);
    if(page==='ip')return panel(page,'IP / CIDR 规则',['规则名称','IP / CIDR','适用入口','适用账号','状态','操作'],'',disabled('＋ 新增规则'))+'<div class="grid equal">'+panel(page,'访问匹配结果',['请求时间','IP','入口','账号','命中规则','访问结果'])+panel(page,'当前会话保护',['当前会话 IP','保护通道','备用恢复路径','策略状态'])+'</div>';
    if(page==='teams')return panel(page,'平台归属配置',['原始平台','团队','国家','来源','匹配订单数','状态','操作'],'',disabled('＋ 新增团队'))+panel(page,'团队目录',['团队','国家数','平台数','状态','操作']);
    if(page==='provider_config')return panel(page,'原始三方归类',['原始三方','统一三方','来源','匹配订单数','状态','操作'],'',disabled('＋ 批量归类三方'));
    if(page==='platform_systems')return panel(page,'平台包网系统配置',['原始平台','包网系统','来源','匹配订单数','状态','操作'],'',disabled('＋ 新增包网系统')+disabled('批量绑定平台'));
    return '';
  }
  function inner(page) {
    if(page==='access')return access();
    return searchBar(page)+'<div class="live-scope"><span>'+E(schema[page].note)+'</span><span>平台 — · 三方 — · 当前范围未接入</span></div>'+metrics(page)+body(page)+pager(page);
  }
  function render(page) { return get(page)?'<div id="hle-'+page+'" class="hensem-live-empty-pages" data-empty-page="'+page+'">'+inner(page)+'</div>':''; }
  function repaint(page) {
    const node=root.document?.getElementById('hle-'+page);
    if(node)node.innerHTML=inner(page);
    return render(page);
  }
  function change(page,key,value) {
    const s=get(page), spec=s&&schema[page].fields.find(field=>field.key===key);
    if(!spec || (spec.options&&!spec.options.some(option=>option[0]===value)))return false;
    s.draft[key]=String(value).slice(0,200);return true;
  }
  function search(page,fields) {
    const s=get(page);if(!s)return '';
    if(fields&&typeof fields==='object')for(const [key,value] of Object.entries(fields))change(page,key,value);
    s.applied={...s.draft};s.searched=true;s.page=1;return repaint(page);
  }
  function tab(page,value,key='tab') {
    const s=get(page);if(!s)return '';
    const allowed=key==='tab'?(schema[page].tabs||[]).map(x=>x[0]):key==='type'&&page==='workorders'?['all','collection','payout']:key==='permission'&&page==='access'?['pages','actions']:key==='waitMode'&&page==='workorders'?['duration','days']:[];
    if(!allowed.includes(value))return render(page);
    s[key]=value;s.page=1;return repaint(page);
  }
  function pagechange(page,number,limit) {
    const s=get(page);if(!s)return '';
    // There is no known result count, so an empty source never invents pages.
    s.page=1;if([20,30,50,100,500].includes(Number(limit)))s.limit=Number(limit);
    return repaint(page);
  }
  function reset(page) { if(!schema[page])return '';views[page]=initial(page);return repaint(page); }
  root.HensemLiveEmpty={render,search,change,tab,pagechange,reset,openAccounts,pages:Object.freeze(Object.keys(schema)),snapshot:page=>get(page)?JSON.parse(JSON.stringify(get(page))):null};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.HensemLiveEmpty;
})(typeof window!=='undefined'?window:globalThis);
