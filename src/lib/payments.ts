import "server-only";
import { db } from "./supabase";
import { checkTransaction } from "./payway";
import { payableMonths } from "./options";
import { receiptUrl } from "./receipt";

export type PaidResult = { reference: string; studentName: string; room: string; monthLabel: string; receiptUrl: string };

export type PaymentProgress =
  | { state: "pending"; expiresAt: string }
  | { state: "expired" }
  | { state: "failed"; message: string }
  | ({ state: "paid" } & PaidResult);

type TxRow = {
  tran_id: string;
  room: string;
  student_name: string;
  grade: string;
  institution: string;
  for_month: string;
  amount: number | string;
  currency: string;
  status: "pending" | "paid" | "failed";
  submission_id: string | null;
  expires_at: string;
};

function monthLabel(forMonth: string): string {
  const ym = forMonth.slice(0, 7);
  const known = payableMonths().find((m) => m.value === ym);
  if (known) return known.label;
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

async function paidResult(tx: TxRow, submissionId: string): Promise<PaymentProgress> {
  const { data, error } = await db().from("payment_submissions").select("reference").eq("id", submissionId).single();
  if (error || !data) throw error ?? new Error("submission not found");
  const reference = data.reference as string;
  return { state: "paid", reference, studentName: tx.student_name, room: tx.room, monthLabel: monthLabel(tx.for_month), receiptUrl: receiptUrl(reference) };
}

/**
 * Check a PayWay transaction and, once PayWay says it is paid for the right
 * amount, record it as an approved payment submission. Safe to call many times
 * and at the same time (the page polls it, the PayWay callback calls it too).
 */
export async function syncPayment(tranId: string): Promise<PaymentProgress | null> {
  const supabase = db();
  const { data: tx, error } = await supabase.from("payway_transactions").select("*").eq("tran_id", tranId).maybeSingle<TxRow>();
  if (error) throw error;
  if (!tx) return null;

  if (tx.status === "paid" && tx.submission_id) return paidResult(tx, tx.submission_id);
  if (tx.status === "failed") return { state: "failed", message: "This payment was not completed. Please create a new QR." };

  const status = await checkTransaction(tranId);

  if (status.state === "pending") {
    // A little grace after expiry: a payment made in the last seconds may still be confirming.
    return Date.parse(tx.expires_at) + 60_000 < Date.now() ? { state: "expired" } : { state: "pending", expiresAt: tx.expires_at };
  }
  if (status.state === "failed") {
    await supabase.from("payway_transactions").update({ status: "failed" }).eq("tran_id", tranId).eq("status", "pending");
    return { state: "failed", message: "This payment was not completed. Please create a new QR." };
  }

  const expected = Number(tx.amount);
  if (status.currency.toUpperCase() !== tx.currency.toUpperCase() || Math.abs(status.amount - expected) > 0.001) {
    console.error("[payway] amount mismatch", { tranId, expected, got: status.amount, currency: status.currency });
    await supabase.from("payway_transactions").update({ status: "failed" }).eq("tran_id", tranId).eq("status", "pending");
    return { state: "failed", message: "The amount paid does not match the fee. Please contact the dormitory office." };
  }

  const now = new Date().toISOString();
  const insert = await supabase
    .from("payment_submissions")
    .insert({
      room: tx.room,
      student_name: tx.student_name,
      grade: tx.grade,
      institution: tx.institution,
      for_month: tx.for_month,
      slip_path: null,
      status: "approved",
      reviewed_at: now,
      admin_note: `Paid with ABA PayWay KHQR · ${expected.toFixed(2)} ${tx.currency}${status.apv ? ` · APV ${status.apv}` : ""}`,
      amount: expected,
      currency: tx.currency,
      payway_tran_id: tranId,
      payway_apv: status.apv || null,
      paid_at: now,
    })
    .select("id")
    .single();

  let submissionId = insert.data?.id as string | undefined;
  if (insert.error) {
    // 23505: another request recorded this transaction first; use that row.
    if (insert.error.code !== "23505") throw insert.error;
    const existing = await supabase.from("payment_submissions").select("id").eq("payway_tran_id", tranId).single();
    if (existing.error) throw existing.error;
    submissionId = existing.data.id as string;
  }

  await supabase.from("payway_transactions").update({ status: "paid", submission_id: submissionId }).eq("tran_id", tranId);
  return paidResult(tx, submissionId!);
}

/** Escape a value for an exact, case-insensitive ILIKE match. */
function ilikeExact(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type StudentMonth = { room: string; studentName: string; forMonth: string /* YYYY-MM-01 */ };

/**
 * Comparison key for a person's name: case, extra spaces and word order are
 * ignored, so "Sok Dara", "sok  dara" and "Dara Sok" are the same student.
 */
export function nameKey(name: string): string {
  return name.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
}

/** The approved payment this student already has for this month, if any. */
export async function findPaidForMonth(q: StudentMonth): Promise<{ reference: string } | null> {
  const { data, error } = await db()
    .from("payment_submissions")
    .select("reference, student_name")
    .eq("status", "approved")
    .eq("for_month", q.forMonth)
    .ilike("room", ilikeExact(q.room))
    .limit(1000);
  if (error) throw error;
  const key = nameKey(q.studentName);
  const hit = data.find((r) => nameKey(r.student_name as string) === key);
  return hit ? { reference: hit.reference as string } : null;
}

/**
 * The resident list's spelling of a name typed for this room, or the typed
 * name itself when nobody in that room matches it.
 */
export async function rosterName(room: string, typed: string): Promise<string> {
  const { data, error } = await db().from("dorm_residents").select("full_name").eq("is_active", true).ilike("room", ilikeExact(room)).limit(500);
  if (error) {
    console.error("[roster name]", error.message); // the list is optional: keep what was typed
    return typed;
  }
  const key = nameKey(typed);
  return (data.find((r) => nameKey(r.full_name as string) === key)?.full_name as string | undefined) ?? typed;
}

/** How far back unconfirmed QRs are re-checked with PayWay (the admin cleanup deletes them after 7 days). */
const RECHECK_DAYS = 3;

/**
 * Re-check QRs that are still "pending" in our database. A student may pay and
 * close the page before it sees the payment (and without a public callback URL
 * PayWay cannot tell us), so this records any such payment. Pass a student and
 * month to check only theirs; without it, every recent pending QR is checked.
 * Returns how many were found paid.
 */
export async function syncPendingPayments(only?: StudentMonth): Promise<number> {
  const since = new Date(Date.now() - RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let query = db().from("payway_transactions").select("tran_id, student_name").eq("status", "pending").gte("created_at", since);
  if (only) {
    query = query.eq("for_month", only.forMonth).ilike("room", ilikeExact(only.room));
  }
  const { data: rows, error } = await query.order("created_at", { ascending: true }).limit(500);
  if (error) throw error;
  const key = only && nameKey(only.studentName);
  const data = key ? rows.filter((r) => nameKey(r.student_name as string) === key) : rows;

  let paid = 0;
  for (const row of data) {
    try {
      const res = await syncPayment(row.tran_id as string);
      if (res?.state === "paid") paid++;
    } catch (e) {
      console.error("[sync pending]", row.tran_id, (e as Error).message); // try again next time
    }
  }
  return paid;
}
