import type { AttendanceAction, AttendanceStatus, MemberType } from "./types";

export const ROLE_LABEL: Record<MemberType, string> = {
  avrech: "אברך",
  student: "תלמיד",
  employee: "עובד",
  rabbi: "רב",
};

export const ACTION_LABEL: Record<AttendanceAction, string> = {
  check_in: "כניסה",
  check_out: "יציאה",
};

export const STATUS_LABEL: Record<AttendanceStatus, { text: string; tone: "ok" | "warn" | "bad" }> = {
  approved: { text: "אושר", tone: "ok" },
  rejected_distance: { text: "מחוץ לרדיוס", tone: "bad" },
  rejected_accuracy: { text: "GPS לא מדויק", tone: "warn" },
  rejected_sequence: { text: "רצף שגוי", tone: "warn" },
  rejected_inactive: { text: "משתמש מושבת", tone: "bad" },
};

const TZ = "Asia/Jerusalem";

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });

/** YYYY-MM-DD לפי שעון ישראל */
export function dayKey(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** תחילת היום (חצות) בשעון ישראל, כ-ISO */
export function startOfIsraelDay(d: Date = new Date()): string {
  const key = dayKey(d);
  // מחשבים את ההפרש של אזור הזמן באותו יום (כולל שעון קיץ)
  const utcMidnight = new Date(`${key}T00:00:00Z`);
  const local = new Date(utcMidnight.toLocaleString("en-US", { timeZone: TZ }));
  const offset = local.getTime() - utcMidnight.getTime();
  return new Date(utcMidnight.getTime() - offset).toISOString();
}

export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
