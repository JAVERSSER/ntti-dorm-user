import { downloadName } from "@/lib/file-name";
import { db } from "@/lib/supabase";

/**
 * The one-time PayWay KHQR for a transaction, as a PNG file download
 * (Content-Disposition: attachment). Telegram's Android in-app browser cannot
 * save blob: downloads made in the page, but it does download a real URL marked
 * as an attachment. Transaction ids are random, and the QR only lets someone pay.
 */
export async function GET(request: Request, { params }: { params: Promise<{ tranId: string }> }) {
  const { tranId } = await params;
  if (!/^[A-Z0-9]{1,20}$/.test(tranId)) return new Response("Not found", { status: 404 });

  const { data, error } = await db().from("payway_transactions").select("qr_image").eq("tran_id", tranId).maybeSingle();
  if (error) {
    console.error("[qr]", error.message);
    return new Response("Server error", { status: 500 });
  }
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec((data?.qr_image as string | undefined) ?? "");
  if (!match) return new Response("QR image not found", { status: 404 });

  const [, type, base64] = match;
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return new Response(Buffer.from(base64, "base64"), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${downloadName(new URL(request.url).searchParams.get("name"), "dormpay-qr")}.${ext}"`,
      "Cache-Control": "private, max-age=3600, immutable",
    },
  });
}
