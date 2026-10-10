// إعدادات البرنامج: تُقرأ من قاعدة البيانات، وتُدمج مع القيم الافتراضية
import { DEFAULTS } from "./defaults.js";
import { getSetting, putSetting, hasDb } from "./db.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return clone(base);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

let cache = { v: null, t: 0 };
// ترقية تلقائية: الشخصيات والنصوص الافتراضية القديمة (العامية) تُستبدل بالجديدة الرسمية، وما عدّله المنظّم يبقى كما هو
const OLD_NAMES = { skeptic: "أبو فهد", numbers: "د. نورة", hype: "سلطان" };
// الرموز التعبيرية القديمة ← أيقونات Lucide
const EMOJI_ICON = { "🌴": "sprout", "🎓": "graduation-cap", "🏙️": "building-2", "💡": "lightbulb", "💼": "briefcase-business", "🧐": "briefcase-business", "📊": "chart-column", "🚀": "rocket", "🧑‍💼": "briefcase-business", "👩‍🏫": "presentation", "👨‍💼": "lightbulb", "🏥": "heart-pulse", "♻️": "recycle", "🌱": "sprout", "💰": "coins", "🤖": "bot", "📚": "book-open", "🏛️": "landmark", "🚗": "car", "⚡": "zap" };
const toIcon = (v) => EMOJI_ICON[v] || v;
function upgrade(st) {
  if (st?.brand) {
    if (st.brand.accent === "#f5b83d") st.brand.accent = DEFAULTS.brand.accent;
    if (st.brand.bg === "#0b1020") st.brand.bg = DEFAULTS.brand.bg;
  }
  if (Array.isArray(st?.hackathon?.tracks)) st.hackathon.tracks = st.hackathon.tracks.map((t) => ({ ...t, icon: toIcon(t.icon) }));
  if (Array.isArray(st?.investor?.investors)) st.investor.investors = st.investor.investors.map((x) => ({ ...x, emoji: toIcon(x.emoji) }));
  // إزالة الرموز التعبيرية من بداية عناوين الجوائز وموضوعات الرسائل المحفوظة سابقًا
  const noEmoji = (t) => (typeof t === "string" ? t.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "") : t);
  if (Array.isArray(st?.program?.prizes)) st.program.prizes = st.program.prizes.map((x) => ({ ...x, place: noEmoji(x.place) }));
  if (st?.notify?.templates) for (const t of Object.values(st.notify.templates)) if (t && t.subject) t.subject = noEmoji(t.subject);
  const I = st?.investor;
  if (!I) return st;
  if (Array.isArray(I.investors)) I.investors = I.investors.map((x) => {
    const d = DEFAULTS.investor.investors.find((y) => y.id === x.id);
    return d && OLD_NAMES[x.id] === x.name ? { ...d } : x;
  });
  if (typeof I.tagline === "string" && /يطلع/.test(I.tagline)) I.tagline = DEFAULTS.investor.tagline;
  if (Array.isArray(I.problems) && I.problems.some((p) => /يدورون موقف|الأكل الزايد/.test(p))) I.problems = DEFAULTS.investor.problems;
  return st;
}
export async function getSettings() {
  if (cache.v && Date.now() - cache.t < 5000) return cache.v;
  const stored = await getSetting("app");
  cache = { v: merge(DEFAULTS, upgrade(stored) || {}), t: Date.now() };
  return cache.v;
}

// ---------- مفاتيح الدخول ----------
export const ADMIN_KEY = process.env.ADMIN_KEY || (hasDb ? null : "admin");
export async function judgeKey() {
  const s = await getSettings();
  return s.hackathon.judgeKey || process.env.JUDGE_KEY || (hasDb ? null : "demo");
}

// ---------- التواريخ والمرحلة ----------
export function toDate(local, tz) {
  if (!local) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(local) ? local : `${local}:00${tz || "+03:00"}`);
  return Number.isFinite(t) ? t : null;
}
export function phase(s, now = Date.now()) {
  const o = toDate(s.hackathon.opensAt, s.brand.tzOffset);
  const c = toDate(s.hackathon.closesAt, s.brand.tzOffset);
  if (o && now < o) return "soon";
  if (c && now > c) return "closed";
  return "open";
}

// ---------- المسارات والتحديات ----------
// كل خيار يختاره الفريق = مسار + تحدٍّ (أو المسار وحده إن لم تكن له تحديات)
export function options(s) {
  const out = [];
  for (const t of s.hackathon.tracks) {
    if (t.challenges?.length) for (const c of t.challenges) out.push({ track: t, challenge: c });
    else out.push({ track: t, challenge: null });
  }
  return out;
}
export function findOption(s, trackId, challengeId) {
  return options(s).find((o) => o.track.id === trackId && (o.challenge?.id ?? null) === (challengeId || null)) || null;
}
export function optionLabel(s, trackId, challengeId) {
  const o = findOption(s, trackId, challengeId);
  if (!o) return "";
  return o.challenge ? `${o.track.title} · ${o.challenge.title}` : o.track.title;
}

