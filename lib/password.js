// كلمات المرور: PBKDF2-SHA256 عبر WebCrypto (يعمل على الخادم وفي النسخة التجريبية)
const ITER = 120000;
const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));

async function derive(password, salt, iter) {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(String(password).normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  return globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}

export async function hashPassword(password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(await derive(password, salt, ITER))}`;
}

export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2" || !hash) return false;
  const got = hex(await derive(password, unhex(salt), Number(iter)));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// قواعد كلمة المرور: 8 أحرف على الأقل
export function passwordProblem(p) {
  const s = String(p || "");
  if (s.length < 8) return "كلمة المرور يجب ألا تقل عن 8 أحرف";
  if (s.length > 100) return "كلمة المرور طويلة جدًا";
  return null;
}
