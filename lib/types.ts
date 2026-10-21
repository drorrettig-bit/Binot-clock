export type MemberType = "avrech" | "student" | "employee" | "rabbi";
export type AccessRole = "member" | "admin";
export type AttendanceAction = "check_in" | "check_out";
export type AttendanceStatus =
  | "approved"
  | "rejected_distance"
  | "rejected_accuracy"
  | "rejected_sequence"
  | "rejected_inactive"
  | "voided";

export interface Profile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  national_id: string | null;
  member_type: MemberType | null;
  access_role: AccessRole;
  is_active: boolean;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  full_name: string;
  onboarding_completed: boolean;
  created_at: string;
}

export interface OrgSettings {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  allowed_radius_m: number;
  max_gps_accuracy_m: number;
  min_seconds_between_reports: number;
  timezone: string;
  notification_retention_days?: number;
}

export interface AttendanceLog {
  id: number;
  user_id: string;
  action: AttendanceAction;
  status: AttendanceStatus;
  source: "gps" | "admin_manual";
  recorded_at: string;
  note: string | null;
}

export interface SearchRow {
  log_id: number;
  user_id: string;
  national_id: string | null;
  full_name: string;
  member_type: MemberType | null;
  is_active: boolean;
  action: AttendanceAction;
  status: AttendanceStatus;
  source: "gps" | "admin_manual";
  recorded_at: string;
  distance_m: number | null;
  note: string | null;
  total_count: number;
}

export interface DailyRow {
  user_id: string;
  national_id: string | null;
  first_name: string | null;
  last_name: string | null;
  member_type: MemberType | null;
  is_active: boolean;
  work_date: string;
  first_in: string | null;
  last_out: string | null;
  total_minutes: number;
  missing_checkout: boolean;
}

export interface ReportResult {
  id: number;
  status: AttendanceStatus;
  action: AttendanceAction;
  recorded_at: string;
  /** רק למנהלים */
  distance_m?: number;
  /** רק למנהלים */
  allowed_radius_m?: number;
}
