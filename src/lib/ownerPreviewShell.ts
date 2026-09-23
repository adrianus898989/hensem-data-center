// Presentation-only shell. Authentication remains in the host; the opaque frame
// receives only a nonce for the single, allowlisted return-navigation command.
export const OWNER_PREVIEW_BODY_CLASS = "owner-preview-shell-active";
export const OWNER_PREVIEW_SHELL_MESSAGE = "hensem-owner-preview-shell";

export const OWNER_PREVIEW_HOST_CSS = `
.owner-preview-shell{position:fixed;inset:0;z-index:1000;background:#f3f6fb;display:flex;flex-direction:column;min-width:0}
.owner-preview-shell-frame{display:block;border:0;width:100%;height:100%;flex:1;min-height:0}
.owner-preview-shell-grants{position:fixed;top:8px;right:12px;z-index:2;width:84px;height:32px;padding:0 8px;border:1px solid #dce4f0;border-radius:6px;background:#fff;color:#405b84;font:500 11px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;cursor:pointer;white-space:nowrap}
.owner-preview-shell-grants:hover{background:#f1f5fc;border-color:#9cb6e0}
.owner-preview-shell-grants:focus-visible,.owner-preview-shell-return:focus-visible{outline:2px solid #5475df;outline-offset:2px}
.owner-preview-shell-status{margin:76px auto 24px;max-width:min(600px,calc(100vw - 32px));padding:24px;border:1px solid #e1e7f1;background:#fff;border-radius:8px;font-size:13px;color:#53627a}
.owner-preview-shell-status-actions{display:flex;gap:10px;margin-top:16px}
.owner-preview-shell-return{border:1px solid #dce4f0;background:#fff;color:#405b84;border-radius:5px;padding:7px 10px;cursor:pointer}
.owner-preview-shell-warning{position:absolute;left:250px;bottom:12px;right:12px;z-index:3;padding:8px 12px;border:1px solid #efd49f;border-radius:5px;background:#fff8e7;color:#805b1b;font-size:12px}
body.owner-preview-shell-active .auth-user-menu-wrap{top:8px!important;right:12px!important;bottom:auto!important;z-index:1400!important}
body.owner-preview-shell-active:has(.owner-preview-shell-grants) .auth-user-menu-wrap{right:104px!important}
body.owner-preview-shell-active .auth-user-trigger{min-width:160px!important;width:160px!important;height:32px!important;padding:3px 7px 3px 4px!important;gap:6px;border-radius:6px!important;box-shadow:0 2px 6px #1b355008!important;transform:none!important}
body.owner-preview-shell-active .auth-user-trigger>.auth-user-avatar{width:24px;height:24px;border-radius:5px;font-size:10px;box-shadow:none}
body.owner-preview-shell-active .auth-user-trigger>.auth-user-copy{display:flex!important;min-width:0}
body.owner-preview-shell-active .auth-user-trigger>.auth-user-copy b{font-size:11px;white-space:nowrap}
body.owner-preview-shell-active .auth-user-trigger>.auth-user-copy small{display:none}
body.owner-preview-shell-active .auth-user-trigger>.auth-user-chevron{display:inline!important;font-size:12px}
body.owner-preview-shell-active .auth-user-dropdown{top:38px;max-width:calc(100vw - 24px)}
body.owner-preview-shell-active .auth-session-warning{top:55px!important;z-index:1500!important}
@media(max-width:900px){
 .owner-preview-shell-grants{right:12px;width:74px;padding:0 5px}
 body.owner-preview-shell-active:has(.owner-preview-shell-grants) .auth-user-menu-wrap{right:94px!important}
 body.owner-preview-shell-active .auth-user-trigger{min-width:36px!important;width:36px!important;padding:3px 5px!important;justify-content:center}
 body.owner-preview-shell-active .auth-user-trigger>.auth-user-copy,body.owner-preview-shell-active .auth-user-trigger>.auth-user-chevron{display:none!important}
 .owner-preview-shell-warning{left:74px}
}
`;

