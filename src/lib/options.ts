/** Fallback grades, used only if the admin-managed "grades" table cannot be read. */
export const GRADES = ["Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "C1", "C2", "C3"] as const;

/** Largest screenshot accepted (bytes). Must stay under next.config bodySizeLimit. */
export const MAX_SLIP_BYTES = 5 * 1024 * 1024;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Months a resident may pay for: only the current month (Phnom Penh time).
 * Values are YYYY-MM. Computed on the server and checked again on submit.
 */
export function payableMonths(now = new Date()): { value: string; label: string }[] {
  const ym = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Phnom_Penh" }).format(now).slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  return [0].map((ahead) => {
    const d = new Date(Date.UTC(y, m - 1 + ahead, 1));
    const yy = d.getUTCFullYear();
    const mm = d.getUTCMonth() + 1;
    const name = `${MONTH_NAMES[mm - 1]} ${yy}`;
    return { value: `${yy}-${String(mm).padStart(2, "0")}`, label: name };
  });
}
