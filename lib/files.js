// تخزين الملفات: Supabase Storage عند النشر (رفع مباشر من المتصفح)، وذاكرة مؤقتة للتجربة المحلية
import { hasDb } from "./db.js";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "hackathon";
const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const mem = globalThis.__mem || (globalThis.__mem = {});
const isBrowser = typeof window !== "undefined";

const rand = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
const encPath = (key) => key.split("/").map(encodeURIComponent).join("/");

// أنواع الملفات المسموحة
export const TYPES = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
export const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
export function safeName(name) {
  const ext = extOf(name);
  // مسار التخزين بأحرف إنجليزية فقط (Supabase يرفض الأحرف العربية في المسار)؛ الاسم الأصلي يُحفظ للعرض
  const base = String(name).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "file";
  return `${base}.${ext}`;
}

// ---------- إنشاء رابط رفع ----------
export async function createUpload(key) {
  if (hasDb) {
    const r = await fetch(`${SB}/storage/v1/object/upload/sign/${BUCKET}/${encPath(key)}`, { method: "POST", headers: auth });
    if (!r.ok) throw new Error(`upload sign ${r.status}: ${await r.text()}`);
    const { url } = await r.json();
    return { url: `${SB}/storage/v1${url}`, mode: "supabase" };
  }
  const token = rand();
  (mem.__uploads ||= {})[key] = token;
  return { url: `api/files?action=put&key=${encodeURIComponent(key)}&t=${token}`, mode: "local" };
}

// ---------- الرفع المحلي (للتجربة فقط) ----------
async function toDataURL(blob) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
}
export async function putLocal(key, token, body, type) {
  if (hasDb) throw new Error("local upload disabled");
  if (!token || mem.__uploads?.[key] !== token) throw new Error("bad token");
  delete mem.__uploads[key];
  let size, data;
  if (isBrowser) {
    size = body.size;
    // في نسخة العرض التجريبية نحفظ الملفات الصغيرة فقط (مساحة المتصفح محدودة)
    data = size <= 1.5 * 1024 * 1024 ? await toDataURL(body) : null;
  } else {
    size = body.length;
    data = body.toString("base64");
  }
  (mem.__files ||= {})[key] = { size, type, data };
  return { size };
}

// ---------- معلومات وروابط ----------
export async function stat(key) {
  if (hasDb) {
    const r = await fetch(`${SB}/storage/v1/object/authenticated/${BUCKET}/${encPath(key)}`, { method: "HEAD", headers: auth });
    if (!r.ok) return null;
    return { size: Number(r.headers.get("content-length")) || 0 };
  }
  const f = mem.__files?.[key];
  return f ? { size: f.size } : null;
}

export async function signedUrl(key, seconds = 3600) {
  if (hasDb) {
    const r = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${encPath(key)}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: seconds }),
    });
    if (!r.ok) return null;
    const { signedURL } = await r.json();
    return `${SB}/storage/v1${signedURL}`;
  }
  const f = mem.__files?.[key];
  if (!f) return null;
  if (isBrowser) return f.data; // data: URL أو null إن كان الملف كبيرًا
  const t = rand();
  (mem.__downloads ||= {})[t] = key;
  return `api/files?action=get&t=${t}`;
}

export function getLocal(token) {
  const key = mem.__downloads?.[token];
  const f = key && mem.__files?.[key];
  return f ? { ...f, name: key.split("/").pop() } : null;
}

// مصدر PDF لإرساله إلى Claude
export async function pdfSource(key) {
  if (hasDb) {
    const url = await signedUrl(key, 900);
    return url ? { type: "url", url } : null;
  }
  const f = mem.__files?.[key];
  if (!f?.data) return null;
  const b64 = isBrowser ? f.data.split(",")[1] : f.data;
  return { type: "base64", media_type: "application/pdf", data: b64 };
}

export async function remove(key) {
  if (hasDb) {
    await fetch(`${SB}/storage/v1/object/${BUCKET}/${encPath(key)}`, { method: "DELETE", headers: auth });
    return;
  }
  if (mem.__files) delete mem.__files[key];
}
