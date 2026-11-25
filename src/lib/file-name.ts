/**
 * File name for a download, from the page's ?name= (e.g. "dormpay-qr_2").
 * Only letters, digits, "-" and "_" are kept; anything else falls back.
 */
export function downloadName(requested: string | null, fallback: string): string {
  const clean = (requested ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return clean || fallback;
}
