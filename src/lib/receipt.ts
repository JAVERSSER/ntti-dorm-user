import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Receipt links carry a signature, so a receipt image can only be fetched by
 * the person who just submitted that payment (references alone are short and
 * could be guessed, and the receipt shows the student's name and room).
 */
function sign(reference: string): string {
  return createHmac("sha256", env.supabaseServiceRoleKey).update(`receipt:${reference}`).digest("base64url").slice(0, 32);
}

export function receiptUrl(reference: string): string {
  return `/receipt/${encodeURIComponent(reference)}?sig=${sign(reference)}`;
}

export function verifyReceipt(reference: string, sig: string | null): boolean {
  if (!sig) return false;
  const a = Buffer.from(sign(reference));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
