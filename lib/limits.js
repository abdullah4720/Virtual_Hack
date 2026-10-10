// حدود الاستخدام: لكل جهاز في الساعة، وسقف يومي لاستدعاءات الذكاء الاصطناعي
import { insert, count } from "./db.js";

export const USAGE = "usage";

export function clientIp(req) {
  const h = req.headers || {};
  return String(h["x-forwarded-for"] || h["x-real-ip"] || "local").split(",")[0].trim().slice(0, 64);
}

const hourAgo = () => new Date(Date.now() - 3600e3).toISOString();
const todayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

// kind: "pitch" | "submit"  —  يرجع رسالة خطأ أو null
export async function checkLimits(s, req, kind) {
  const ip = clientIp(req);
  const perHour = kind === "submit" ? s.limits.submitsPerHour : s.limits.pitchesPerHour;
  const [mine, today] = await Promise.all([count(USAGE, { ip, kind }, hourAgo()), count(USAGE, {}, todayStart())]);
  if (today >= s.limits.dailyAiCalls) return "المنصة وصلت حدّها اليومي من التقييمات. حاول غدًا أو راجع المنظمين.";
  if (mine >= perHour) return "محاولات كثيرة من هذا الجهاز خلال ساعة. انتظر قليلًا ثم حاول مرة أخرى.";
  return null;
}

export async function recordUse(req, kind, calls = 1) {
  const ip = clientIp(req);
  for (let i = 0; i < calls; i++) await insert(USAGE, { ip, kind });
}

export async function usageToday() {
  return count(USAGE, {}, todayStart());
}
