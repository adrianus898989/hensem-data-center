// The iframe receives application drafts only, never the host authentication session.
export const OWNER_PREVIEW_DRAFT_KEYS = [
  "hensem-v3-access-draft", "hensem-v3-ip-draft", "hensem-v3-header-read",
  "hensem-v3-entity-config-draft", "hensem-demo-v3-teams", "hensem-demo-v3-rules", "hensem-demo-v3-delivery",
] as const;
export const OWNER_PREVIEW_MAX_DRAFT_BYTES = 2_000_000;
export function ownerPreviewDraftAllowed(key: unknown, value: unknown): boolean {
  return typeof key === "string" && (OWNER_PREVIEW_DRAFT_KEYS as readonly string[]).includes(key)
    && (value === null || (typeof value === "string" && value.length <= OWNER_PREVIEW_MAX_DRAFT_BYTES));
}
export function makeOwnerPreviewDocument(html: string, drafts: Record<string,string>, channel: string): string {
  if (!/^<!doctype html>/i.test(html.trim()) || !html.includes("Hensem")) throw new Error("后台预览返回格式不正确");
  const safe: Record<string,string> = {};
  for (const [key,value] of Object.entries(drafts)) if (ownerPreviewDraftAllowed(key,value)) safe[key]=value;
  const encode = (value: unknown) => JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  const bootstrap = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src data:; base-uri 'none'; form-action 'none'"><script>(function(){const values=${encode(safe)},keys=${encode(OWNER_PREVIEW_DRAFT_KEYS)},channel=${encode(channel)};const send=(key,value)=>parent.postMessage({type:'hensem-owner-preview-draft',channel,key,value},'*');const store={getItem(key){return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null},setItem(key,value){key=String(key);value=String(value);if(!keys.includes(key)||value.length>2000000)throw Error('Unsupported local draft');values[key]=value;send(key,value)},removeItem(key){if(keys.includes(key)){delete values[key];send(key,null)}},clear(){keys.forEach(key=>this.removeItem(key))},key(index){return Object.keys(values)[index]||null},get length(){return Object.keys(values).length}};Object.defineProperty(window,'localStorage',{value:store});})();</script>`;
  // Bootstrap before all other markup/scripts, including head-less legacy HTML.
  return html.replace(/(<!doctype html>)/i,"$1"+bootstrap);
}
