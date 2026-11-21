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

    function compactDates(group) {
      if (!group || !group.children.length || group.contains(document.activeElement)) return;
      if (group.closest(".lp-date-shortcuts,.live-date-panel")) return;
      var toolbar = group.closest(".live-business-filters");
      if (!toolbar) return;
      var panel = toolbar.querySelector("#liveDatePanel");
      if (panel && panel.querySelector(".live-date-controls")) {
        var controls = panel.querySelector(".live-date-controls");
        controls.parentNode.insertBefore(group,controls);
        return;
      }
      var popup = document.createElement("details");
      popup.className = "lp-date-shortcuts";
      var caption = document.createElement("summary");
      caption.className = "lp-date-summary";
      caption.textContent = "快捷日期";
      var body = document.createElement("div");
      body.className = "lp-date-body";
      group.parentNode.insertBefore(popup,group);
      popup.append(caption,body);
      body.appendChild(group);
    }

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
      if (filters) filters.querySelectorAll(".live-date-shortcuts").forEach(compactDates);
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
    // Native details supplies Enter/Space. Escape also returns focus to the trigger.
    document.addEventListener("keydown",function(e) {
      if (e.defaultPrevented || e.key!=="Escape" || !(e.target instanceof Element)) return;
      var popup=e.target.closest("details.lp-date-shortcuts[open]");
      if (!popup) return;
      popup.open=false;
      popup.querySelector("summary").focus();
      e.preventDefault();
    });
    document.addEventListener("pointerdown",function(e) {
      document.querySelectorAll("details.lp-date-shortcuts[open]").forEach(function(popup) {
        if (!popup.contains(e.target)) popup.open=false;
      });
    });
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
