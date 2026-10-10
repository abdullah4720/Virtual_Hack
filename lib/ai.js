// استدعاء Claude وإرجاع JSON
// على الخادم: مفتاح ANTHROPIC_API_KEY.
// في المتصفح (نسخة العرض التجريبية): حساب Claude للمشاهد عبر الرابط المنشور، أو مفتاح يُدخل في لوحة التحكم.
const isBrowser = typeof window !== "undefined";
const ENV_KEY = isBrowser ? null : process.env.ANTHROPIC_API_KEY;

export const MODEL = (!isBrowser && process.env.ANTHROPIC_MODEL) || "claude-sonnet-5-5"; // للمحادثة والأسئلة
export const EVAL_MODEL = (!isBrowser && process.env.ANTHROPIC_EVAL_MODEL) || "claude-opus-5-5"; // للتقييم: الأقوى

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
export async function askJSON(system, user, maxTokens = 800, temperature, opts = {}) {
  const model = opts.model === "eval" ? EVAL_MODEL : MODEL;
  const p = browserProvider();

  // حساب Claude الخاص بالمشاهد (الرابط المنشور): لا يدعم ملفات PDF، فيُرسل النص فقط
  if (!ENV_KEY && p?.sample) {
    const text = Array.isArray(user) ? user.filter((c) => c.type === "text").map((c) => c.text).join("\n\n") : user;
    const out = await p.sample.json(`${system}\n\n---\n\n${text}`, {
      modelTier: opts.model === "eval" ? "complex" : "default",
      cache: false,
    });
    return typeof out === "string" ? parseJSON(out) : out;
  }

  const key = ENV_KEY || p?.key;
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  if (!ENV_KEY) headers["anthropic-dangerous-direct-browser-access"] = "true";
  const body = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
  if (temperature != null) body.temperature = temperature;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return parseJSON(data.content.map((c) => c.text || "").join(""));
}

// توافق مع الكود القديم
export const API_KEY = ENV_KEY;
