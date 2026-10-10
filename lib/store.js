// صفقات المستثمر الذكي
import { insert, select } from "./db.js";

export async function saveDeal(deal) {
  return insert("deals", deal);
}

export async function getFeed() {
  const all = (await select("deals")).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const invested = all.filter((d) => d.decision === "invest");
  // للشاشات: بدون البريد أو نص الفكرة الكامل
  const pub = ({ id, created_at, name, title, investor, decision, amount, equity, valuation, verdict, score, qualified }) =>
    ({ id, created_at, name, title, investor, decision, amount, equity, valuation, verdict, score, qualified });
  return {
    recent: all.slice(0, 20).map(pub),
    top: [...invested].sort((a, b) => b.valuation - a.valuation).slice(0, 10).map(pub),
    stats: {
      pitches: all.length,
      deals: invested.length,
      total: invested.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      qualified: all.filter((d) => d.qualified).length,
    },
  };
}