// ---------- ما يُرسل للمتصفح (بدون أسرار أو تعليمات الذكاء الاصطناعي) ----------
export function publicSettings(s) {
  const p = clone(s);
  delete p.hackathon.judgeKey;
  delete p.notify;
  p.hackathon.judgesCount = (p.hackathon.judges || []).length;
  delete p.hackathon.judges;
  p.investor.investors = p.investor.investors.map(({ persona, style, ...rest }) => rest);
  p.hackathon.phase = phase(s);
  p.hackathon.opensAtMs = toDate(s.hackathon.opensAt, s.brand.tzOffset);
  p.hackathon.closesAtMs = toDate(s.hackathon.closesAt, s.brand.tzOffset);
  return p;
}

// ---------- التحقق والحفظ ----------
const str = (v, n, d = "") => (v == null ? d : String(v).trim().slice(0, n));
const int = (v, min, max, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const slug = (v, i, prefix) => str(v, 30).replace(/[^\w-]/g, "") || `${prefix}${i + 1}`;
const uniq = (arr) => {
  const seen = new Set();
  return arr.map((x) => {
    let id = x.id, n = 2;
    while (seen.has(id)) id = `${x.id}-${n++}`;
    seen.add(id);
    return { ...x, id };
  });
};

export function sanitize(input) {
  const s = merge(DEFAULTS, input || {});
  const errors = [];
  const b = s.brand;
  const out = {
    brand: {
      orgName: str(b.orgName, 80),
      eventName: str(b.eventName, 120),
      boothName: str(b.boothName, 80),
      logoUrl: /^https?:\/\/\S+$/i.test(str(b.logoUrl, 500)) ? str(b.logoUrl, 500) : "",
      accent: /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : DEFAULTS.brand.accent,
      bg: /^#[0-9a-f]{6}$/i.test(b.bg) ? b.bg : DEFAULTS.brand.bg,
      tzOffset: /^[+-]\d\d:\d\d$/.test(b.tzOffset) ? b.tzOffset : "+03:00",
    },
    modules: { investor: Boolean(s.modules.investor), hackathon: Boolean(s.modules.hackathon) },
    booth: {
      rotateSeconds: int(s.booth.rotateSeconds, 8, 300, 25),
      mode: ["rotate", "investor", "hackathon", "dashboard", "countdown", "announcement"].includes(s.booth.mode) ? s.booth.mode : "rotate",
      screens: { investor: s.booth.screens?.investor !== false, hackathon: s.booth.screens?.hackathon !== false, dashboard: s.booth.screens?.dashboard !== false },
    },
    limits: {
      pitchesPerHour: int(s.limits?.pitchesPerHour, 1, 1000, 15),
      submitsPerHour: int(s.limits?.submitsPerHour, 1, 1000, 20),
      dailyAiCalls: int(s.limits?.dailyAiCalls, 10, 1000000, 3000),
    },
    program: {
      about: str(s.program?.about, 1000),
      schedule: (s.program?.schedule || []).slice(0, 14).map((x) => ({ day: str(x.day, 40), title: str(x.title, 80), desc: str(x.desc, 300) })).filter((x) => x.title),
      prizes: (s.program?.prizes || []).slice(0, 10).map((x) => ({ place: str(x.place, 40), title: str(x.title, 80), desc: str(x.desc, 300) })).filter((x) => x.title),
      faq: (s.program?.faq || []).slice(0, 20).map((x) => ({ q: str(x.q, 200), a: str(x.a, 800) })).filter((x) => x.q),
      partners: (s.program?.partners || []).slice(0, 20).map((x) => ({ name: str(x.name, 80), logoUrl: /^https?:\/\/\S+$/i.test(str(x.logoUrl, 500)) ? str(x.logoUrl, 500) : "" })).filter((x) => x.name),
    },
    privacy: { text: str(s.privacy?.text, 5000), contact: str(s.privacy?.contact, 200) },
    notify: {
      members: s.notify?.members !== false,
      reminders: {
        closeOn: Boolean(s.notify?.reminders?.closeOn),
        closeHours: int(s.notify?.reminders?.closeHours, 1, 168, 24),
        noSubmitOn: Boolean(s.notify?.reminders?.noSubmitOn),
        noSubmitHours: int(s.notify?.reminders?.noSubmitHours, 1, 168, 12),
      },
      // القوالب المعروفة فقط، وما فرغ منها يعود للنص الافتراضي
      templates: Object.fromEntries(Object.entries(DEFAULTS.notify.templates).map(([k, d]) => {
        const t = s.notify?.templates?.[k] || {};
        return [k, {
          on: k === "otp" ? true : t.on !== false,
          subject: str(t.subject, 200) || d.subject,
          title: str(t.title, 200) || d.title,
          body: str(t.body, 3000) || d.body,
          cta: str(t.cta, 60),
        }];
      })),
    },
    investor: {
      title: str(s.investor.title, 60) || DEFAULTS.investor.title,
      tagline: str(s.investor.tagline, 300),
      minAmount: int(s.investor.minAmount, 1000, 1e9, 100000),
      maxAmount: int(s.investor.maxAmount, 1000, 1e9, 2000000),
      qualifyScore: int(s.investor.qualifyScore, 0, 100, 60),
      maxAttempts: int(s.investor.maxAttempts, 1, 20, 3),
      verifyEmail: Boolean(s.investor.verifyEmail),
      investors: uniq(
        (s.investor.investors || []).slice(0, 8).map((x, i) => ({
          id: slug(x.id, i, "inv"),
          name: str(x.name, 40),
          title: str(x.title, 60),
          emoji: str(x.emoji, 40) || "briefcase-business",
          desc: str(x.desc, 120),
          persona: str(x.persona, 1500),
          style: str(x.style, 600),
        }))
      ).filter((x) => x.name),
      problems: (s.investor.problems || []).map((p) => str(p, 200)).filter(Boolean).slice(0, 50),
    },
    hackathon: {
      name: str(s.hackathon.name, 60) || DEFAULTS.hackathon.name,
      tagline: str(s.hackathon.tagline, 300),
      opensAt: str(s.hackathon.opensAt, 25),
      closesAt: str(s.hackathon.closesAt, 25),
      maxMembers: int(s.hackathon.maxMembers, 1, 10, 3),
      maxAttempts: int(s.hackathon.maxAttempts, 1, 10, 3),
      finalists: int(s.hackathon.finalists, 1, 50, 5),
      weights: { ai: int(s.hackathon.weights?.ai, 0, 100, 40), judges: 0 },
      judgeKey: str(s.hackathon.judgeKey, 80),
      judges: uniq((s.hackathon.judges || []).slice(0, 50).map((j, i) => ({
        id: slug(j.id, i, "judge"),
        name: str(j.name, 60),
        email: str(j.email, 100),
        key: str(j.key, 40),
        tracks: (Array.isArray(j.tracks) ? j.tracks : []).map((t) => str(t, 30)).filter(Boolean),
      }))).filter((j) => j.name && j.key),
      resultsPublished: Boolean(s.hackathon.resultsPublished),
      registration: s.hackathon.registration === "open" ? "open" : "ticket",
      evaluation: { reviewPass: s.hackathon.evaluation?.reviewPass !== false },
      uploads: {
        deckRequired: Boolean(s.hackathon.uploads?.deckRequired),
        aiReadsDeck: Boolean(s.hackathon.uploads?.aiReadsDeck),
        deckMaxMB: int(s.hackathon.uploads?.deckMaxMB, 1, 30, 15),
        extraFiles: int(s.hackathon.uploads?.extraFiles, 0, 10, 3),
        extraMaxMB: int(s.hackathon.uploads?.extraMaxMB, 1, 50, 10),
      },
      tracks: uniq(
        (s.hackathon.tracks || []).slice(0, 12).map((t, i) => ({
          id: slug(t.id, i, "track"),
          icon: str(t.icon, 40) || "lightbulb",
          title: str(t.title, 80),
          desc: str(t.desc, 400),
          challenges: uniq(
            (t.challenges || []).slice(0, 12).map((c, j) => ({ id: slug(c.id, j, "ch"), title: str(c.title, 80), desc: str(c.desc, 400) }))
          ).filter((c) => c.title),
        }))
      ).filter((t) => t.title),
      rubric: uniq(
        (s.hackathon.rubric || []).slice(0, 10).map((r, i) => ({
          id: slug(r.key, i, "c"),
          label: str(r.label, 60),
          max: int(r.max, 1, 100, 10),
          guide: str(r.guide, 300),
        }))
      )
        .filter((r) => r.label)
        .map(({ id, ...r }) => ({ key: id, ...r })),
    },
  };
  out.hackathon.weights.judges = 100 - out.hackathon.weights.ai;

  if (out.investor.minAmount > out.investor.maxAmount) errors.push("الحد الأدنى للاستثمار أكبر من الحد الأعلى");
  if (out.modules.investor && !out.investor.investors.length) errors.push("أضف مستثمرًا واحدًا على الأقل");
  if (out.modules.hackathon && !out.hackathon.tracks.length) errors.push("أضف مسارًا واحدًا على الأقل للهاكاثون");
  if (!out.hackathon.rubric.length) errors.push("أضف معيار تقييم واحدًا على الأقل");
  const sum = out.hackathon.rubric.reduce((a, r) => a + r.max, 0);
  if (sum !== 100) errors.push(`مجموع درجات المعايير يجب أن يساوي 100 (المجموع الحالي ${sum})`);
  const tz = out.brand.tzOffset;
  for (const [k, label] of [["opensAt", "موعد الفتح"], ["closesAt", "موعد الإقفال"]])
    if (out.hackathon[k] && toDate(out.hackathon[k], tz) == null) errors.push(`${label} غير صحيح`);
  const o = toDate(out.hackathon.opensAt, tz), c = toDate(out.hackathon.closesAt, tz);
  if (o && c && o >= c) errors.push("موعد الإقفال يجب أن يكون بعد موعد الفتح");
  return { settings: out, errors };
}

export async function saveSettings(input) {
  const { settings, errors } = sanitize(input);
  if (errors.length) return { ok: false, errors };
  await putSetting("app", settings);
  cache = { v: null, t: 0 };
  return { ok: true, settings };
}
