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
