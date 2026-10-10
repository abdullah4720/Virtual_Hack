// إعدادات الاتصال بـ Supabase (مشتركة بين قاعدة البيانات والملفات)
const env = typeof process !== "undefined" ? process.env : {};
// يقبل الرابط بأي صيغة نسخه المستخدم: مع /rest/v1 أو / في آخره
export const SB_URL = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/(rest|storage|auth)\/v1$/, "");
export const SB_KEY = String(env.SUPABASE_SERVICE_KEY || "").trim();

// المفاتيح الجديدة (sb_secret_...) تُرسل في apikey فقط لأنها ليست JWT، والقديمة (service_role) في الاثنين
export const sbAuth = () => (SB_KEY.startsWith("sb_") ? { apikey: SB_KEY } : { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` });

// تنبيه إن وُضع المفتاح العام بدل السري (لن تعمل الكتابة لأن الجداول محمية)
function jwtRole(k) {
  try { return JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()).role; } catch { return null; }
}
export const keyProblem = !SB_KEY ? null
  : SB_KEY.startsWith("sb_publishable_") || jwtRole(SB_KEY) === "anon"
    ? "المفتاح المضبوط في SUPABASE_SERVICE_KEY هو المفتاح العام (publishable/anon). ضع المفتاح السري (sb_secret_... أو service_role) من Supabase ← Settings ← API Keys."
    : null;
