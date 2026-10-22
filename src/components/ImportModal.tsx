import { useState, useRef, useCallback } from "react";
import { supabase, type User, EXAM_TYPES } from "@/lib/supabase";
import { notifyCaseEvent } from "@/lib/push";
import { parseCasesFromExcel, downloadImportTemplate, type ImportedCaseRow } from "@/lib/excel";
import { X, Upload, FileSpreadsheet, Download, Loader2, CheckCircle2, AlertTriangle, FileDown } from "lucide-react";

interface ImportModalProps {
  doctors: User[];
  onClose: () => void;
  onImported: () => void;
}

type Phase = "upload" | "preview" | "importing" | "done";

export default function ImportModal({ doctors, onClose, onImported }: ImportModalProps) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [rows, setRows] = useState<ImportedCaseRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const doctorMap = new Map(doctors.map((d) => [d.name.trim().toLowerCase(), d]));

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError("الملف يجب أن يكون بصيغة Excel أو CSV");
      return;
    }
    setFileName(file.name);
    setPhase("preview");
    try {
      const parsed = await parseCasesFromExcel(file);
      if (parsed.length === 0) {
        setError("لم يتم العثور على بيانات في الملف");
        setPhase("upload");
        return;
      }
      setRows(parsed);
    } catch {
      setError("فشل قراءة الملف. تأكد من صحة الصيغة");
      setPhase("upload");
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    setPhase("importing");
    setError(null);
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    const validRows = rows.filter((r) => r._errors.length === 0);

    for (const row of validRows) {
      const doctor = row.assigned_doctor_name
        ? doctorMap.get(row.assigned_doctor_name.trim().toLowerCase())
        : null;

      const payload: Record<string, unknown> = {
        patient_name: row.patient_name,
        patient_code: row.patient_code,
        exam_type: row.exam_type,
        exam_name: row.exam_name || null,
        assigned_doctor_id: doctor?.id ?? null,
        priority: row.priority,
        status: row.status,
        notes: row.notes || null,
      };

      if (row.created_at) {
        payload.created_at = row.created_at;
      }

      const { data: inserted, error: insertError } = await supabase.from("cases").insert(payload).select("id").single();
      if (insertError) {
        failed++;
        errors.push(`${row.patient_name} (${row.patient_code}): ${insertError.message}`);
      } else {
        success++;
        if (doctor && inserted) {
          notifyCaseEvent("new_case", { caseId: inserted.id, targetUserId: doctor.id }).catch(() => {});
        }
      }
    }

    const skipped = rows.length - validRows.length;
    if (skipped > 0) {
      errors.push(`${skipped} صف تم تجاهله بسبب بيانات ناقصة أو غير صحيحة`);
    }

    setImportResult({ success, failed, errors });
    setPhase("done");
    if (success > 0) onImported();
  };

  const validCount = rows.filter((r) => r._errors.length === 0).length;
  const errorCount = rows.filter((r) => r._errors.length > 0).length;

  const inputClass = "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Upload className="w-5 h-5 text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">استيراد حالات من Excel</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Phase: Upload */}
          {phase === "upload" && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  dragOver ? "border-cyan-400 bg-cyan-50" : "border-slate-200 hover:border-cyan-300 hover:bg-slate-50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FileSpreadsheet className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-slate-700">اسحب ملف Excel هنا أو اضغط للاختيار</p>
                <p className="text-xs text-slate-400 mt-1">الصيغ المدعومة: xlsx, xls, csv</p>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">لمعرفة الصيغة المطلوبة</p>
                    <p className="text-xs text-slate-500 mt-1">حمّل ملف نموذج يحتوي على الأعمدة المطلوبة</p>
                  </div>
                  <button
                    onClick={downloadImportTemplate}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm"
                  >
                    <FileDown className="w-4 h-4 text-cyan-600" />
                    تحميل النموذج
                  </button>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-xs text-slate-500 mb-2">الأعمدة المطلوبة:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["اسم المريض", "كود المريض", "نوع الفحص", "اسم الفحص", "الطبيب المسؤول", "الأولوية", "الحالة", "ملاحظات", "تاريخ الإنشاء"].map((col) => (
                      <span key={col} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-600">{col}</span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    الأعمدة الإلزامية: اسم المريض وكود المريض. الباقي اختياري.
                    الأنواع المسموحة للفحص: {EXAM_TYPES.join("، ")}.
                    الأولوية: روتيني، عاجل، حرج. الحالة: قيد الانتظار، قيد التنفيذ، مكتمل.
                  </p>
                </div>
              </div>

              {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
            </>
          )}

          {/* Phase: Preview */}
          {phase === "preview" && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  <span className="text-sm font-medium text-slate-700">{fileName}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-slate-500">{rows.length} صف إجمالي</span>
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    {validCount} صالح
                  </span>
                  {errorCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                      <AlertTriangle className="w-4 h-4" />
                      {errorCount} به مشاكل
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-100 sticky top-0">
                      <tr>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">#</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">المريض</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">الكود</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">الفحص</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">الطبيب</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">الأولوية</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">الحالة</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {rows.map((row, idx) => {
                        const hasDoctor = row.assigned_doctor_name && doctorMap.has(row.assigned_doctor_name.trim().toLowerCase());
                        return (
                          <tr key={idx} className={row._errors.length > 0 ? "bg-red-50/50" : "hover:bg-slate-50"}>
                            <td className="px-3 py-2 text-xs text-slate-400">{idx + 1}</td>
                            <td className="px-3 py-2 text-sm text-slate-800">{row.patient_name || "—"}</td>
                            <td className="px-3 py-2 text-sm text-slate-600 font-mono" dir="ltr">{row.patient_code || "—"}</td>
                            <td className="px-3 py-2 text-sm text-slate-600">{row.exam_type}{row.exam_name ? ` (${row.exam_name})` : ""}</td>
                            <td className="px-3 py-2 text-sm">
                              {row.assigned_doctor_name ? (
                                hasDoctor ? (
                                  <span className="text-slate-700">{row.assigned_doctor_name}</span>
                                ) : (
                                  <span className="text-amber-600" title="لم يتم العثور على الطبيب — سيتم الإضافة بدون طبيب">{row.assigned_doctor_name}</span>
                                )
                              ) : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                row.priority === "critical" ? "bg-red-100 text-red-700" :
                                row.priority === "urgent" ? "bg-orange-100 text-orange-700" :
                                "bg-slate-100 text-slate-600"
                              }`}>
                                {row.priority === "critical" ? "حرج" : row.priority === "urgent" ? "عاجل" : "روتيني"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                row.status === "finished" ? "bg-emerald-100 text-emerald-700" :
                                row.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                                "bg-amber-100 text-amber-700"
                              }`}>
                                {row.status === "finished" ? "مكتمل" : row.status === "in_progress" ? "قيد التنفيذ" : "قيد الانتظار"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500 max-w-[150px] truncate" title={row.notes}>{row.notes || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {errorCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
                  {errorCount} صف يحتوي على مشاكل وسيتم تجاهله. تأكد من البيانات في الملف وحاول مرة أخرى إذا أردت إدراجها.
                </div>
              )}
              {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
            </>
          )}

          {/* Phase: Importing */}
          {phase === "importing" && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
              <p className="text-sm font-medium text-slate-600 mt-4">جارٍ استيراد الحالات...</p>
            </div>
          )}

          {/* Phase: Done */}
          {phase === "done" && importResult && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${importResult.failed === 0 ? "bg-emerald-100" : "bg-amber-100"}`}>
                {importResult.failed === 0 ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-amber-600" />
                )}
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-slate-800">
                  تم استيراد {importResult.success} حالة بنجاح
                </p>
                {importResult.failed > 0 && (
                  <p className="text-sm text-amber-600 mt-1">{importResult.failed} حالة فشلت</p>
                )}
              </div>
              {importResult.errors.length > 0 && (
                <div className="w-full bg-slate-50 rounded-xl p-4 max-h-[200px] overflow-y-auto">
                  <p className="text-xs font-semibold text-slate-500 mb-2">تفاصيل الأخطاء:</p>
                  {importResult.errors.map((err, idx) => (
                    <p key={idx} className="text-xs text-slate-600 py-1 border-b border-slate-100 last:border-0">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {phase !== "importing" && (
          <div className="flex gap-3 p-6 border-t border-slate-100 sticky bottom-0 bg-white">
            {phase === "done" ? (
              <>
                <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all">إغلاق</button>
                <button
                  onClick={() => { setPhase("upload"); setRows([]); setFileName(""); setImportResult(null); setError(null); }}
                  className="flex-1 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20"
                >
                  استيراد ملف آخر
                </button>
              </>
            ) : phase === "preview" ? (
              <>
                <button
                  onClick={() => { setPhase("upload"); setRows([]); setFileName(""); setError(null); }}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all"
                >
                  رجوع
                </button>
                <button
                  onClick={handleImport}
                  disabled={validCount === 0}
                  className="flex-1 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20"
                >
                  استيراد {validCount} حالة
                </button>
              </>
            ) : (
              <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all">إلغاء</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
