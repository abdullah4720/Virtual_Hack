// تذاكر التأهل للهاكاثون: تُمنح لمن تأهل في المستثمر الذكي، أو يولّدها المنظّم كرموز دعوة
import { insert, select, update } from "./db.js";

export const TICKETS = "tickets";
const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = (n = 6) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => A[b % A.length]).join("");

export async function createTicket({ kind, name = "", email = "", deal_id = null, label = "" }) {
  const existing = new Set((await select(TICKETS)).map((t) => t.code));
  let c;
  do c = code(); while (existing.has(c));
  return insert(TICKETS, { code: c, kind, name, email, deal_id, label, used_by_team: null });
}

export async function findTicket(c) {
  const [t] = await select(TICKETS, { code: String(c || "").trim().toUpperCase().slice(0, 10) });
  return t || null;
}

export const useTicket = (t, teamId) => update(TICKETS, t.id, { used_by_team: teamId, used_at: new Date().toISOString() });
