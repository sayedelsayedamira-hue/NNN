import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export type UserRole = "admin" | "coordinator" | "doctor" | "viewer";

export interface AppUser {
  id: string;
  name: string;
  mobile: string;
  role: UserRole;
  specialty: string | null;
  technical_notes: string | null;
  status: string;
  created_at: string;
  last_login: string | null;
}

export interface User {
  id: string;
  name: string;
  mobile: string;
  role: UserRole;
  specialty: string | null;
  technical_notes: string | null;
  status: string;
  created_at: string;
  last_login: string | null;
}

export interface Case {
  id: string;
  patient_name: string;
  patient_code: string;
  exam_type: string;
  exam_name: string | null;
  created_at: string;
  doctor_id: string | null;
  assigned_doctor_id: string | null;
  priority: CasePriority;
  status: CaseStatus;
  notes: string | null;
  onepacs_study_uid: string | null;
  onepacs_link: string | null;
  doctor?: User | null;
}

export interface DoctorSchedule {
  id: string;
  doctor_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  doctor?: User | null;
}

export type CaseStatus = "pending" | "in_progress" | "finished";
export type CasePriority = "routine" | "urgent" | "critical";

export const EXAM_TYPES = [
  "MR",
  "CT",
  "Xray",
  "US",
];

export const STATUS_OPTIONS: { value: CaseStatus; label: string; color: string }[] = [
  { value: "pending", label: "قيد الانتظار", color: "amber" },
  { value: "in_progress", label: "قيد التنفيذ", color: "blue" },
  { value: "finished", label: "مكتمل", color: "emerald" },
];

export const PRIORITY_OPTIONS: { value: CasePriority; label: string; color: string }[] = [
  { value: "routine", label: "روتيني", color: "slate" },
  { value: "urgent", label: "عاجل", color: "orange" },
  { value: "critical", label: "حرج", color: "red" },
];

export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "مسؤول" },
  { value: "coordinator", label: "منسق" },
  { value: "doctor", label: "طبيب" },
  { value: "viewer", label: "مشاهد" },
];

export const DAYS_OF_WEEK: { value: string; label: string }[] = [
  { value: "saturday", label: "السبت" },
  { value: "sunday", label: "الأحد" },
  { value: "monday", label: "الإثنين" },
  { value: "tuesday", label: "الثلاثاء" },
  { value: "wednesday", label: "الأربعاء" },
  { value: "thursday", label: "الخميس" },
  { value: "friday", label: "الجمعة" },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "مسؤول",
  coordinator: "منسق",
  doctor: "طبيب",
  viewer: "مشاهد",
};