export function mountOwnerPreviewHostShell(): () => void {
  const body = typeof document === "undefined" ? null : document.body;
  if (!body?.classList) return () => {};
  const alreadyMounted = body.classList.contains(OWNER_PREVIEW_BODY_CLASS);
  body.classList.add(OWNER_PREVIEW_BODY_CLASS);
  return () => { if (!alreadyMounted) body.classList.remove(OWNER_PREVIEW_BODY_CLASS); };
}

export function isOwnerPreviewReturnMessage(event: MessageEvent, source: Window | null | undefined, channel: string): boolean {
  const data = event.data;
  return !!source && !!channel && event.source === source && event.origin === "null"
    && data !== null && typeof data === "object" && data.type === OWNER_PREVIEW_SHELL_MESSAGE
    && data.channel === channel && data.command === "back";
}

export function makeOwnerPreviewShellDocument(html: string, channel: string, owner: boolean): string {
  const encode = (value: string) => JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  const desktopRight = owner ? 276 : 184, compactRight = owner ? 142 : 60;
  const styles = `<style id="owner-preview-frame-shell-style">
html{scroll-padding-top:60px}
body .topbar{position:sticky!important;top:0!important;z-index:30!important;height:48px!important;min-height:48px!important;display:flex!important;visibility:visible!important;opacity:1!important;transform:none!important;background:#fff!important;border-bottom:1px solid #e1e7f0!important;padding-right:${desktopRight}px!important;overflow:visible!important;gap:12px}
body .topbar .crumb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body .topbar .top-right{display:flex!important;flex-shrink:0;min-width:0;gap:8px!important}
body .topbar .top-right>.owner{display:none!important}
body .topbar .header-activity-v3{display:flex!important}
body .sidebar .nav{min-height:0}
body .sidebar .side-bottom{flex-shrink:0;padding:10px 0 0}
body .sidebar .side-bottom>.user{display:none}
.owner-preview-frame-return{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:32px;border:1px solid #344761;border-radius:6px;background:#17253e;color:#c7d5ec;font-family:inherit;font-size:11px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap}
.owner-preview-frame-return:hover{background:#203653;color:#fff}
.owner-preview-frame-return:focus-visible{outline:2px solid #90b2ff;outline-offset:2px}
body .ha-popover{max-width:min(425px,calc(100vw - 24px))}
@media(max-width:1100px){body .topbar .crumb{font-size:10px}body .topbar>.top-right>span:not(.sample):not(.owner){display:none}}
@media(max-width:900px){body .topbar{padding-right:${compactRight}px!important;padding-left:14px!important}}
@media(max-width:800px){.owner-preview-frame-return .owner-preview-return-label{display:none}.owner-preview-frame-return{font-size:18px}.owner-preview-frame-return .owner-preview-return-icon{display:block}}
@media(max-width:620px){body .topbar .crumb{display:none}body .topbar{justify-content:flex-end}body .topbar .top-right{gap:4px!important}body .topbar .top-right>.sample{padding:3px 5px;font-size:9px}}
</style>`;
  const script = `<script>(function(){const channel=${encode(channel)};function mount(){const sidebar=document.querySelector('.sidebar');if(!sidebar||document.getElementById('owner-preview-frame-return'))return;let footer=sidebar.querySelector('.side-bottom');if(!footer){footer=document.createElement('div');footer.className='side-bottom';sidebar.appendChild(footer)}const button=document.createElement('button');button.id='owner-preview-frame-return';button.type='button';button.className='owner-preview-frame-return';button.title='返回现有后台';button.setAttribute('aria-label','返回现有后台');button.innerHTML='<span class="owner-preview-return-icon" aria-hidden="true">←</span><span class="owner-preview-return-label">返回现有后台</span>';button.addEventListener('click',()=>parent.postMessage({type:'${OWNER_PREVIEW_SHELL_MESSAGE}',channel,command:'back'},'*'));footer.appendChild(button)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount()})();</script>`;
  // Add after existing styles so local page styles cannot re-hide or move the bar.
  const withStyles = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i,()=>styles+"</head>") : html.replace(/(<!doctype html>)/i,doctype=>doctype+styles);
  return /<\/body\s*>/i.test(withStyles) ? withStyles.replace(/<\/body\s*>/i,()=>script+"</body>") : withStyles+script;
}
