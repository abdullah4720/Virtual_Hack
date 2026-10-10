// المستثمر الذكي = مرحلة الفرز: سؤالان، ثم تقييم بمعايير موحّدة، ثم التأهل للهاكاثون أو لا
import { getSettings, phase } from "../lib/settings.js";
import { saveDeal } from "../lib/store.js";
import { select } from "../lib/db.js";
import { createTicket } from "../lib/tickets.js";
import { aiAvailable } from "../lib/ai.js";
import { SCREEN as ENGINE_SCREEN, screenQuestion, screenFinal, quickIdeaCheck, checkIdea, checkAnswer } from "../lib/evaluator.js";
import { checkLimits, recordUse } from "../lib/limits.js";
import { mailEnabled } from "../lib/mailer.js";
import { notify } from "../lib/notify.js";
import { insert, count } from "../lib/db.js";
import { siteUrl } from "../lib/site.js";
import crypto from "node:crypto";

// ---------- التحقق من البريد برمز (اختياري) ----------
const SECRET = (typeof window === "undefined" && (process.env.APP_SECRET || process.env.ADMIN_KEY)) || "dev-secret";
const sha = (x) => crypto.createHash("sha256").update(String(x)).digest("hex");
const signToken = (email, exp) => `${exp}.${crypto.createHmac("sha256", SECRET).update(`${email}|${exp}`).digest("hex").slice(0, 32)}`;
function tokenOk(email, token) {
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return signToken(email, exp) === `${exp}.${sig}`;
}
const verifyOn = (s) => s.investor.verifyEmail && mailEnabled();

async function otpHandler(s, req, res, action) {
  const b = req.body || {};
  const email = clip(b.email, 80).toLowerCase();
  if (!okEmail(email)) return res.status(400).json({ error: "اكتب بريدًا إلكترونيًا صحيحًا" });
  if (action === "otp-send") {
    const recent = await count("otp", { email }, new Date(Date.now() - 600e3).toISOString());
    if (recent >= 3) return res.status(429).json({ error: "أُرسلت رموز كثيرة لهذا البريد. انتظر 10 دقائق." });
    const code = String(crypto.randomInt(100000, 999999));
    await insert("otp", { email, code_hash: sha(`${email}|${code}`), expires_at: new Date(Date.now() + 600e3).toISOString() });
    const ok = (await notify(s, "otp", email, { code })).ok;
    if (!ok) return res.status(503).json({ error: "تعذّر إرسال الرمز، حاول بعد قليل" });
    return res.status(200).json({ sent: true });
  }
  // otp-check
  const rows = (await select("otp", { email })).filter((r) => r.expires_at > new Date().toISOString());
  if (!rows.some((r) => r.code_hash === sha(`${email}|${clip(b.code, 10)}`))) return res.status(400).json({ error: "الرمز غير صحيح أو انتهت صلاحيته" });
  const exp = Date.now() + 3 * 3600e3;
  return res.status(200).json({ token: signToken(email, exp) });
}

const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export const SCREEN = ENGINE_SCREEN.map(({ key, label, max }) => ({ key, label, max }));

const DEMO_Q = ["فكرة جديرة بالاهتمام. من العميل الذي سيدفع مقابل الحل تحديدًا، ولماذا سيدفع؟", "شكرًا على الإجابة. كيف سيحقق المشروع دخلًا، ومن منافسوك الحاليون؟"];
function demoFinal(idea, s) {
  const scores = Object.fromEntries(SCREEN.map((c) => [c.key, Math.round(c.max * (0.35 + Math.random() * 0.6))]));
  const { minAmount: lo, maxAmount: hi } = s.investor;
  return {
    scores,
    amount: Math.round((lo + Math.random() * (hi - lo)) / 50000) * 50000 || lo,
    equity: [10, 15, 20, 25, 30][Math.floor(Math.random() * 5)],
    title: clip(idea, 40),
    verdict_invest: "فكرة واعدة، وأنصح بدعمها بأرقام أوضح عن السوق والتكاليف.",
    verdict_out: "الفكرة جيدة، لكنها تحتاج إلى تحديد العميل الذي سيدفع بوضوح قبل التأهل.",
    strengths: ["الفكرة تحل مشكلة حقيقية", "عرض واضح ومختصر"],
    weaknesses: ["نموذج الربح غير واضح", "العميل الأول غير محدد"],
    tip: "تحدّث مع عشرة عملاء محتملين قبل البدء في بناء الحل.",
  };
}

