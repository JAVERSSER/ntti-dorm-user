"use server";

import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { payableMonths } from "@/lib/options";
import { getGrades, getMonthlyFee } from "@/lib/form-data";
import { createKhqr, newTranId } from "@/lib/payway";
import { syncPayment, type PaymentProgress } from "@/lib/payments";

type Field = "room" | "month" | "student_name" | "grade" | "institution";

export type StartState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: Partial<Record<Field, string>> }
  | { status: "qr"; tranId: string; amount: number; monthLabel: string; studentName: string; qrImageUrl: string; deeplink: string | null; expiresAt: string };

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

/** URL PayWay calls when the QR is paid. Only a public https address works, so localhost gets none (the page polls instead). */
function callbackUrl(): string | null {
  const base = env.appUrl;
  if (!base || !base.startsWith("https://")) return null;
  const token = env.paywayCallbackToken;
  return `${base}/api/payway/callback${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

/** Step 1 → 2: check the student's details, then create a one-time KHQR for the monthly fee. */
export async function startPayment(_prev: StartState, formData: FormData): Promise<StartState> {
  // Honeypot: real people never fill this hidden field.
  if (text(formData, "website")) return { status: "error", message: "Could not continue. Please try again." };

  const room = text(formData, "room");
  const month = text(formData, "month");
  const studentName = text(formData, "student_name");
  const grade = text(formData, "grade");
  const institution = text(formData, "institution");

  const fields: Partial<Record<Field, string>> = {};
  if (!room) fields.room = "Please choose your room.";
  if (!payableMonths().some((m) => m.value === month)) fields.month = "Please choose the month you are paying for.";
  if (studentName.length < 2 || studentName.length > 120) fields.student_name = "Please enter your full name.";
  if (!grade || !(await getGrades()).includes(grade)) fields.grade = "Please choose your grade.";
  if (!institution) fields.institution = "Please choose where you study.";
  if (Object.keys(fields).length) return { status: "error", message: "Please check the highlighted fields.", fields };

  const supabase = db();
  const [roomRow, instRow, fee] = await Promise.all([
    supabase.from("rooms").select("name").eq("is_active", true).eq("name", room).maybeSingle(),
    supabase.from("institutions").select("name").eq("is_active", true).eq("name", institution).maybeSingle(),
    getMonthlyFee().catch((e: Error) => (console.error("[start] fee", e.message), undefined)),
  ]);
  if (roomRow.error || instRow.error || fee === undefined) {
    console.error("[start] lookup", roomRow.error ?? instRow.error);
    return { status: "error", message: "Server error. Please try again in a moment." };
  }
  if (!roomRow.data || !instRow.data) {
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fields: {
        ...(!roomRow.data && { room: "This room is not available. Refresh the page." }),
        ...(!instRow.data && { institution: "This school is not available. Refresh the page." }),
      },
    };
  }
  if (fee === null) return { status: "error", message: "The dormitory fee is not set yet. Please contact the dormitory office." };

  const monthLabel = payableMonths().find((m) => m.value === month)?.label ?? month;
  const tranId = newTranId();
  const lifetime = env.paywayQrLifetimeMinutes;

  let qr;
  try {
    qr = await createKhqr({ tranId, amount: fee, description: `Dormitory fee ${monthLabel} - Room ${room}`, callbackUrl: callbackUrl(), lifetimeMinutes: lifetime });
  } catch (error) {
    console.error("[start] payway", (error as Error).message);
    return { status: "error", message: "Could not create the payment QR. Please try again in a moment." };
  }

  const expiresAt = new Date(Date.now() + lifetime * 60_000).toISOString();
  const { error } = await supabase.from("payway_transactions").insert({
    tran_id: tranId,
    room,
    student_name: studentName,
    grade,
    institution,
    for_month: `${month}-01`,
    amount: fee,
    currency: "USD",
    qr_string: qr.qrString,
    qr_image: qr.qrImage,
    deeplink: qr.deeplink,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[start] insert", error);
    return { status: "error", message: "Could not create the payment QR. Please try again in a moment." };
  }

  return { status: "qr", tranId, amount: fee, monthLabel, studentName, qrImageUrl: `/qr/${tranId}`, deeplink: qr.deeplink, expiresAt };
}

/** Polled by the page while the QR is shown. */
export async function checkPayment(tranId: string): Promise<PaymentProgress> {
  if (typeof tranId !== "string" || !/^[A-Z0-9]{1,20}$/.test(tranId)) return { state: "failed", message: "Unknown payment." };
  try {
    return (await syncPayment(tranId)) ?? { state: "failed", message: "Unknown payment." };
  } catch (error) {
    console.error("[check]", (error as Error).message);
    // Temporary problem (network, PayWay busy): the page simply asks again.
    return { state: "pending", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
}
