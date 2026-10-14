// صفقات المستثمر الذكي
import { insert, select } from "./db.js";

export async function saveDeal(deal) {
  return insert("deals", deal);
}

export async function getFeed() {
  const all = (await select("deals")).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const invested = all.filter((d) => d.decision === "invest");
  // للشاشات: بدون البريد أو نص الفكرة الكامل
  // لا تُعرض مبالغ: الشاشات تعتمد على درجة الفكرة من 100 وقرار التأهل فقط
  const pub = ({ id, created_at, name, title, investor, decision, verdict, score, qualified }) =>
    ({ id, created_at, name, title, investor, decision, verdict, score: Number(score) || 0, qualified });
  return {
    recent: all.slice(0, 20).map(pub),
    // شخص واحد مرة واحدة في «أعلى التقييمات» (بأعلى محاولاته) حتى لا يتكرر اسمه بدرجات مختلفة
    top: [...invested].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || Date.parse(a.created_at) - Date.parse(b.created_at))
      .filter(((seen) => (d) => { const k = (d.email || "").toLowerCase() || `#${d.id}`; if (seen.has(k)) return false; seen.add(k); return true; })(new Set()))
      .slice(0, 10).map(pub),
    stats: {
      pitches: all.length,
      deals: invested.length,
      avgScore: all.length ? Math.round(all.reduce((s, d) => s + (Number(d.score) || 0), 0) / all.length) : 0,
      qualified: all.filter((d) => d.qualified).length,
    },
  };
}