async function attemptsUsed(email) {
  return (await select("deals", { email })).length;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const s = await getSettings();
    if (!s.modules.investor) return res.status(403).json({ error: "هذا النشاط غير مفعّل حاليًا" });
    const action = new URL(req.url, "http://x").searchParams.get("action");
    if (action === "otp-send" || action === "otp-check") return otpHandler(s, req, res, action);
    const I = s.investor;
    const b = req.body || {};
    const list = I.investors;
    const inv = list.find((x) => x.id === b.investor) || list[Math.floor(Math.random() * list.length)];
    const name = clip(b.name, 40);
    const email = clip(b.email, 80).toLowerCase();
    const idea = clip(b.idea, 500);
    const questions = (b.questions || []).slice(0, 2).map((q) => clip(q, 300));
    const answers = (b.answers || []).slice(0, 2).map((a) => clip(a, 300));
    if (name.length < 2) return res.status(400).json({ error: "يُرجى كتابة اسمك" });
    if (!okEmail(email)) return res.status(400).json({ error: "اكتب بريدًا إلكترونيًا صحيحًا" });
    if (idea.length < 15) return res.status(400).json({ error: "يُرجى توضيح فكرتك أكثر (المشكلة والحل)" });
    if (!b.consent) return res.status(400).json({ error: "يلزم الموافقة على سياسة الخصوصية" });
    if (verifyOn(s) && !tokenOk(email, b.token)) return res.status(401).json({ error: "يُرجى التحقق من بريدك أولًا", needVerify: true });

    const used = await attemptsUsed(email);
    if (used >= I.maxAttempts) return res.status(429).json({ error: `استنفدت محاولاتك (${I.maxAttempts}) بهذا البريد.`, attemptsLeft: 0 });

    const step = answers.length;
    const AI = aiAvailable();
    if (step === 0) {
      const limitMsg = await checkLimits(s, req, "pitch");
      if (limitMsg) return res.status(429).json({ error: limitMsg });
    }
    // ===== التحقق من الفكرة قبل بدء الحوار (لا تُحتسب محاولة) =====
    if (step === 0) {
      const quick = quickIdeaCheck(idea);
      if (quick) return res.status(422).json({ error: quick, needFix: true });
      if (AI) {
        try {
          const c = await checkIdea(s, idea);
          await recordUse(req, "ai");
          if (!c.valid) return res.status(422).json({ error: c.message || "يُرجى توضيح المشكلة والحل المقترح.", needFix: true });
        } catch (e) { console.error("idea check failed", e.message); }
      }
    }

    // ===== التحقق من أن آخر إجابة إجابة حقيقية (يُطلب التوضيح مرة واحدة لكل سؤال) =====
    if (step >= 1) {
      const idx = step - 1;
      const clarified = Array.isArray(b.clarified) ? b.clarified.map(Number) : [];
      if (!clarified.includes(idx)) {
        let verdict = null;
        const quickBad = /^(لا\s*(أعرف|اعرف|أدري|ادري|يوجد|شيء|شي)|ما\s*(أدري|ادري|أعرف|اعرف|عندي|فكرت)|مدري|أي\s*شي|اي\s*شي|كذا|ما\s*أعرف)[\s.!؟?]*$/.test(answers[idx]) || answers[idx].split(/\s+/).length < 2;
        if (quickBad) verdict = { ok: false, message: `شكرًا لك. لم تتضمن إجابتك معلومة تجيب عن السؤال. أرجو أن تجيب بمعلومة محددة ولو تقديرية: ${(questions[idx].match(/[^.!؟?]*[؟?][^.!؟?]*$/) || [questions[idx]])[0].trim()}` };
        else if (AI) {
          try { verdict = await checkAnswer(s, inv, { idea, question: questions[idx], answer: answers[idx] }); await recordUse(req, "ai"); }
          catch (e) { console.error("answer check failed", e.message); }
        }
        if (verdict && !verdict.ok) return res.status(200).json({ step, clarify: idx, message: verdict.message || `أرجو توضيح إجابتك: ${questions[idx]}`, investor: inv.id, attemptsLeft: I.maxAttempts - used });
      }
    }

    if (step < 2) {
      let question;
      if (!AI) question = DEMO_Q[step];
      else {
        try { question = (await screenQuestion(s, inv, { name, idea, questions, answers })).question; }
        catch (e) { console.error("AI question failed", e.message); return res.status(503).json({ error: "الخدمة مشغولة حاليًا. يُرجى المحاولة بعد دقيقة، ولن تُحتسب عليك محاولة.", retry: true }); }
        await recordUse(req, step === 0 ? "pitch" : "ai"); // حد الساعة يُحسب مرة واحدة لكل عرض
      }
      return res.status(200).json({ step: step + 1, question, investor: inv.id, attemptsLeft: I.maxAttempts - used });
    }

    // ===== التقييم النهائي =====
    const { minAmount: lo, maxAmount: hi, qualifyScore } = I;
    let f, ev = null;
    if (!AI) f = demoFinal(idea, s);
    else {
      try { ev = await screenFinal(s, inv, { name, idea, questions, answers, clarified: (Array.isArray(b.clarified) ? b.clarified : []).map(Number) }); f = ev; }
      catch (e) { console.error("AI final failed", e.message); return res.status(503).json({ error: "تعذّر التقييم الآن بسبب ضغط على الخدمة. اضغط «أرسل الإجابة» مرة أخرى بعد دقيقة، ولن تُحسب عليك محاولة.", retry: true }); }
      await recordUse(req, "ai");
    }

    const scores = ev
      ? Object.fromEntries(ev.criteria.map((c) => [c.key, c.points]))
      : Object.fromEntries(SCREEN.map((c) => [c.key, Math.min(c.max, Math.max(0, Math.round(Number(f.scores?.[c.key]) || 0)))]));
    const score = Object.values(scores).reduce((a, n) => a + n, 0);
    const qualified = score >= qualifyScore;
    const decision = qualified ? "invest" : "out";
    const amount = qualified ? Math.min(hi, Math.max(lo, Math.round(Number(f.amount) || lo))) : 0;
    const equity = qualified ? Math.min(49, Math.max(1, Number(f.equity) || 10)) : 0;
    const valuation = qualified ? Math.round((amount * 100) / equity) : 0;
    const result = {
      decision, qualified, score, scores, qualifyScore, amount, equity, valuation,
      criteria: ev ? ev.criteria : SCREEN,
      capsApplied: ev?.capsApplied || [],
      title: clip(f.title, 60),
      verdict: clip(qualified ? f.verdict_invest : f.verdict_out, 250),
      strengths: (f.strengths || []).slice(0, 3).map((x) => clip(x, 120)),
      weaknesses: (f.weaknesses || []).slice(0, 3).map((x) => clip(x, 120)),
      tip: clip(f.tip, 200),
    };

    const deal = await saveDeal({
      name, email, title: result.title, idea, investor: inv.id, decision, amount, equity, valuation,
      verdict: result.verdict, score, scores, qualified, consent_at: new Date().toISOString(),
    });

    // تذكرة التأهل للهاكاثون
    let ticket = null, mail = { ok: false };
    const attemptsLeft = Math.max(0, I.maxAttempts - used - 1);
    const site = siteUrl(req);
    if (qualified && s.modules.hackathon && phase(s) !== "closed") {
      ticket = (await createTicket({ kind: "investor", name, email, deal_id: deal?.id ?? null })).code;
      mail = await notify(s, "qualified", email, { name, idea: result.title, score, qualify: qualifyScore, code: ticket, link: `${site}/hackathon?ticket=${ticket}` });
    } else if (!qualified && AI) {
      // من لم يتأهل: درجته وما ينقصه وأهم ما يحسّنه (لا تُرسل للتقييمات الوهمية)
      const next = (ev?.criteria || []).filter((c) => c.next).sort((a, c) => a.points / a.max - c.points / c.max).map((c) => c.next);
      const tips = [...next, ...result.weaknesses].filter(Boolean).slice(0, 3).map((t) => `• ${t}`).join("\n") || `• ${result.tip}`;
      mail = await notify(s, "notQualified", email, { name, idea: result.title, score, qualify: qualifyScore, missing: qualifyScore - score, tips, attemptsLeft, link: `${site}/` });
    }

    return res.status(200).json({
      step: 3, result, ticket, dealId: deal?.id ?? null,
      attemptsLeft, demo: !AI, emailed: Boolean(mail.ok),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "حدث خطأ غير متوقع. يُرجى المحاولة مرة أخرى." });
  }
}
