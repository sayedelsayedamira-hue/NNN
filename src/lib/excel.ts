import * as XLSX from "xlsx";
import type { Case, CaseStatus, CasePriority } from "./supabase";
import { STATUS_OPTIONS, PRIORITY_OPTIONS, EXAM_TYPES } from "./supabase";

export interface ImportedCaseRow {
  patient_name: string;
  patient_code: string;
  exam_type: string;
  exam_name: string;
  assigned_doctor_name: string;
  priority: CasePriority;
  status: CaseStatus;
  notes: string;
  created_at: string | null;
  _errors: string[];
}

const STATUS_MAP: Record<string, CaseStatus> = {
  "pending": "pending", "قيد الانتظار": "pending", "انتظار": "pending", "قيد الانتظار ": "pending",
  "in_progress": "in_progress", "قيد التنفيذ": "in_progress", "تنفيذ": "in_progress", "جاري": "in_progress", "قيد التنفيذ ": "in_progress", "in progress": "in_progress",
  "finished": "finished", "مكتمل": "finished", "منتهي": "finished", "مغلق": "finished", "مكتملة": "finished", "منتهية": "finished", "مغلق ": "finished",
};

const PRIORITY_MAP: Record<string, CasePriority> = {
  "routine": "routine", "روتيني": "routine", "عادي": "routine", "روتينية": "routine",
  "urgent": "urgent", "عاجل": "urgent", "عاجلة": "urgent",
  "critical": "critical", "حرج": "critical", "طارئ": "critical", "حرجة": "critical", "طارئة": "critical",
};

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    // Excel serial date number
    const date = XLSX.SSF ? new Date(Math.round((value - 25569) * 86400 * 1000)) : new Date(value);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

export async function parseCasesFromExcel(file: File): Promise<ImportedCaseRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (rawRows.length === 0) return [];

  const headerKeys = Object.keys(rawRows[0]);
  const normalizedHeaders = headerKeys.map(normalizeKey);

  const findField = (...names: string[]): unknown => {
    for (const name of names) {
      const norm = normalizeKey(name);
      const idx = normalizedHeaders.findIndex((h) => h === norm || h.includes(norm) || norm.includes(h));
      if (idx >= 0) {
        const key = headerKeys[idx];
        return rawRows.map((r) => r[key]).flat()[0];
      }
    }
    return undefined;
  };

  const rows: ImportedCaseRow[] = [];

  for (const raw of rawRows) {
    const get = (...names: string[]): string => {
      for (const name of names) {
        const norm = normalizeKey(name);
        const idx = normalizedHeaders.findIndex((h) => h === norm || h.includes(norm) || norm.includes(h));
        if (idx >= 0) {
          const key = headerKeys[idx];
          const val = raw[key];
          if (val !== undefined && val !== null) {
            const str = String(val).trim().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
            if (str) return str;
          }
        }
      }
      return "";
    };

    const patientName = get("اسم المريض", "المريض", "patient_name", "name");
    const patientCode = get("كود المريض", "الكود", "patient_code", "code");
    const examTypeRaw = get("نوع الفحص", "exam_type", "type");
    const examName = get("اسم الفحص", "exam_name");
    const doctorName = get("الطبيب المسؤول", "الطبيب", "doctor", "assigned_doctor_name");
    const priorityRaw = get("الأولوية", "priority");
    const statusRaw = get("الحالة", "status");
    const notes = get("ملاحظات", "notes");
    const dateRaw = get("تاريخ الإنشاء", "التاريخ", "created_at", "date");

    const errors: string[] = [];
    if (!patientName) errors.push("اسم المريض مفقود");
    if (!patientCode) errors.push("كود المريض مفقود");

    const examType = examTypeRaw;
    if (examType && !EXAM_TYPES.some((t) => t.toLowerCase() === examType.toLowerCase())) {
      errors.push(`نوع الفحص "${examType}" غير معروف`);
    }

    const priority = PRIORITY_MAP[priorityRaw.toLowerCase().trim()] ?? PRIORITY_MAP[priorityRaw.trim()] ?? null;
    if (priorityRaw && !priority) {
      errors.push(`الأولوية "${priorityRaw}" غير معروفة`);
    }

    const status = STATUS_MAP[statusRaw.toLowerCase().trim()] ?? STATUS_MAP[statusRaw.trim()] ?? null;
    if (statusRaw && !status) {
      errors.push(`الحالة "${statusRaw}" غير معروفة`);
    }

    const parsedDate = parseExcelDate(dateRaw || get("تاريخ", "date"));

    rows.push({
      patient_name: patientName,
      patient_code: patientCode,
      exam_type: examType || EXAM_TYPES[0],
      exam_name: examName,
      assigned_doctor_name: doctorName,
      priority: priority ?? "routine",
      status: status ?? "pending",
      notes,
      created_at: parsedDate,
      _errors: errors,
    });
  }

  return rows;
}

export function downloadImportTemplate() {
  const sampleRow = {
    "اسم المريض": "أحمد محمد",
    "كود المريض": "PT-2024-001",
    "نوع الفحص": "MR",
    "اسم الفحص": "Brain without contrast",
    "الطبيب المسؤول": "د. خالد",
    "الأولوية": "روتيني",
    "الحالة": "قيد الانتظار",
    "ملاحظات": "",
    "تاريخ الإنشاء": "2024-10-01",
  };
  const ws = XLSX.utils.json_to_sheet([sampleRow]);
  ws["!cols"] = [
    { wch: 25 }, { wch: 18 }, { wch: 12 }, { wch: 25 }, { wch: 20 },
    { wch: 12 }, { wch: 15 }, { wch: 30 }, { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "نموذج الاستيراد");
  XLSX.writeFile(wb, "نموذج_استيراد_الحالات.xlsx");
}

export function exportCasesToExcel(cases: Case[], fileName: string) {
  const statusLabel = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
  const priorityLabel = (p: string) => PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? p;

  const rows = cases.map((c) => ({
    "اسم المريض": c.patient_name,
    "كود المريض": c.patient_code,
    "نوع الفحص": c.exam_type,
    "اسم الفحص": c.exam_name ?? "",
    "تاريخ الإنشاء": new Date(c.created_at).toLocaleString("ar-EG"),
    "الطبيب المسؤول": c.doctor?.name ?? "غير معين",
    "الأولوية": priorityLabel(c.priority),
    "الحالة": statusLabel(c.status),
    "ملاحظات": c.notes ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 25 }, { wch: 18 }, { wch: 15 }, { wch: 20 }, { wch: 22 }, { wch: 22 },
    { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 30 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "قائمة الحالات");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}
