import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * ABA PayWay: dynamic KHQR (QR API) and payment status (Check Transaction).
 * Every request is signed with HMAC-SHA512 of the listed fields, in order,
 * using the merchant's API key. Docs: https://developer.payway.com.kh
 */

function sign(...values: (string | number)[]): string {
  return createHmac("sha512", env.paywayApiKey).update(values.join("")).digest("base64");
}

/** PayWay wants UTC time as YYYYMMDDHHmmss. */
function reqTime(now = new Date()): string {
  return now.toISOString().replace(/\D/g, "").slice(0, 14);
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.paywayBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`PayWay ${path} answered ${res.status}: ${text.slice(0, 200)}`);
  }
}

/** Unique transaction id: PayWay allows at most 20 characters. */
export function newTranId(): string {
  const time = Date.now().toString(36).toUpperCase(); // 8 chars
  const rand = randomBytes(6).toString("hex").toUpperCase().slice(0, 10);
  return `DP${time}${rand}`; // 20 chars
}

export type Khqr = { qrString: string; qrImage: string; deeplink: string | null };

/** Create a one-time KHQR for exactly `amount` (USD) that expires after `lifetimeMinutes`. */
export async function createKhqr(input: { tranId: string; amount: number; description: string; callbackUrl?: string | null; lifetimeMinutes: number }): Promise<Khqr> {
  const b = {
    req_time: reqTime(),
    merchant_id: env.paywayMerchantId,
    tran_id: input.tranId,
    amount: Number(input.amount.toFixed(2)),
    items: Buffer.from(JSON.stringify([{ name: input.description, quantity: 1, price: Number(input.amount.toFixed(2)) }])).toString("base64"),
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    purchase_type: "purchase",
    payment_option: "abapay_khqr",
    callback_url: input.callbackUrl ? Buffer.from(input.callbackUrl).toString("base64") : "",
    return_deeplink: "",
    currency: "USD",
    custom_fields: "",
    return_params: "",
    payout: "",
    lifetime: Math.max(3, Math.round(input.lifetimeMinutes)),
    qr_image_template: env.paywayQrTemplate,
  };
  const hash = sign(
    b.req_time, b.merchant_id, b.tran_id, b.amount, b.items, b.first_name, b.last_name, b.email, b.phone,
    b.purchase_type, b.payment_option, b.callback_url, b.return_deeplink, b.currency, b.custom_fields,
    b.return_params, b.payout, b.lifetime, b.qr_image_template,
  );
  const res = await post<{ qrString?: string; qrImage?: string; abapay_deeplink?: string; status?: { code?: string | number; message?: string } }>(
    "/api/payment-gateway/v1/payments/generate-qr",
    { ...b, hash },
  );
  if (!res.qrString || !res.qrImage) {
    throw new Error(`PayWay generate-qr failed: ${res.status?.code ?? "?"} ${res.status?.message ?? ""}`.trim());
  }
  return { qrString: res.qrString, qrImage: res.qrImage, deeplink: res.abapay_deeplink ?? null };
}

export type TransactionStatus =
  | { state: "paid"; amount: number; currency: string; apv: string }
  | { state: "pending" }
  | { state: "failed"; reason: string };

/** Ask PayWay whether this transaction was paid. Never trust anything else (e.g. a callback body). */
export async function checkTransaction(tranId: string): Promise<TransactionStatus> {
  const time = reqTime();
  const res = await post<{
    data?: { payment_status?: string; payment_status_code?: number; payment_amount?: number; total_amount?: number; payment_currency?: string; apv?: string };
    status?: { code?: string | number; message?: string };
  }>("/api/payment-gateway/v1/payments/check-transaction-2", {
    req_time: time,
    merchant_id: env.paywayMerchantId,
    tran_id: tranId,
    hash: sign(time, env.paywayMerchantId, tranId),
  });

  const d = res.data;
  if (!d) {
    // "tran_id not found" right after creation, or a temporary error: keep waiting.
    return { state: "pending" };
  }
  const status = String(d.payment_status ?? "").toUpperCase();
  if (status === "APPROVED" || status === "PRE-AUTH" || d.payment_status_code === 0) {
    return { state: "paid", amount: Number(d.payment_amount || d.total_amount || 0), currency: d.payment_currency || "USD", apv: d.apv ?? "" };
  }
  if (status === "PENDING" || d.payment_status_code === 2) return { state: "pending" };
  return { state: "failed", reason: status || `code ${d.payment_status_code}` };
}
