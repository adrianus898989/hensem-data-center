// This runs in the exported HTML, before the Next runtime or the application can hydrate.
export const dashboardEntryRecoveryScript = `(function () {
  if (window.top !== window.self) return;
  var root = document.documentElement;
  var mark = "hensem.entry.retry:" + location.pathname;
  var pending = function () { return document.querySelector('[data-entry-check="pending"]'); };
  var stopped = false;
  var failed = false;
  var timers = [];
  function later(task, delay) { timers.push(setTimeout(task, delay)); }
  function show(state) {
    if (!stopped && pending()) root.setAttribute('data-entry-state', state);
  }
  function retryOnce() {
    if (stopped || !pending() || !navigator.onLine || document.visibilityState === 'hidden') return;
    // If the marker cannot survive a navigation, leave retry in the user's hands.
    try {
      if (sessionStorage.getItem(mark)) return;
      sessionStorage.setItem(mark, '1');
    } catch (_) { return; }
    location.reload();
  }
  function failedScript(event) {
    var el = event.target;
    if (el && el.tagName === 'SCRIPT' && el.src) {
      var url = new URL(el.src, location.href);
      if (url.origin !== location.origin || !url.pathname.includes('/_next/static/chunks/')) return;
      failed = true;
      show(navigator.onLine ? 'failed' : 'offline');
      later(retryOnce, 1200);
    }
  }
  function offline() { show('offline'); }
  function online() {
    if (!pending()) return;
    show(failed ? 'failed' : 'slow');
    retryOnce();
  }
  function click(event) {
    var card = pending();
    if (!card || !event.target.closest || !card.contains(event.target.closest('[data-entry-retry]'))) return;
    location.reload();
  }
  function stop(event) {
    stopped = true;
    root.removeAttribute('data-entry-state');
    if (event.type === 'hensem:entry-ready') {
      try { sessionStorage.removeItem(mark); } catch (_) {}
    }
    timers.forEach(clearTimeout);
    window.removeEventListener('error', failedScript, true);
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
    document.removeEventListener('click', click);
    window.removeEventListener('hensem:entry-ready', stop);
  }
  window.addEventListener('error', failedScript, true);
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  document.addEventListener('click', click);
  window.addEventListener('hensem:entry-ready', stop);
  later(function () { show(navigator.onLine ? (failed ? 'failed' : 'slow') : 'offline'); }, 12000);
  later(retryOnce, 30000);
})();`;
