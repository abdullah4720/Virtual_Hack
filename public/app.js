// أداة مشتركة لكل الصفحات: تحميل الإعدادات من لوحة التحكم وتطبيق الهوية.
// إذا فُتحت الصفحات مباشرة (بدون خادم) تعمل المنصة في "وضع العرض التجريبي":
// نفس منطق الخادم يعمل داخل المتصفح، والبيانات تُحفظ في هذا المتصفح فقط.
window.APP = (() => {
  const esc = (s) => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; };
  const fmt = (n) => Number(n || 0).toLocaleString("ar-SA-u-nu-latn");
  const short = (n) => (n >= 1e6 ? (n / 1e6).toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 1 }) + " مليون" : fmt(n));
  const API = /(^|\/)api\/(\w+)/;
  const realFetch = window.fetch.bind(window);
  const self = { demo: false };
  const scriptSrc = document.currentScript?.src || "";

  // ---------- تحديد الوضع: خادم حقيقي أم عرض تجريبي ----------
  const mode = (async () => {
    if (location.protocol !== "file:") {
      try {
        const r = await realFetch("api/config", { cache: "no-store" });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) return "server";
      } catch (e) {}
    }
    return "demo";
  })();

  let demoReady = null, inflight = 0;
  // تحميل البيانات المحفوظة في نفس الكائنات التي يستخدمها منطق الخادم
  // (قبل كل طلب، كي ترى كل صفحة مفتوحة ما كتبته الصفحات الأخرى)
  function loadDemoDb() {
    try {
      const saved = JSON.parse(localStorage.getItem("demo_db") || "null");
      const mem = globalThis.__mem || (globalThis.__mem = {});
      const seq = globalThis.__seq || (globalThis.__seq = { n: 0 });
      if (saved) { Object.keys(mem).forEach((k) => delete mem[k]); Object.assign(mem, saved.mem || {}); seq.n = saved.seq || 0; }
    } catch (e) {}
  }
  function loadDemo() {
    if (demoReady) return demoReady;
    demoReady = new Promise((resolve, reject) => {
      // تحميل البيانات المحفوظة في نفس الكائنات التي يستخدمها منطق الخادم
      loadDemoDb();
      if (window.DEMO_API) return resolve(window.DEMO_API.handlers); // نسخة الملف الواحد
      const s = document.createElement("script");
      s.src = scriptSrc ? scriptSrc.replace(/app\.js(\?.*)?$/, "demo-api.js") : "demo-api.js";
      s.onload = () => resolve(window.DEMO_API.handlers);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return demoReady;
  }
  // مزوّد الذكاء الاصطناعي في نسخة العرض: حساب Claude للمشاهد (الرابط المنشور) أو مفتاح محفوظ في هذا المتصفح
  const aiReady = (async () => {
    try {
      if (window.claude?.use) {
        const sample = await window.claude.use("sample");
        if (sample) { globalThis.__AI_PROVIDER = { sample }; return "claude-account"; }
      }
    } catch (e) {}
    try {
      const key = localStorage.getItem("demo_ai_key");
      if (key) { globalThis.__AI_PROVIDER = { key }; return "browser-key"; }
    } catch (e) {}
    return "none";
  })();

  async function demoFetch(url, opts = {}) {
    await aiReady;
    const handlers = await loadDemo();
    const u = new URL(url, "http://local/");
    const name = u.pathname.match(API)[2];
    const handler = handlers[name];
    if (!handler) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    const headers = {};
    const h = opts.headers || {};
    (h instanceof Headers ? [...h.entries()] : Object.entries(h)).forEach(([k, v]) => (headers[k.toLowerCase()] = v));
    const req = { method: opts.method || "GET", url: `/api/${name}${u.search}`, headers, body: opts.body instanceof Blob ? opts.body : opts.body ? JSON.parse(opts.body) : {} };
    let status = 200, body = "", out = {};
    const res = {
      status(s) { status = s; return res; },
      setHeader(k, v) { out[k.toLowerCase()] = v; },
      json(o) { out["content-type"] = "application/json"; body = JSON.stringify(o); },
      end(d) { body = d ?? ""; },
    };
    // لا نعيد التحميل أثناء طلب آخر قيد التنفيذ في نفس الصفحة (مثل تقييم طويل) كي لا تضيع كتاباته
    if (!inflight) loadDemoDb();
    inflight++;
    try { await handler(req, res); }
    finally {
      inflight--;
      try { localStorage.setItem("demo_db", JSON.stringify({ mem: globalThis.__mem, seq: globalThis.__seq?.n || 0 })); } catch (e) {}
    }
    return new Response(body, { status, headers: out });
  }

  // معرّف ثابت لهذا المتصفح (لحدود الاستخدام لكل جهاز) ومفتاح الكشك إن وُجد
  const DEVICE = (() => { try { let d = localStorage.getItem("device_id"); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("device_id", d); } return d; } catch (e) { return ""; } })();
  const KIOSK = (() => { try { const k = new URLSearchParams(location.search).get("kiosk"); if (k) sessionStorage.setItem("kiosk", k); return k || sessionStorage.getItem("kiosk") || ""; } catch (e) { return ""; } })();
  self.kiosk = KIOSK;
  window.fetch = async (url, opts) => {
    const s = typeof url === "string" ? url : url.url;
    const local = !/^[a-z]+:/i.test(s) || s.startsWith(location.origin);
    if (!local || !API.test(s)) return realFetch(url, opts);
    // إضافة معرّف الجهاز ومفتاح الكشك لطلبات المنصة
    opts = { ...(opts || {}) };
    const h = new Headers(opts.headers || {});
    if (DEVICE && !h.has("x-device-id")) h.set("x-device-id", DEVICE);
    if (KIOSK && !h.has("x-kiosk-key")) h.set("x-kiosk-key", KIOSK);
    opts.headers = Object.fromEntries(h.entries());
    return (await mode) === "demo" ? demoFetch(s, opts) : realFetch(url, opts);
  };

  // ---------- الهوية ----------
  function title(text) {
    const w = String(text || "").trim().split(/\s+/);
    if (w.length < 2) return `<span class="gold">${esc(text)}</span>`;
    const last = w.pop();
    return `${esc(w.join(" "))} <span class="gold">${esc(last)}</span>`;
  }
  function ink(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? "#14110a" : "#ffffff";
  }
  function applyTheme(c) {
    const r = document.documentElement.style;
    if (c.brand.accent) { r.setProperty("--brand-accent", c.brand.accent); r.setProperty("--accent-ink", ink(c.brand.accent)); }
    if (c.brand.bg) r.setProperty("--brand-navy", c.brand.bg);
    document.querySelectorAll("[data-logo]").forEach((el) => {
      const L = c.brand.logos || [];
      if (L.length) { el.innerHTML = `<span class="logos">${L.map((l, i) => `${i ? '<span class="sep"></span>' : ""}<img src="${esc(l.url)}" alt="${esc(l.name || c.brand.orgName)}" class="${l.mono ? "mono" : ""}">`).join("")}</span>`; el.hidden = false; }
    });
    document.querySelectorAll("[data-text]").forEach((el) => {
      const v = el.dataset.text.split(".").reduce((a, k) => a?.[k], c);
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll("[data-title]").forEach((el) => {
      const v = el.dataset.title.split(".").reduce((a, k) => a?.[k], c);
      if (v != null) el.innerHTML = title(v);
    });
  }
  function disabled(msg) {
    document.body.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--muted)">
      <div><i data-icon="lock" style="font-size:44px;color:var(--accent)"></i><p style="font-size:18px;margin-top:10px">${esc(msg)}</p></div></div>`;
  }
  function demoBadge() {
    if (window.top !== window) return; // لا تظهر داخل شاشة الجناح المتناوبة
    const b = document.createElement("div");
    b.textContent = "نسخة عرض تجريبية · البيانات محفوظة في هذا المتصفح فقط";
    b.style.cssText = "position:fixed;top:10px;left:10px;z-index:99;font:12px 'IBM Plex Sans Arabic',system-ui;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;pointer-events:none";
    document.body.appendChild(b);
  }

  // ---------- الإعلانات ----------
  function banner(c) {
    const body = document.body;
    if (window.top !== window || body.hasAttribute("data-screen") || body.hasAttribute("data-noannounce")) return;
    let hidden = [];
    try { hidden = JSON.parse(localStorage.getItem("ann_hidden") || "[]"); } catch (e) {}
    const list = (c.announcements || []).filter((a) => a.audience === "all" && !hidden.includes(a.id));
    if (!list.length) return;
    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width:720px;margin:14px auto 0;padding:0 16px";
    wrap.innerHTML = list.map((a) => `<div data-ann="${a.id}" style="display:flex;gap:10px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-inline-start:4px solid var(--accent);border-radius:12px;padding:10px 14px;margin-bottom:8px;color:var(--text);line-height:1.7;box-shadow:var(--shadow)">
      <i data-icon="megaphone" style="color:var(--accent);font-size:20px;margin-top:3px"></i><span style="flex:1"><b>${esc(a.title)}</b>${a.body ? `<br><span style="font-size:14px;color:var(--muted);white-space:pre-wrap">${esc(a.body)}</span>` : ""}</span>
      <button aria-label="إخفاء" style="background:none;border:0;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">×</button></div>`).join("");
    wrap.addEventListener("click", (e) => {
      const box = e.target.closest("[data-ann]");
      if (!box || e.target.tagName !== "BUTTON") return;
      hidden.push(Number(box.dataset.ann)); try { localStorage.setItem("ann_hidden", JSON.stringify(hidden)); } catch (err) {}
      box.remove();
    });
    const top = body.querySelector(".topbar");
    top ? top.after(wrap) : body.prepend(wrap);
  }
  // شريط إعلانات للشاشات: <div data-ticker></div>
  function ticker(c) {
    const el = document.querySelector("[data-ticker]");
    if (!el) return;
    const list = (c.announcements || []).filter((a) => a.audience === "all" || a.audience === "screens");
    el.hidden = !list.length;
    // تُفسح الشاشة مكانًا للشريط في الأسفل فلا يغطي محتواها
    const room = () => { const h = el.hidden ? 0 : el.offsetHeight; document.documentElement.style.setProperty("--tkh", h + "px"); document.body.classList.toggle("has-ticker", h > 0); document.querySelectorAll("[data-fit]").forEach(fit); };
    if (!list.length) { el.innerHTML = ""; el._k = ""; room(); return; }
    const html = list.map((a) => `<span><i data-icon="megaphone"></i> <b>${esc(a.title)}</b>${a.body ? ` — ${esc(a.body)}` : ""}</span>`).join("");
    if (el._k === html) return; // لا نعيد التشغيل إن لم يتغير شيء
    el._k = html;
    // نسختان متطابقتان تكفي كل منهما عرض الشاشة ← حركة متصلة بلا فراغ
    el.innerHTML = `<div class="tk-in"><div class="tk-c">${html}</div></div>`;
    const cp = el.querySelector(".tk-c"), w = el.clientWidth || innerWidth;
    let n = 1; while (cp.scrollWidth < w && n < 20) { cp.innerHTML += html; n++; }
    const t = el.querySelector(".tk-in"); t.appendChild(cp.cloneNode(true));
    t.style.animationDuration = Math.max(12, cp.scrollWidth / 90) + "s";
    requestAnimationFrame(room);
  }
  // شاشات العرض (تبقى مفتوحة طوال الفعالية) تعيد التحميل تلقائيًا عند نشر إصدار جديد من المنصة
  let VERSION = null;
  const SCREEN_PAGE = /\/(screen|hack-screen|dashboard|booth)(\.html)?$/.test(location.pathname);
  function checkVersion(c) {
    if (!c || !c.version) return;
    if (VERSION === null) { VERSION = c.version; return; }
    if (c.version !== VERSION && SCREEN_PAGE) location.reload();
  }
  async function refreshConfig() {
    try { const c = await (await window.fetch("api/config", { cache: "no-store" })).json(); ticker(c); checkVersion(c); return c; } catch (e) { return null; }
  }

  const ready = (async () => {
    const m = await mode;
    self.demo = m === "demo";
    const c = await (await window.fetch("api/config", { cache: "no-store" })).json();
    if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r));
    applyTheme(c);
    banner(c); ticker(c); checkVersion(c);
    if (self.demo) demoBadge();
    return c;
  })();

  self.aiReady = aiReady;
  self.setDemoKey = (k) => { try { k ? localStorage.setItem("demo_ai_key", k) : localStorage.removeItem("demo_ai_key"); } catch (e) {} };
  // شاشات العرض: إخفاء العناصر التي لا تتسع كاملة داخل لوحتها، فلا يظهر صف مقطوع
  function fit(list) {
    if (!list) return;
    const kids = [...list.children]; kids.forEach((k) => (k.style.display = ""));
    const panel = list.closest(".panel") || list.parentElement;
    const bottom = panel.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(panel).paddingBottom) || 0);
    for (const k of kids) if (k.getBoundingClientRect().bottom > bottom + 1) k.style.display = "none";
  }
  addEventListener("resize", () => document.querySelectorAll("[data-fit]").forEach(fit));
  // شاشات العرض: لا تُعاد كتابة القائمة (وحركتها) إلا إذا تغيّرت بياناتها، فلا يحدث وميض كل بضع ثوانٍ
  function setHTML(el, html) {
    if (!el) return;
    if (el._h !== html) { el._h = html; el.innerHTML = html; }
    if (el.hasAttribute("data-fit")) fit(el);
  }
  return Object.assign(self, { ready, esc, fmt, short, title, disabled, refreshConfig, fit, setHTML });
})();
