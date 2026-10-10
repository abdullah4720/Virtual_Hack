// الشعارات: رابط https، أو صورة مرفوعة من لوحة التحكم مخزّنة في الإعدادات بمفتاح logo:<id>
import { getSetting, putSetting, hasDb } from "./db.js";

export const LOGO_RE = /^logo:[a-f0-9]{12}$/;
const DATA_RE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;

export async function storeLogo(data) {
  if (!DATA_RE.test(data || "")) throw new Error("صيغة الصورة غير مدعومة");
  if (data.length > 700000) throw new Error("حجم الشعار كبير، الرجاء استخدام صورة أصغر");
  const id = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  await putSetting(`logo:${id}`, data);
  return `logo:${id}`;
}

// قائمة الشعارات بروابط صالحة للعرض. base: رابط الموقع (للبريد) أو فارغ للصفحات
export async function resolveLogos(s, base = "") {
  const out = [];
  for (const l of s.brand?.logos || []) {
    let url = l.src;
    if (LOGO_RE.test(l.src)) url = hasDb ? `${base ? base + "/" : ""}api/config?logo=${l.src.slice(5)}` : await getSetting(l.src);
    if (url) out.push({ name: l.name || "", url, mono: l.mono !== false });
  }
  return out;
}

// إرسال صورة مخزّنة (من api/config?logo=)
export async function serveLogo(id, res) {
  const data = /^[a-f0-9]{12}$/.test(id || "") ? await getSetting(`logo:${id}`) : null;
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(data || "");
  if (!m) return res.status(404).end("not found");
  res.setHeader("Content-Type", m[1]);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).end(Buffer.from(m[2], "base64"));
}
