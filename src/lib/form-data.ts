import "server-only";
import { db } from "./supabase";
import { payableMonths } from "./options";
import { GRADES } from "./options";

export type FormOptions = {
  rooms: string[];
  institutions: string[];
  grades: string[];
  /** Resident roster from admin (Residents page), so students pick their name. */
  residents: { room: string; name: string; grade: string; institution: string }[];
  qrUrl: string;
  /** Months the resident can pay for (the current month only). */
  months: { value: string; label: string }[];
};

/** Default QR (ships with the app); replaced when an admin uploads one in Settings. */
const FALLBACK_QR = "/payment/qr.jpg";

/** Active grades in admin order (Grades page). Falls back to the built-in list. */
export async function getGrades(): Promise<string[]> {
  const { data, error } = await db().from("grades").select("name").eq("is_active", true).order("sort_order").order("name");
  if (error) {
    console.error("[options] grades", error.message);
    return [...GRADES];
  }
  return data.map((g) => g.name as string);
}

export async function getFormOptions(): Promise<FormOptions> {
  const supabase = db();
  const [rooms, institutions, settings, residents, grades] = await Promise.all([
    supabase.from("rooms").select("name").eq("is_active", true).order("name"),
    supabase.from("institutions").select("code, name").eq("is_active", true).order("name"),
    supabase.from("app_settings").select("payment_qr_path").eq("id", 1).maybeSingle(),
    supabase.from("dorm_residents").select("room, full_name, grade, institution").eq("is_active", true).order("full_name").limit(5000),
    getGrades(),
  ]);
  // The roster is optional: if it is missing, the form falls back to typing a name.
  if (residents.error) console.error("[options] residents", residents.error.message);

  // Admins may store a school as its code (ITI) or full name; the form uses the name.
  const schoolName = new Map<string, string>();
  for (const i of institutions.data ?? []) {
    schoolName.set(String(i.code).toLowerCase(), i.name as string);
    schoolName.set(String(i.name).toLowerCase(), i.name as string);
  }
  if (rooms.error) throw rooms.error;
  if (institutions.error) throw institutions.error;

  const qrPath = settings.data?.payment_qr_path as string | null | undefined;
  const qrUrl = qrPath ? supabase.storage.from("payment-qr").getPublicUrl(qrPath).data.publicUrl : FALLBACK_QR;

  return {
    rooms: rooms.data.map((r) => r.name as string),
    institutions: institutions.data.map((i) => i.name as string),
    grades,
    residents: (residents.data ?? []).map((r) => ({
      room: r.room as string,
      name: r.full_name as string,
      grade: (r.grade as string | null) ?? "",
      institution: schoolName.get(String(r.institution ?? "").toLowerCase()) ?? "",
    })),
    qrUrl,
    months: payableMonths(),
  };
}
