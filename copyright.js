(function () {
  if (window.__omniCopyright) return;
  window.__omniCopyright = true;
  var TEXT = "© 2026 Jonathan Kunkel & OmniAIHub.net — All Rights Reserved. All content, creative works, writings, designs, graphics, videos, applications, software, concepts, characters, stories, branding, and other intellectual property contained herein are the exclusive property of Jonathan Kunkel and/or OmniAIHub.net unless otherwise stated. Unauthorized reproduction, distribution, modification, publication, or use of any kind without prior written permission is strictly prohibited.";
  var css = document.createElement("style");
  css.textContent = "#omni-copyright{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:rgba(255,255,255,.96);color:#222;border-top:1px solid rgba(0,0,0,.14);font:12px/1.35 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Arial,sans-serif;padding:7px 12px;white-space:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;text-align:left;letter-spacing:.01em}body{padding-bottom:38px!important}.omni-vid-copy{position:absolute;left:0;right:0;bottom:0;z-index:8;background:rgba(0,0,0,.62);color:#fff;font:12px/1.35 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Arial,sans-serif;padding:5px 10px;white-space:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;pointer-events:auto}";
  (document.head || document.documentElement).appendChild(css);
  function stamp(el) {
    if (!el || el.dataset.omniCopy === "1") return;
    var parent = el.parentElement;
    if (!parent || parent.id === "omni-copyright") return;
    el.dataset.omniCopy = "1";
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    if (parent.querySelector(":scope > .omni-vid-copy")) return;
    var line = document.createElement("div");
    line.className = "omni-vid-copy";
    line.textContent = TEXT;
    parent.appendChild(line);
  }
  function mount() {
    if (!document.body) return;
    if (!document.getElementById("omni-copyright")) {
      var bar = document.createElement("div");
      bar.id = "omni-copyright";
      bar.setAttribute("role", "contentinfo");
      bar.textContent = TEXT;
      document.body.appendChild(bar);
    }
    document.querySelectorAll("video, iframe").forEach(stamp);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  var timer = null;
  var obs = new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () { timer = null; mount(); }, 80);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
