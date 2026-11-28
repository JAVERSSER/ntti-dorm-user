import { timingSafeEqual } from "node:crypto";
import { syncPendingPayments } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job (Vercel Cron, see vercel.json): asks PayWay about every recent QR
 * still "pending" in the database and records the ones that were paid, so a
 * payment is never lost when the student closed the page right after paying.
 * Call with header  Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });

  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const paid = await syncPendingPayments();
    return Response.json({ ok: true, paid });
  } catch (error) {
    console.error("[cron sync-payments]", (error as Error).message);
    return Response.json({ ok: false, error: "Sync failed; see server logs" }, { status: 500 });
  }
}
