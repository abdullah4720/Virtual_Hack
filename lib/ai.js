// استدعاء Claude وإرجاع JSON
// على الخادم: مفتاح ANTHROPIC_API_KEY.
// في المتصفح (نسخة العرض التجريبية): حساب Claude للمشاهد عبر الرابط المنشور، أو مفتاح يُدخل في لوحة التحكم.
const isBrowser = typeof window !== "undefined";
const ENV_KEY = isBrowser ? null : (String(process.env.ANTHROPIC_API_KEY || "").trim() || null); // يتجاهل المسافات والأسطر الزائدة عند اللصق

// مساحة العمل: مطلوبة فقط إن كان المفتاح غير مرتبط بمساحة عمل (مفاتيح على مستوى المؤسسة)
const WORKSPACE = isBrowser ? null : (String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim() || null);

export const MODEL = (!isBrowser && String(process.env.ANTHROPIC_MODEL || "").trim()) || "claude-sonnet-5-5"; // للمحادثة والأسئلة
export const EVAL_MODEL = (!isBrowser && String(process.env.ANTHROPIC_EVAL_MODEL || "").trim()) || "claude-opus-5-5"; // للتقييم: الأقوى

function browserProvider() {
  if (!isBrowser) return null;
  const p = globalThis.__AI_PROVIDER;
  return p && (p.sample || p.key) ? p : null;
}

// هل يوجد ذكاء اصطناعي حقيقي؟ (وإلا تعمل الردود التجريبية)
export function aiAvailable() {
  return Boolean(ENV_KEY || browserProvider());
}
export function aiMode() {
  if (ENV_KEY) return "server";
  const p = browserProvider();
  return p ? (p.sample ? "claude-account" : "browser-key") : "none";
}

function parseJSON(text) {
  const t = String(text);
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("AI reply had no JSON");
  return JSON.parse(t.slice(a, b + 1));
}

// user: نص، أو مصفوفة محتوى (مثل PDF + نص)
// opts: { maxTokens, temperature, model: "chat" | "eval" }
// غلاف موثوق: يعيد المحاولة عند الضغط المؤقت، ويتحول لنموذج المحادثة إن تعذّر نموذج التقييم
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (e) => !e.status || e.status === 429 || e.status >= 500 || e.truncated || /JSON/i.test(e.message);
export async function askJSON(system, user, maxTokens = 800, temperature, opts = {}) {
  const primary = opts.model === "eval" ? EVAL_MODEL : MODEL;
  try {
    return await askOnce(system, user, maxTokens, temperature, primary);
  } catch (e) {
    if (e.status === 401 || e.status === 403 || /workspace|credit balance/i.test(e.body || "")) throw e;
    console.error(`AI ${primary} failed, retrying:`, String(e.message).slice(0, 300));
    await sleep(1200);
    const fallback = primary !== MODEL ? MODEL : primary; // التقييم: جرّب نموذج المحادثة
    // الرد المقطوع: نضاعف حد الطول
    try { return await askOnce(system, user, e.truncated ? maxTokens * 2 : maxTokens, temperature, transient(e) ? primary : fallback); }
    catch (e2) {
      if (fallback === primary) throw e2;
      console.error(`AI ${primary} failed twice, falling back to ${fallback}`);
      return askOnce(system, user, maxTokens * 2, temperature, fallback);
    }
  }
}

export async function askOnce(system, user, maxTokens, temperature, model) {
  const p = browserProvider();

  // حساب Claude الخاص بالمشاهد (الرابط المنشور): لا يدعم ملفات PDF، فيُرسل النص فقط
  if (!ENV_KEY && p?.sample) {
    const text = Array.isArray(user) ? user.filter((c) => c.type === "text").map((c) => c.text).join("\n\n") : user;
    const out = await p.sample.json(`${system}\n\n---\n\n${text}`, {
      modelTier: model === EVAL_MODEL ? "complex" : "default",
      cache: false,
    });
    return typeof out === "string" ? parseJSON(out) : out;
  }

  const key = ENV_KEY || p?.key;
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  if (!ENV_KEY) headers["anthropic-dangerous-direct-browser-access"] = "true";
  if (ENV_KEY && WORKSPACE) headers["anthropic-workspace-id"] = WORKSPACE;
  const body = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
  if (temperature != null) body.temperature = temperature;
  let r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) {
    let text = await r.text();
    // بعض النماذج لا تقبل ضبط temperature: نعيد المحاولة بدونه
    if (r.status === 400 && body.temperature != null && /temperature/i.test(text)) {
      delete body.temperature;
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) text = await r.text();
    }
    if (!r.ok) { const e = new Error(`Anthropic ${r.status}: ${text}`); e.status = r.status; e.body = text; throw e; }
  }
  const data = await r.json();
  const text = (data.content || []).map((c) => c.text || "").join("");
  try { return parseJSON(text); }
  catch (e) {
    const err = new Error(data.stop_reason === "max_tokens" ? "AI reply truncated (max_tokens)" : "AI reply had invalid JSON");
    err.truncated = data.stop_reason === "max_tokens";
    throw err;
  }
}

// توافق مع الكود القديم
export const API_KEY = ENV_KEY;

// تشخيص لوحة التحكم: سبب الفشل بلغة واضحة
export function explainAiError(e) {
  const s = e?.status, t = String(e?.body || e?.message || "");
  if (/not scoped to a workspace|anthropic-workspace-id/i.test(t)) return "مفتاح Claude غير مرتبط بمساحة عمل. أنشئ مفتاحًا من داخل مساحة عمل وضعه بدل المفتاح الحالي، أو أضف متغير مساحة العمل في Vercel، ثم أعد النشر.";
  if (/workspace.*(not found|invalid)/i.test(t)) return "معرّف مساحة العمل في ANTHROPIC_WORKSPACE_ID غير صحيح، أو لا يتبع لنفس حساب المفتاح.";
  if (s === 401 || /authentication|invalid x-api-key/i.test(t)) return "مفتاح ANTHROPIC_API_KEY غير صحيح. انسخه من جديد من console.anthropic.com وأعد النشر.";
  if (/credit balance|billing|purchase credits/i.test(t)) return "رصيد حساب Claude API غير كافٍ. اشحن الرصيد من Billing في console.anthropic.com.";
  if (s === 403 || /permission/i.test(t)) return "المفتاح لا يملك صلاحية لهذا النموذج أو مساحة العمل.";
  if (s === 404 || /not_found|model/i.test(t) && s === 400) return "اسم النموذج غير متاح لحسابك. اضبط ANTHROPIC_MODEL و ANTHROPIC_EVAL_MODEL باسم نموذج متاح.";
  if (s === 429) return "تجاوزت حد الطلبات أو الإنفاق في حساب Claude API. راجع Limits في console.anthropic.com.";
  if (s === 529 || s >= 500) return "خدمة Claude مزدحمة مؤقتًا. جرّب بعد قليل.";
  if (/fetch failed|ENOTFOUND|ECONN/i.test(t)) return "تعذّر الاتصال بخدمة Claude من الخادم.";
  return "خطأ غير متوقع: " + t.slice(0, 200);
}
