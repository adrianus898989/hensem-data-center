/* The host owns one authenticated heartbeat. This frame only presents its
 * authorized snapshot; navigation never starts a second heartbeat or leaves. */
(function(){
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let snapshot=null,connected=false,opened=false;
 const count=()=>Number.isSafeInteger(snapshot?.onlineCount)&&snapshot.onlineCount>=0?snapshot.onlineCount:null;
 const label=()=>count()===null?'在线 —':'在线 '+count().toLocaleString('en-US');
 const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 const reason=()=>snapshot?.loading?'正在读取在线状态…':({offline:'网络离线，暂无法读取在线人数。',timeout:'在线状态读取超时，请重试。',unavailable:'在线状态暂无法读取，请重试。',stale:'在线状态已过期，正在等待新心跳。',stopped:'登录状态已结束。'}[snapshot?.reason]||'在线状态尚未读取。');
 function panel(){
  const header='<div class="presence-pop-title"><b>后台在线账号'+(count()===null?'':' · '+count().toLocaleString('en-US')+' 人')+'</b><button type="button" class="link" data-presence-command="close">关闭</button></div>';
  const basis='<p class="presence-pop-basis">最近 120 秒心跳 · 同账号去重 · 当前可见范围</p>';
  const actions='<div class="presence-pop-actions"><span>更新 '+E(stamp(snapshot?.observedAt))+'</span><button type="button" class="link" data-presence-command="refresh" '+(snapshot?.loading?'disabled':'')+'>刷新</button></div>';
  if(count()===null)return header+basis+'<p class="presence-pop-state" role="status">'+E(reason())+'</p>'+actions;
  if(snapshot.accounts===null)return header+basis+'<p class="presence-pop-state">当前账号没有在线名单查看权限。</p>'+actions;
  const rows=snapshot.accounts.map(row=>'<tr><td>'+E(row.username)+'</td><td>'+E(stamp(row.lastSeenAt))+'</td></tr>').join('');
  return header+basis+(rows?'<div class="presence-pop-table"><table><thead><tr><th>账号</th><th>最近心跳</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="presence-pop-state">当前可见范围暂无在线后台账号。</p>')+actions;
 }
 function paint(){
  let node=document.getElementById('live-presence-pop');
  if(!node){node=document.createElement('section');node.id='live-presence-pop';node.className='live-header-pop live-presence-pop';node.setAttribute('role','dialog');node.setAttribute('aria-label','后台在线账号');document.querySelector('.topbar')?.appendChild(node)}
  const active=node.contains(document.activeElement)?document.activeElement?.dataset?.presenceCommand:null;
  node.innerHTML=panel();if(active)node.querySelector('[data-presence-command="'+active+'"]')?.focus();
 }
 function update(){const node=document.getElementById('headerOnlineV3');if(node){const value=node.querySelector('span');if(value)value.textContent=label();node.title=count()===null?'后台在线人数暂无法读取':'当前可见范围内，最近 120 秒有心跳的后台账号；同账号去重';node.setAttribute('aria-expanded',String(opened))}if(opened)paint()}
 const api={
  connect(){if(connected||typeof window.hensemPresenceSubscribe!=='function')return;connected=true;window.hensemPresenceSubscribe(value=>{snapshot=value;update()})},
  button(icon){api.connect();return '<button type="button" id="headerOnlineV3" class="live-header-button" data-presence-command="open" aria-haspopup="dialog" aria-expanded="'+opened+'" title="'+(count()===null?'后台在线人数暂无法读取':'当前可见范围内最近 120 秒有心跳的后台账号；同账号去重')+'">'+icon+'<span>'+E(label())+'</span></button>'},
  open(){api.connect();if(opened){api.close();return}opened=true;paint();update();document.getElementById('live-presence-pop')?.querySelector('[data-presence-command="close"]')?.focus();window.hensemPresenceRefresh?.()},
  close(){opened=false;document.getElementById('live-presence-pop')?.remove();update();document.getElementById('headerOnlineV3')?.focus()},
  refresh(){window.hensemPresenceRefresh?.()},
  panel,
 };
 document.addEventListener?.('click',event=>{const command=event.target?.closest?.('[data-presence-command]')?.dataset?.presenceCommand;if(command==='open')api.open();else if(command==='close')api.close();else if(command==='refresh')api.refresh()});
 document.addEventListener?.('keydown',event=>{if(event.key==='Escape'&&opened){event.preventDefault();api.close()}});
 window.HensemLivePresence=api;
})();
