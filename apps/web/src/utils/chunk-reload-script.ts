/**
 * Recovers a tab from a redeploy. Every `next build` renames the chunks under
 * /_next/static, so a page loaded before the deploy asks for files the new
 * server no longer has — the tester's "ChunkLoadError … 500" on
 * test-app.navfarm.com, shown as "Application error: a client-side exception".
 * A reload fetches the new HTML with the new chunk names.
 *
 * It is an inline <head> script, not a React component, because when chunks
 * cannot load a component guard cannot load either. It reloads at most once
 * per 30 seconds (sessionStorage), so a chunk that is genuinely broken on the
 * server shows its error instead of looping.
 */
export const CHUNK_RELOAD_SCRIPT = `(function(){
var KEY="navfarm_chunk_reload_at";
function isChunkFailure(e){
  var t=e&&e.target;
  if(t&&t.tagName==="SCRIPT"&&String(t.src||"").indexOf("/_next/static/")!==-1)return true;
  var r=e&&(e.reason||e.error);
  var s=r?String(r.name||"")+" "+String(r.message||r):String(e&&e.message||"");
  return /ChunkLoadError|Loading chunk|Failed to load chunk|Loading CSS chunk/i.test(s);
}
function recover(e){
  if(!isChunkFailure(e))return;
  try{
    var last=Number(sessionStorage.getItem(KEY)||0);
    if(Date.now()-last<30000)return;
    sessionStorage.setItem(KEY,String(Date.now()));
  }catch(_){}
  window.location.reload();
}
window.addEventListener("error",recover,true);
window.addEventListener("unhandledrejection",recover);
})();`;
