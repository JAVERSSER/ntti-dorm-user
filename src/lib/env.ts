import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/** Read lazily so `next build` works without secrets present. Server only. */
export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL").replace(/\/+$/, "");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
};
