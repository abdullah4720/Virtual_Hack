# يولّد public/icons.js من حزمة lucide-static: python3 demo/icons.py <مسار node_modules/lucide-static>
import re, sys, json, pathlib
src = pathlib.Path(sys.argv[1]) / "icons"
names = open(pathlib.Path(__file__).with_name("icons.txt")).read().split()
out, missing = {}, []
for n in names:
    f = src / f"{n}.svg"
    if not f.exists(): missing.append(n); continue
    body = re.search(r"<svg[^>]*>\s*(.*?)\s*</svg>", f.read_text(), re.S).group(1)
    out[n] = re.sub(r"\s*\n\s*", "", re.sub(r"\s+/>", "/>", body))
js = f"""/*! Lucide icons (ISC License, https://lucide.dev) — مجموعة مختارة مولّدة بـ demo/icons.py */
(function(){{
  var I = {json.dumps(out, ensure_ascii=False, separators=(',', ':'))};
  function svg(n, cls){{ var b = I[n]; if (!b) return null; return '<svg class="lu' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + b + '</svg>'; }}
  // أيقونة باسمها، أو النص كما هو (للرموز القديمة التي أدخلها المستخدم)
  function glyph(v, cls){{ return svg(v, cls) || String(v == null ? '' : v).replace(/[&<>"]/g, function(c){{ return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]; }}); }}
  function fill(root){{ (root || document).querySelectorAll('i[data-icon]:not([data-done])').forEach(function(el){{ var s = svg(el.getAttribute('data-icon')); if (s) {{ el.innerHTML = s; el.setAttribute('data-done', ''); }} }}); }}
  window.ICONS = I; window.icon = svg; window.glyph = glyph; window.fillIcons = fill;
  function start(){{ fill(); new MutationObserver(function(){{ fill(); }}).observe(document.body, {{ childList: true, subtree: true }}); }}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}})();
"""
pathlib.Path(__file__).parent.parent.joinpath("public/icons.js").write_text(js)
print(len(out), "icons", "missing:", missing)
