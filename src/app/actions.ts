"use server";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/supabase";
import { MAX_SLIP_BYTES, payableMonths } from "@/lib/options";
import { getGrades } from "@/lib/form-data";
import { receiptUrl } from "@/lib/receipt";

export type SubmitState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: Partial<Record<"room" | "month" | "student_name" | "grade" | "institution" | "slip", string>> }
  | { status: "success"; reference: string; studentName: string; room: string; monthLabel: string; receiptUrl: string };

/** Detect the real image type from the file's first bytes (never trust the browser's MIME type). */
function sniffImage(bytes: Uint8Array): { ext: string; mime: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", mime: "image/png" };
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

export async function submitPayment(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  // Honeypot: real people never fill this hidden field.
  if (text(formData, "website")) return { status: "error", message: "Could not submit. Please try again." };

  const room = text(formData, "room");
  const month = text(formData, "month");
  const studentName = text(formData, "student_name");
  const grade = text(formData, "grade");
  const institution = text(formData, "institution");
  const slip = formData.get("slip");

  const fields: NonNullable<Extract<SubmitState, { status: "error" }>["fields"]> = {};
  if (!room) fields.room = "Please choose your room.";
  if (!payableMonths().some((m) => m.value === month)) fields.month = "Please choose the month you are paying for.";
  if (studentName.length < 2 || studentName.length > 120) fields.student_name = "Please enter your full name.";
  if (!grade || !(await getGrades()).includes(grade)) fields.grade = "Please choose your grade.";
  if (!institution) fields.institution = "Please choose where you study.";
  if (!(slip instanceof File) || slip.size === 0) fields.slip = "Please upload the screenshot of your payment.";
  else if (slip.size > MAX_SLIP_BYTES) fields.slip = "The image is too large (max 5 MB).";
  if (Object.keys(fields).length) return { status: "error", message: "Please check the highlighted fields.", fields };

  const file = slip as File;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) {
    return { status: "error", message: "Please check the highlighted fields.", fields: { slip: "Only JPG, PNG or WEBP images are allowed." } };
  }

  const supabase = db();

  // Room and institution must be real, active choices.
  const [roomRow, instRow] = await Promise.all([
    supabase.from("rooms").select("name").eq("is_active", true).eq("name", room).maybeSingle(),
    supabase.from("institutions").select("name").eq("is_active", true).eq("name", institution).maybeSingle(),
  ]);
  if (roomRow.error || instRow.error) {
    console.error("[submit] lookup", roomRow.error ?? instRow.error);
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

  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${kind.ext}`;
  const upload = await supabase.storage.from("payment-slips").upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (upload.error) {
    console.error("[submit] upload", upload.error);
    return { status: "error", message: "Could not upload the image. Please try again." };
  }

  const { data, error } = await supabase
    .from("payment_submissions")
    .insert({ room, student_name: studentName, grade, institution, slip_path: path, for_month: `${month}-01` })
    .select("reference")
    .single();
  if (error || !data) {
    console.error("[submit] insert", error);
    await supabase.storage.from("payment-slips").remove([path]);
    return { status: "error", message: "Could not save your payment. Please try again." };
  }

  const monthLabel = payableMonths().find((m) => m.value === month)?.label ?? month;
  const reference = data.reference as string;
  return { status: "success", reference, studentName, room, monthLabel, receiptUrl: receiptUrl(reference) };
}
