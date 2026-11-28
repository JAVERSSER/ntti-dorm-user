import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { downloadName } from "@/lib/file-name";
import { verifyReceipt } from "@/lib/receipt";
import { db } from "@/lib/supabase";

/** Khmer names need a Khmer font; Latin text keeps the built-in font. Loaded once. */
let khmerFonts: Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]> | null = null;
function loadKhmerFonts() {
  khmerFonts ??= Promise.all(
    ([["Regular", 400], ["Bold", 700]] as const).map(async ([file, weight]) => ({
      name: "Noto Sans Khmer",
      data: await readFile(path.join(process.cwd(), "src/assets/fonts", `NotoSansKhmer-${file}.ttf`)),
      weight,
      style: "normal" as const,
    })),
  );
  return khmerFonts;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatMonth(forMonth: string) {
  const [y, m] = forMonth.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? ""} ${y}`;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Phnom_Penh",
  }).format(new Date(iso));
}

/**
 * The payment receipt as a PNG file download (Content-Disposition: attachment),
 * so phones save it instead of opening it — same approach as /qr/[tranId].
 */
export async function GET(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const query = new URL(request.url).searchParams;
  const sig = query.get("sig");
  if (!verifyReceipt(reference, sig)) return new Response("Not found", { status: 404 });

  const { data, error } = await db()
    .from("payment_submissions")
    .select("reference, room, student_name, grade, institution, for_month, created_at, status, amount, currency, paid_at")
    .eq("reference", reference)
    .maybeSingle();
  if (error) {
    console.error("[receipt]", error.message);
    return new Response("Server error", { status: 500 });
  }
  if (!data) return new Response("Not found", { status: 404 });

  const rows: [string, string][] = [
    ["Student", data.student_name as string],
    ["Room", data.room as string],
    ["Grade", data.grade as string],
    ["Student at", data.institution as string],
    ["Month paid", formatMonth(String(data.for_month))],
    ...(data.amount != null ? ([["Amount", `${Number(data.amount).toFixed(2)} ${data.currency ?? "USD"}`]] as [string, string][]) : []),
    [data.paid_at ? "Paid" : "Submitted", formatTime((data.paid_at ?? data.created_at) as string)],
  ];
  // PayWay payments are confirmed on the spot; older screenshot payments wait for the office.
  const confirmed = data.status === "approved";

  const fonts = await loadKhmerFonts();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f8fafc", padding: 48, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "white", borderRadius: 32, border: "2px solid #e2e8f0", padding: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ width: 72, height: 72, borderRadius: 36, background: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 44, fontWeight: 700, color: "#0f172a" }}>{confirmed ? "Payment received" : "Payment submitted"}</div>
              <div style={{ fontSize: 26, color: "#64748b" }}>DormPay · Dormitory fee receipt</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 44, padding: 28, borderRadius: 24, background: "#eff5ff" }}>
            <div style={{ fontSize: 26, color: "#475569" }}>Reference</div>
            <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: 6, color: "#1c3f9c" }}>{data.reference as string}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
            {rows.map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "18px 0", borderBottom: "2px solid #f1f5f9", fontSize: 30 }}>
                <div style={{ color: "#64748b" }}>{label}</div>
                <div style={{ color: "#0f172a", fontWeight: 600, maxWidth: 560, textAlign: "right" }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto", fontSize: 22, color: "#94a3b8", textAlign: "center", display: "flex", justifyContent: "center" }}>
            {data.paid_at ? "Paid with ABA KHQR · confirmed by ABA PayWay." : confirmed ? "Approved by the dormitory office." : "Waiting for the dormitory office to check your payment."}
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts,
      headers: {
        "Content-Disposition": `attachment; filename="${downloadName(query.get("name"), `dormpay-receipt-${reference}`)}.png"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
