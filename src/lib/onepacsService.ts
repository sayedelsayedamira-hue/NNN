import { supabase } from "@/lib/supabase";

export interface OnePacsRecord {
  [key: string]: unknown;
}

export interface OnePacsResult {
  records: OnePacsRecord[];
  total: number;
  start: number;
  limit: number;
}

export interface OnePacsTestResult {
  success: boolean;
  message: string;
  total: number;
}

export interface OnePacsConfigInfo {
  id: number;
  base_url: string;
  username: string;
  worklist_endpoint: string | null;
  enabled: boolean;
  updated_at: string;
}

export interface OnePacsFieldMapping {
  case_patient_name: string;
  case_patient_code: string;
  case_exam_type: string;
  case_exam_name: string;
  case_status: string;
  case_priority: string;
  case_notes: string;
  case_onepacs_study_uid: string;
  case_onepacs_link: string;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
}

export interface OnePacsSyncResult {
  success: boolean;
  message: string;
  synced: number;
  skipped: number;
  total: number;
}

function getFunctionUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  return `${supabaseUrl}/functions/v1/onepacs-proxy`;
}

async function callFunction(payload: Record<string, unknown>): Promise<{ res: Response; data: Record<string, unknown> }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("يجب تسجيل الدخول أولاً");

  const res = await fetch(getFunctionUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return { res, data: data as Record<string, unknown> };
}

export async function getOnePacsConfig(): Promise<OnePacsConfigInfo | null> {
  const { res, data } = await callFunction({ action: "getConfig" });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشل جلب الإعدادات (${res.status})`);
  }
  return (data.config as OnePacsConfigInfo | null) ?? null;
}

export async function saveOnePacsConfig(params: {
  baseUrl: string;
  username: string;
  password: string;
  worklistEndpoint?: string;
  enabled?: boolean;
}): Promise<void> {
  const { res, data } = await callFunction({
    action: "saveConfig",
    baseUrl: params.baseUrl,
    username: params.username,
    password: params.password,
    worklistEndpoint: params.worklistEndpoint ?? "",
    enabled: params.enabled !== false,
  });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشل حفظ الإعدادات (${res.status})`);
  }
}

export async function testOnePacsConnection(): Promise<OnePacsTestResult> {
  const { res, data } = await callFunction({ action: "test" });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشل الاتصال (${res.status})`);
  }
  return data as unknown as OnePacsTestResult;
}

export async function diagnoseOnePacs(): Promise<Record<string, unknown>> {
  const { res, data } = await callFunction({ action: "diagnose" });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشل التشخيص (${res.status})`);
  }
  return data;
}

export async function fetchOnePacsWorklist(params: {
  start?: number;
  limit?: number;
  sort?: string;
  dir?: "ASC" | "DESC";
  search?: string;
}): Promise<OnePacsResult> {
  const { res, data } = await callFunction({
    action: "fetch",
    start: params.start ?? 0,
    limit: params.limit ?? 50,
    sort: params.sort ?? "receivedTime",
    dir: params.dir ?? "DESC",
    search: params.search ?? "",
  });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشل جلب البيانات (${res.status})`);
  }
  return data as unknown as OnePacsResult;
}

export async function getFieldMapping(): Promise<OnePacsFieldMapping | null> {
  const { res, data } = await callFunction({ action: "getMapping" });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشل جلب الربط (${res.status})`);
  }
  return (data.mapping as OnePacsFieldMapping | null) ?? null;
}

export async function saveFieldMapping(mapping: OnePacsFieldMapping): Promise<void> {
  const { res, data } = await callFunction({ action: "saveMapping", mapping });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشل حفظ الربط (${res.status})`);
  }
}

export async function syncOnePacsToCases(): Promise<OnePacsSyncResult> {
  const { res, data } = await callFunction({ action: "sync" });
  if (!res.ok) {
    throw new Error((data.error as string) ?? `فشلت المزامنة (${res.status})`);
  }
  return data as unknown as OnePacsSyncResult;
}
