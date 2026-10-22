import { useState, useEffect } from "react";
import { supabase, type Case, type User, type CaseStatus, type CasePriority, type DoctorSchedule, EXAM_TYPES, STATUS_OPTIONS, PRIORITY_OPTIONS, DAYS_OF_WEEK } from "@/lib/supabase";
import { notifyCaseEvent } from "@/lib/push";
import { X, Loader2, Flame, AlertTriangle, CheckCircle2, Stethoscope } from "lucide-react";

interface CaseModalProps {
  case: Case | null;
  doctors: User[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function getDayKey(date: Date): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[date.getDay()];
}

function isDoctorAvailableNow(schedules: DoctorSchedule[], doctorId: string): boolean {
  const now = new Date();
  const todayKey = getDayKey(now);
  const currentTime = now.toTimeString().slice(0, 5);
  const doctorSchedules = schedules.filter((s) => s.doctor_id === doctorId && s.day_of_week === todayKey);
  return doctorSchedules.some((s) => currentTime >= s.start_time && currentTime <= s.end_time);
}

export default function CaseModal({ case: editCase, doctors, canEdit, onClose, onSaved }: CaseModalProps) {
  const [patientName, setPatientName] = useState("");
  const [patientCode, setPatientCode] = useState("");
  const [examType, setExamType] = useState(EXAM_TYPES[0]);
  const [examName, setExamName] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [status, setStatus] = useState<CaseStatus>("pending");
  const [priority, setPriority] = useState<CasePriority>("routine");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<DoctorSchedule[]>([]);

  useEffect(() => {
    if (editCase) {
      setPatientName(editCase.patient_name);
      setPatientCode(editCase.patient_code);
      setExamType(editCase.exam_type);
      setExamName(editCase.exam_name ?? "");
      setDoctorId(editCase.assigned_doctor_id ?? "");
      setStatus(editCase.status);
      setPriority(editCase.priority);
      setNotes(editCase.notes ?? "");
    }
  }, [editCase]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("doctor_schedules")
        .select("id, doctor_id, day_of_week, start_time, end_time, notes");
      if (data) setSchedules(data as DoctorSchedule[]);
    })();
  }, []);

  const selectedDoctor = doctors.find((d) => d.id === doctorId);
  const availableNow = doctorId ? isDoctorAvailableNow(schedules, doctorId) : false;

  const handleSave = async () => {
    setError(null);
    if (!patientName.trim() || !patientCode.trim()) {
      setError("اسم المريض والكود مطلوبان");
      return;
    }

    setSaving(true);
    const payload = {
      patient_name: patientName.trim(),
      patient_code: patientCode.trim(),
      exam_type: examType,
      exam_name: examName.trim() || null,
      assigned_doctor_id: doctorId || null,
      status,
      priority,
      notes: notes.trim() || null,
    };

    if (editCase) {
      const { error: e } = await supabase.from("cases").update(payload).eq("id", editCase.id);
      if (e) { setError(e.message); setSaving(false); return; }

      // Determine if this is a reassignment
      const prevDoctorId = editCase.assigned_doctor_id;
      const newDoctorId = doctorId || null;
      if (newDoctorId && newDoctorId !== prevDoctorId) {
        notifyCaseEvent("reassigned", { caseId: editCase.id, targetUserId: newDoctorId, prevDoctorId: prevDoctorId ?? undefined }).catch(() => {});
      }
    } else {
      const { data: inserted, error: e } = await supabase.from("cases").insert(payload).select("id").single();
      if (e) { setError(e.message); setSaving(false); return; }

      // Notify the assigned doctor about the new case
      if (doctorId && inserted) {
        notifyCaseEvent("new_case", { caseId: inserted.id, targetUserId: doctorId }).catch(() => {});
      }
    }
    setSaving(false);
    onSaved();
  };

  const inputClass = "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold text-slate-800">{editCase ? "تعديل حالة" : "حالة جديدة"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم المريض</label>
            <input type="text" value={patientName} onChange={(e) => setPatientName(e.target.value)} className={inputClass} placeholder="أدخل اسم المريض" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">كود المريض</label>
            <input type="text" value={patientCode} onChange={(e) => setPatientCode(e.target.value)} className={inputClass} placeholder="مثال: PT-2024-001" dir="ltr" style={{ textAlign: "right" }} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">نوع الفحص</label>
              <select value={examType} onChange={(e) => setExamType(e.target.value)} className={inputClass}>
                {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الفحص</label>
              <input type="text" value={examName} onChange={(e) => setExamName(e.target.value)} className={inputClass} placeholder="مثال: Brain without contrast" />
            </div>
          </div>

          {/* Doctor assignment with specialty, notes, availability */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الطبيب المسؤول</label>
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={inputClass}>
              <option value="">اختر طبيباً</option>
              {doctors.map((d) => {
                const available = isDoctorAvailableNow(schedules, d.id);
                return (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.specialty ? ` - ${d.specialty}` : ""}{available ? " (متاح الآن)" : ""}
                  </option>
                );
              })}
            </select>
            {selectedDoctor && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
                    <Stethoscope className="w-4 h-4 text-blue-700" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{selectedDoctor.name}</p>
                    {selectedDoctor.specialty && <p className="text-xs text-slate-500">التخصص: {selectedDoctor.specialty}</p>}
                  </div>
                  {availableNow && (
                    <span className="mr-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      <CheckCircle2 className="w-3 h-3" />
                      متاح الآن
                    </span>
                  )}
                </div>
                {selectedDoctor.technical_notes && (
                  <p className="text-xs text-slate-500 bg-white rounded-lg p-2 border border-slate-100">
                    <span className="font-medium">ملاحظات فنية: </span>
                    {selectedDoctor.technical_notes}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الأولوية</label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map((p) => {
                const selected = priority === p.value;
                const styles: Record<string, string> = {
                  routine: selected ? "bg-slate-600 text-white" : "bg-slate-100 text-slate-600",
                  urgent: selected ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700",
                  critical: selected ? "bg-red-500 text-white" : "bg-red-100 text-red-700",
                };
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${styles[p.value]}`}
                  >
                    {p.value === "critical" && <Flame className="w-4 h-4" />}
                    {p.value === "urgent" && <AlertTriangle className="w-4 h-4" />}
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">الحالة</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)} className={inputClass}>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">ملاحظات</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass + " min-h-[80px] resize-y"} placeholder="ملاحظات إضافية..." />
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
        </div>

        <div className="flex gap-3 p-6 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20">
            {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "حفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}
