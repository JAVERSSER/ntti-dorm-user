import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Read lazily so `next build` works without secrets present. Server only. */
export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL").replace(/\/+$/, "");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // ---- ABA PayWay ----
  get paywayMerchantId() {
    return required("PAYWAY_MERCHANT_ID");
  },
  /** PayWay "Public Key": the secret used to sign (HMAC-SHA512) every request. */
  get paywayApiKey() {
    return required("PAYWAY_API_KEY");
  },
  get paywayBaseUrl() {
    return (optional("PAYWAY_BASE_URL") ?? "https://checkout-sandbox.payway.com.kh").replace(/\/+$/, "");
  },
  get paywayQrTemplate() {
    return optional("PAYWAY_QR_TEMPLATE") ?? "template3_color";
  },
  /** How long a generated QR can be paid (minutes, at least 3). */
  get paywayQrLifetimeMinutes() {
    const n = Number(optional("PAYWAY_QR_LIFETIME_MINUTES"));
    return Number.isFinite(n) && n >= 3 ? Math.round(n) : 15;
  },
  /** Secret part of the callback URL, so random visitors cannot trigger it (it is re-checked with PayWay anyway). */
  get paywayCallbackToken() {
    return optional("PAYWAY_CALLBACK_TOKEN");
  },
  /** Public https URL of this app; PayWay can only call back to a public address. */
  get appUrl() {
    return optional("APP_URL")?.replace(/\/+$/, "") ?? null;
  },
};
