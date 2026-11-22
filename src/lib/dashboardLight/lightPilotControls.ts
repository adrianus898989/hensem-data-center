// Presentation only: keep original buttons, values, labels, form ownership and handlers.
export const LIGHT_PILOT_CONTROLS = String.raw`
(function () {
  "use strict";
  var root = document.documentElement;
  if (root.getAttribute("data-m8-light-pilot") === "1") return;
  root.setAttribute("data-m8-light-pilot","1");

  function mount() {
    var neutral = new Set(["请选择筛选条件，点击查询。","请选择日期与时间，点击查询。"]);
    var frame = 0;
    var page = document.getElementById("page");
    var host = page && page.parentElement ? page.parentElement : document.body;
    if (!host) return;

    function associateField(select) {
      if (select.labels && select.labels.length || select.hasAttribute("aria-label") || select.hasAttribute("aria-labelledby")) return;
      var field = select.closest(".live-field");
      var label = field && field.querySelector(":scope > label");
      if (label && !label.htmlFor && !label.contains(select)) {
        var name = label.textContent.trim();
        if (name) select.setAttribute("aria-label",name);
      }
    }

    function paint() {
      frame = 0;
      var filters = document.getElementById("liveFilters");
      var results = document.getElementById("page");
      var withdraw = results && results.querySelector(".withdraw-toolbar");
      var areas = [filters,withdraw,results && results.querySelector(".wo-filter-panel")].filter(Boolean);
      areas.forEach(function(area) {
        area.querySelectorAll(".live-field > select").forEach(associateField);
      });
      if (!results) return;
      var action = filters && filters.querySelector(".live-query-actions .btn.primary");
      var available = action && !action.disabled && action.getClientRects().length > 0;
      results.querySelectorAll(".live-query-prompt").forEach(function(prompt) {
        var redundant = available && !prompt.matches(".live-error,[role=alert]") &&
          !prompt.querySelector("button,a,summary,input,select,[role=alert]") &&
          neutral.has(prompt.textContent.trim());
        prompt.classList.toggle("lp-secondary-prompt",Boolean(redundant));
      });
    }

    function queue() {
      if (!frame) frame = window.requestAnimationFrame(paint);
    }

    function relevant(mutation) {
      var elem = mutation.target.nodeType===1 ? mutation.target : mutation.target.parentElement;
      if (!elem) return false;
      if (elem.id==="liveFilters" || elem.id==="page") return true;
      if (elem.closest(".live-query-prompt,.live-query-actions,.withdraw-toolbar,.wo-filter-panel,#liveFilters")) return true;
      return Array.prototype.some.call(mutation.addedNodes,function(n) {
        return n.nodeType===1 && (n.id==="liveFilters" || n.id==="page");
      });
    }
    var observer = new MutationObserver(function(records) {
      if (records.some(relevant)) queue();
    });
    observer.observe(host,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["disabled","hidden"]});
    paint();
    window.addEventListener("pagehide",function(e) {
      if (e.persisted) return;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    },{once:true});
  }
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",mount,{once:true});
  else mount();
})();
`;
// A narrow-screen disclosure for the existing authorized navigation and its route handlers.
export const LIGHT_MOBILE_NAVIGATION = String.raw`
(function () {
  function mount() {
    var sidebar = document.querySelector("body > aside.sidebar");
    var navigation = sidebar && sidebar.querySelector("#nav");
    var main = document.querySelector("body > main.main");
    if (!navigation || !main || document.querySelector("[data-m8-nav-toggle]")) return;

    var narrow = window.matchMedia("(max-width:700px)");
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.setAttribute("data-m8-nav-toggle","");
    toggle.setAttribute("aria-controls",navigation.id);
    toggle.setAttribute("aria-label","打开导航菜单");
    toggle.setAttribute("aria-expanded","false");
    var icon = document.createElement("span");
    icon.setAttribute("aria-hidden","true");
    toggle.append(icon);
    sidebar.prepend(toggle);

    var backdrop = document.createElement("div");
    backdrop.setAttribute("data-m8-nav-backdrop","");
    backdrop.setAttribute("aria-hidden","true");
    document.body.setAttribute("data-m8-nav-ready","");

    var open = false;
    var restoreMain = false;
    function setOpen(next, returnFocus) {
      if (open === next) return;
      open = next;
      document.body.toggleAttribute("data-m8-nav-open",open);
      toggle.setAttribute("aria-expanded",String(open));
      toggle.setAttribute("aria-label",open ? "关闭导航菜单" : "打开导航菜单");
      if (open) {
        sidebar.after(backdrop);
        restoreMain = !main.hasAttribute("inert");
        if (restoreMain) main.setAttribute("inert","");
        toggle.focus({preventScroll:true});
      } else {
        backdrop.remove();
        if (restoreMain) main.removeAttribute("inert");
        restoreMain = false;
        if (returnFocus && narrow.matches) toggle.focus({preventScroll:true});
      }
    }
    toggle.addEventListener("click",function () {
      if (narrow.matches) setOpen(!open,true);
    });
    backdrop.addEventListener("click",function () { setOpen(false,true); });
    sidebar.addEventListener("click",function (event) {
      if (!open) return;
      var path = event.composedPath();
      var link = path.find(function (node) { return node.matches && node.matches(".subnav > a[href]"); });
      if (link && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setOpen(false,true);
        return;
      }
      var group = path.find(function (node) { return node.matches && node.matches(".center-button"); });
      if (group && event.detail === 0) {
        // Expanding a group replaces nav.innerHTML. Keep keyboard focus on its new button.
        var action = group.getAttribute("onclick");
        window.requestAnimationFrame(function () {
          if (!open || sidebar.contains(document.activeElement)) return;
          var replacement = Array.from(navigation.querySelectorAll(".center-button")).find(function (node) {
            return node.getAttribute("onclick") === action;
          });
          (replacement || toggle).focus({preventScroll:true});
        });
      }
    });
    document.addEventListener("keydown",function (event) {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false,true);
      } else if (event.key === "Tab") {
        var items = Array.from(sidebar.querySelectorAll("button:not(:disabled),a[href]")).filter(function (item) {
          return item.tabIndex >= 0 && item.getClientRects().length > 0;
        });
        var first = items[0], last = items[items.length - 1];
        if (first && ((event.shiftKey && first === document.activeElement) || (!event.shiftKey && last === document.activeElement))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    });
    narrow.addEventListener("change",function () {
      if (narrow.matches) {
        if (sidebar.contains(document.activeElement)) toggle.focus({preventScroll:true});
      } else {
        var wasToggle = document.activeElement === toggle;
        setOpen(false,false);
        var activeRoute = navigation.querySelector(".subnav > a.active,.center-button.current");
        if (wasToggle && activeRoute) activeRoute.focus({preventScroll:true});
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",mount,{once:true});
  else mount();
})();
`;
