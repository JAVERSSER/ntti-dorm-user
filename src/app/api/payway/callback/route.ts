import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { syncPayment } from "@/lib/payments";

function tokenOk(given: string | null): boolean {
  const expected = env.paywayCallbackToken;
  if (!expected) return true; // no token configured: rely on the re-check with PayWay below
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * PayWay calls this (callback_url) when a KHQR is paid. The body is only used
 * for its tran_id: the payment itself is always confirmed by asking PayWay
 * (syncPayment → Check Transaction), so a forged call cannot mark anything paid.
 */
export async function POST(request: Request) {
  if (!tokenOk(new URL(request.url).searchParams.get("token"))) return new Response("Forbidden", { status: 403 });

  let tranId = "";
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      tranId = String(((await request.json()) as { tran_id?: unknown }).tran_id ?? "");
    } else {
      tranId = String((await request.formData()).get("tran_id") ?? "");
    }
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!/^[A-Z0-9]{1,20}$/.test(tranId)) return new Response("Bad request", { status: 400 });

  try {
    const result = await syncPayment(tranId);
    if (!result) return new Response("Not found", { status: 404 });
    return Response.json({ ok: true, state: result.state });
  } catch (error) {
    console.error("[payway callback]", (error as Error).message);
    return new Response("Server error", { status: 500 }); // PayWay retries
  }
}
