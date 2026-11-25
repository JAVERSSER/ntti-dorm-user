import { downloadName } from "@/lib/file-name";
import { getQrUrl } from "@/lib/form-data";

/**
 * The payment QR sent as a file download (Content-Disposition: attachment).
 * Telegram's Android in-app browser cannot save blob: downloads made in the
 * page, but it does download a real URL marked as an attachment, so Android
 * links here instead of opening the image.
 */
export async function GET(request: Request) {
  const qrUrl = new URL(await getQrUrl(), request.url);
  const upstream = await fetch(qrUrl, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new Response("QR image not found", { status: 404 });
  }
  const type = upstream.headers.get("content-type") ?? "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${downloadName(new URL(request.url).searchParams.get("name"), "dormpay-qr")}.${ext}"`,
      "Cache-Control": "no-store",
    },
  });
}
