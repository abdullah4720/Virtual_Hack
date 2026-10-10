// إرسال البريد عبر Resend (اختياري). إن لم يُضبط RESEND_API_KEY لا يُرسل شيء ولا يتعطل النظام.
const isBrowser = typeof window !== "undefined";
const KEY = isBrowser ? null : process.env.RESEND_API_KEY;
const FROM = isBrowser ? null : process.env.MAIL_FROM; // مثال: "الهاكاثون <noreply@your-domain.com>"

export const mailEnabled = () => Boolean(KEY && FROM);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// الشعارات في البريد: روابط https مباشرة، والمرفوعة تتطلب SITE_URL
function mailLogos(s) {
  const site = (isBrowser ? "" : process.env.SITE_URL || "").replace(/\/$/, "");
  const urls = (s.brand.logos || []).map((l) => (/^https?:/.test(l.src) ? l.src : site && /^logo:/.test(l.src) ? `${site}/api/config?logo=${l.src.slice(5)}` : null)).filter(Boolean);
  return urls.length ? `<div style="margin-bottom:10px">${urls.map((u) => `<img src="${esc(u)}" alt="" style="max-height:44px;max-width:160px;margin-left:14px;vertical-align:middle">`).join("")}</div>` : "";
}

export function layout(s, title, bodyHtml, cta) {
  const accent = s.brand.accent || "#f5b83d";
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f4f5f9;font-family:Tahoma,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:16px;padding:24px;border-top:5px solid ${accent};text-align:right;line-height:1.9;color:#1a1f36">
      ${mailLogos(s)}
      <div style="color:#6b7280;font-size:13px">${esc(s.brand.orgName)} · ${esc(s.brand.eventName)}</div>
      <h2 style="margin:8px 0 12px;font-size:20px">${esc(title)}</h2>
      ${bodyHtml}
      ${cta ? `<p style="margin-top:20px"><a href="${esc(cta.url)}" style="background:${accent};color:#14110a;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:bold;display:inline-block">${esc(cta.label)}</a></p>` : ""}
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px">رسالة آلية من منصة ${esc(s.brand.eventName)}</p>
  </div></body></html>`;
}

export const codeBox = (code) =>
  `<div style="font-family:monospace;font-size:30px;letter-spacing:6px;font-weight:bold;background:#f4f5f9;border-radius:12px;padding:12px;text-align:center;direction:ltr">${esc(code)}</div>`;

// يرجع {ok, error} لتسجيل سبب الفشل
export async function sendMailDetailed(to, subject, html) {
  if (!mailEnabled()) return { ok: false, error: "البريد غير مفعّل" };
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return { ok: false, error: "لا يوجد مستلم" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: list, subject, html }),
    });
    if (!r.ok) { const t = await r.text(); console.error("mail failed", r.status, t); return { ok: false, error: `${r.status}: ${t.slice(0, 200)}` }; }
    return { ok: true };
  } catch (e) {
    console.error("mail error", e.message);
    return { ok: false, error: e.message };
  }
}

export async function sendMail(to, subject, html) {
  return (await sendMailDetailed(to, subject, html)).ok;
}

export { esc as escHtml };
