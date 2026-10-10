// حدود الاستخدام: لكل جهاز في الساعة، وسقف يومي لاستدعاءات الذكاء الاصطناعي
import { insert, count } from "./db.js";

export const USAGE = "usage";

export function clientIp(req) {
  const h = req.headers || {};
  return String(h["x-forwarded-for"] || h["x-real-ip"] || "local").split(",")[0].trim().slice(0, 64);
}

const hourAgo = () => new Date(Date.now() - 3600e3).toISOString();
const todayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

// هوية الجهاز: معرّف يولّده المتصفح (لأن أجهزة شبكة المعرض قد تشترك في عنوان IP واحد)، وإلا عنوان IP
export function clientKey(req) {
  const d = String((req.headers || {})["x-device-id"] || "").replace(/[^\w-]/g, "").slice(0, 40);
  return d.length >= 12 ? `dev:${d}` : clientIp(req);
}
// جهاز الجناح (الكشك) معفى من حد الساعة لأنه يخدم زوارًا كثيرين — يبقى السقف اليومي
const isKiosk = (s, req) => Boolean(s.booth?.kioskKey) && (req.headers || {})["x-kiosk-key"] === s.booth.kioskKey;

// kind: "pitch" | "submit"  —  يرجع رسالة خطأ أو null
export async function checkLimits(s, req, kind) {
  const ip = clientKey(req);
  const perHour = kind === "submit" ? s.limits.submitsPerHour : s.limits.pitchesPerHour;
  const [mine, today] = await Promise.all([count(USAGE, { ip, kind }, hourAgo()), count(USAGE, {}, todayStart())]);
  if (today >= s.limits.dailyAiCalls) return "بلغت المنصة حدّها اليومي من التقييمات. الرجاء المحاولة غدًا أو مراجعة المنظمين.";
  if (mine >= perHour && !isKiosk(s, req)) return "محاولات كثيرة من هذا الجهاز خلال ساعة. الرجاء الانتظار قليلًا ثم المحاولة مرة أخرى.";
  return null;
}

export async function recordUse(req, kind, calls = 1) {
  const ip = clientKey(req);
  for (let i = 0; i < calls; i++) await insert(USAGE, { ip, kind });
}

export async function usageToday() {
  return count(USAGE, {}, todayStart());
}
