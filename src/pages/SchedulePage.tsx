import { useEffect, useState, useCallback } from "react";
import { supabase, type User, type DoctorSchedule, DAYS_OF_WEEK } from "@/lib/supabase";
import { Plus, Trash2, Loader2, X, Clock, Phone, Stethoscope, FileText, UserCircle, Calendar, Pencil, Power, Eye, CalendarPlus, Activity, Flame, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";

function getTodayKey(): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date().getDay()];
}

function to12Hour(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

type DoctorStatus = "available" | "scheduled_off_hours" | "not_working" | "inactive";

function getDoctorStatus(doctor: User, daySchedules: DoctorSchedule[]): DoctorStatus {
  if (doctor.status === "inactive") return "inactive";
  if (daySchedules.length === 0) return "not_working";
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);
  const working = daySchedules.some((s) => currentTime >= s.start_time && currentTime <= s.end_time);
  return working ? "available" : "scheduled_off_hours";
}

interface DoctorWithStats {
  doctor: User;
  schedules: DoctorSchedule[];
  todaySchedule: DoctorSchedule | null;
  status: DoctorStatus;
  activeCases: number;
  urgentCases: number;
}

export default function SchedulePage() {
  const { user: currentUser } = useAuth();
  const [doctors, setDoctors] = useState<User[]>([]);
  const [schedules, setSchedules] = useState<DoctorSchedule[]>([]);
  const [cases, setCases] = useState<{ assigned_doctor_id: string | null; status: string; priority: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(getTodayKey());

  // Add/edit schedule modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editSchedule, setEditSchedule] = useState<DoctorSchedule | null>(null);
  const [modalDoctorId, setModalDoctorId] = useState<string>("");
  const [dayOfWeek, setDayOfWeek] = useState("saturday");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [schedNotes, setSchedNotes] = useState("");
  const [savingSched, setSavingSched] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [confirmDeleteSched, setConfirmDeleteSched] = useState<DoctorSchedule | null>(null);

  // Add doctor to schedule modal (pick from existing doctors)
  const [showAddToScheduleModal, setShowAddToScheduleModal] = useState(false);
  const [addSchedSearch, setAddSchedSearch] = useState("");
  const [addSchedDoctorId, setAddSchedDoctorId] = useState<string>("");
  const [addSchedStart, setAddSchedStart] = useState("09:00");
  const [addSchedEnd, setAddSchedEnd] = useState("17:00");
  const [savingAddSched, setSavingAddSched] = useState(false);
  const [addSchedError, setAddSchedError] = useState<string | null>(null);

  // View schedule modal
  const [viewDoctor, setViewDoctor] = useState<User | null>(null);

  const canManage = currentUser?.role === "admin" || currentUser?.role === "coordinator";
  const isViewer = currentUser?.role === "viewer";

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [docRes, schedRes, caseRes] = await Promise.all([
      supabase.from("users").select("id, name, mobile, role, specialty, technical_notes, status, created_at, last_login").eq("role", "doctor").order("name"),
      supabase.from("doctor_schedules").select("id, doctor_id, day_of_week, start_time, end_time, notes"),
      supabase.from("cases").select("assigned_doctor_id, status, priority"),
    ]);
    if (docRes.data) setDoctors(docRes.data as User[]);
    if (schedRes.data) setSchedules(schedRes.data as DoctorSchedule[]);
    if (caseRes.data) setCases(caseRes.data as { assigned_doctor_id: string | null; status: string; priority: string }[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel("schedule-cases-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "cases" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "doctor_schedules" }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadAll]);

  // Build doctor stats for selected day
  const doctorStats: DoctorWithStats[] = doctors.map((doctor) => {
    const docScheds = schedules.filter((s) => s.doctor_id === doctor.id && s.day_of_week === selectedDay);
    const todayKey = getTodayKey();
    const todaySched = schedules.find((s) => s.doctor_id === doctor.id && s.day_of_week === todayKey) ?? null;
    const status = getDoctorStatus(doctor, todayKey === selectedDay ? docScheds : schedules.filter((s) => s.doctor_id === doctor.id && s.day_of_week === todayKey));
    const docCases = cases.filter((c) => c.assigned_doctor_id === doctor.id);
    return {
      doctor,
      schedules: docScheds,
      todaySchedule: todaySched,
      status,
      activeCases: docCases.filter((c) => c.status !== "finished").length,
      urgentCases: docCases.filter((c) => c.status !== "finished" && (c.priority === "urgent" || c.priority === "critical")).length,
    };
  })
  .filter((ds) => ds.schedules.length > 0)
  .sort((a, b) => {
    const order: Record<DoctorStatus, number> = { available: 0, scheduled_off_hours: 1, not_working: 2, inactive: 3 };
    return order[a.status] - order[b.status];
  });

  // Doctors not yet scheduled for the selected day
  const scheduledDoctorIds = new Set(schedules.filter((s) => s.day_of_week === selectedDay).map((s) => s.doctor_id));
  const unscheduledDoctors = doctors.filter((d) => !scheduledDoctorIds.has(d.id) && d.status === "active");
  const filteredUnscheduled = unscheduledDoctors.filter((d) =>
    d.name.toLowerCase().includes(addSchedSearch.toLowerCase())
  );

  // Day counts
  const dayCounts = DAYS_OF_WEEK.map((d) => ({
    ...d,
    count: new Set(schedules.filter((s) => s.day_of_week === d.value).map((s) => s.doctor_id)).size,
    isToday: d.value === getTodayKey(),
  }));

  // Stats summary
  const totalActive = doctors.filter((d) => d.status === "active").length;
  const availableNow = doctorStats.filter((ds) => ds.status === "available").length;
  const totalUrgent = doctorStats.reduce((sum, ds) => sum + ds.urgentCases, 0);
  const totalActiveCases = doctorStats.reduce((sum, ds) => sum + ds.activeCases, 0);

  // Schedule modal handlers
  const openAddSchedule = (doctorId: string, day: string) => {
    setEditSchedule(null);
    setModalDoctorId(doctorId);
    setDayOfWeek(day);
    setStartTime("09:00");
    setEndTime("17:00");
    setSchedNotes("");
    setSchedError(null);
    setShowScheduleModal(true);
  };

  const openEditSchedule = (s: DoctorSchedule) => {
    setEditSchedule(s);
    setModalDoctorId(s.doctor_id);
    setDayOfWeek(s.day_of_week);
    setStartTime(s.start_time);
    setEndTime(s.end_time);
    setSchedNotes(s.notes ?? "");
    setSchedError(null);
    setShowScheduleModal(true);
  };

  const handleSaveSchedule = async () => {
    setSchedError(null);
    if (!modalDoctorId) { setSchedError("اختر طبيباً"); return; }
    setSavingSched(true);
    const payload = { doctor_id: modalDoctorId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime, notes: schedNotes.trim() || null };
    if (editSchedule) {
      const { error: e } = await supabase.from("doctor_schedules").update(payload).eq("id", editSchedule.id);
      if (e) { setSchedError(e.message); setSavingSched(false); return; }
    } else {
      const { error: e } = await supabase.from("doctor_schedules").insert(payload);
      if (e) { setSchedError(e.message); setSavingSched(false); return; }
    }
    setSavingSched(false);
    setShowScheduleModal(false);
    loadAll();
  };

  const handleDeleteSchedule = async () => {
    if (!confirmDeleteSched) return;
    const { error } = await supabase.from("doctor_schedules").delete().eq("id", confirmDeleteSched.id);
    if (!error) {
      setSchedules((prev) => prev.filter((s) => s.id !== confirmDeleteSched.id));
      setConfirmDeleteSched(null);
    }
  };

  // Add doctor to schedule handlers
  const openAddToSchedule = () => {
    setAddSchedSearch("");
    setAddSchedDoctorId("");
    setAddSchedStart("09:00");
    setAddSchedEnd("17:00");
    setAddSchedError(null);
    setShowAddToScheduleModal(true);
  };

  const handleAddToSchedule = async () => {
    setAddSchedError(null);
    if (!addSchedDoctorId) { setAddSchedError("اختر طبيباً"); return; }
    setSavingAddSched(true);
    const { error: e } = await supabase.from("doctor_schedules").insert({
      doctor_id: addSchedDoctorId,
      day_of_week: selectedDay,
      start_time: addSchedStart,
      end_time: addSchedEnd,
    });
    if (e) { setAddSchedError(e.message); setSavingAddSched(false); return; }
    setSavingAddSched(false);
    setShowAddToScheduleModal(false);
    loadAll();
  };

  // Disable/enable doctor
  const handleToggleDoctorStatus = async (doctor: User) => {
    const newStatus = doctor.status === "active" ? "inactive" : "active";
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${supabaseUrl}/functions/v1/auth-manage-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "update", id: doctor.id, status: newStatus }),
      });
      loadAll();
    } catch { /* ignore */ }
  };

  const inputClass = "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all text-sm";

  const statusConfig: Record<DoctorStatus, { label: string; border: string; bg: string; badge: string; dot: string; accent: string }> = {
    available: { label: "متاح الآن", border: "border-emerald-200", bg: "bg-white", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", accent: "from-emerald-500 to-emerald-600" },
    scheduled_off_hours: { label: "خارج ساعات العمل", border: "border-amber-200", bg: "bg-white", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500", accent: "from-amber-500 to-amber-600" },
    not_working: { label: "غير متاح اليوم", border: "border-slate-200", bg: "bg-white", badge: "bg-slate-100 text-slate-500", dot: "bg-slate-400", accent: "from-slate-400 to-slate-500" },
    inactive: { label: "حساب غير نشط", border: "border-red-200", bg: "bg-white", badge: "bg-red-100 text-red-700", dot: "bg-red-500", accent: "from-red-500 to-red-600" },
  };

  const formatLastLogin = (lastLogin: string | null): string => {
    if (!lastLogin) return "لم يسجل الدخول بعد";
    const date = new Date(lastLogin);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 1) return "الآن";
    if (diffMin < 60) return `قبل ${diffMin} دقيقة`;
    if (diffHr < 24) return `قبل ${diffHr} ساعة`;
    if (diffDay < 7) return `قبل ${diffDay} يوم`;
    return date.toLocaleDateString("ar-EG");
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-slate-300 animate-spin" /></div>;
  }

  const selectedDayLabel = DAYS_OF_WEEK.find((d) => d.value === selectedDay)?.label ?? "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">جداول الأطباء</h1>
          <p className="text-slate-500 text-sm mt-1">إدارة مواعيد وحالة الأطباء</p>
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-cyan-50 flex items-center justify-center flex-shrink-0">
            <UserCircle className="w-5 h-5 text-cyan-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">إجمالي الأطباء</p>
            <p className="text-xl font-bold text-slate-800">{totalActive}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Activity className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">متاح الآن</p>
            <p className="text-xl font-bold text-emerald-600">{availableNow}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">حالات نشطة</p>
            <p className="text-xl font-bold text-blue-600">{totalActiveCases}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
            <Flame className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500">حالات عاجلة</p>
            <p className="text-xl font-bold text-red-600">{totalUrgent}</p>
          </div>
        </div>
      </div>

      {/* Day navigation bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-2 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {dayCounts.map((d) => {
            const active = selectedDay === d.value;
            return (
              <button
                key={d.value}
                onClick={() => setSelectedDay(d.value)}
                className={`relative flex flex-col items-center justify-center px-5 py-3 rounded-xl min-w-[100px] transition-all ${
                  active ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="text-sm font-bold">{d.label}</span>
                <span className={`text-xs mt-0.5 ${active ? "text-white/80" : "text-slate-400"}`}>{d.count} طبيب</span>
                {d.isToday && (
                  <span className={`absolute top-1.5 left-1.5 w-2 h-2 rounded-full ${active ? "bg-white" : "bg-cyan-500"}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Doctor cards for selected day */}
      {doctorStats.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-400">
          <Calendar className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-sm">لا يوجد أطباء مجدولون يوم {selectedDayLabel}</p>
          {canManage && unscheduledDoctors.length > 0 && (
            <button onClick={openAddToSchedule} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 transition-all text-sm shadow-lg shadow-cyan-500/20">
              <CalendarPlus className="w-4 h-4" />
              إضافة طبيب للجدول
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {doctorStats.map(({ doctor, status, activeCases, urgentCases }) => {
            const cfg = statusConfig[status];
            const docSchedForSelectedDay = schedules.find((s) => s.doctor_id === doctor.id && s.day_of_week === selectedDay);
            return (
              <div key={doctor.id} className={`rounded-2xl border ${cfg.border} ${cfg.bg} overflow-hidden transition-all hover:shadow-lg`}>
                {/* Status accent bar */}
                <div className={`h-1.5 bg-gradient-to-l ${cfg.accent}`} />

                {/* Card header */}
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center flex-shrink-0">
                        <UserCircle className="w-6 h-6 text-blue-700" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-800 leading-snug truncate">{doctor.name}</h3>
                        {doctor.specialty && <p className="text-xs text-slate-500 leading-snug truncate">{doctor.specialty}</p>}
                      </div>
                    </div>
                  </div>

                  {/* Working hours */}
                  <div className={`rounded-xl ${docSchedForSelectedDay ? "bg-cyan-50 border border-cyan-100" : "bg-slate-50 border border-slate-100"} px-3 py-2.5 mb-3`}>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      {docSchedForSelectedDay ? (
                        <span dir="ltr" className="text-sm font-semibold text-slate-700">{to12Hour(docSchedForSelectedDay.start_time)} - {to12Hour(docSchedForSelectedDay.end_time)}</span>
                      ) : (
                        <span className="text-sm text-slate-400">لا يعمل في هذا اليوم</span>
                      )}
                    </div>
                  </div>

                  {/* Info rows */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500" dir="ltr">
                      <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span>{doctor.mobile}</span>
                    </div>
                    {doctor.technical_notes && (
                      <div className="flex items-start gap-1.5 text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                        <Stethoscope className="w-3 h-3 text-amber-600 flex-shrink-0 mt-0.5" />
                        <span>{doctor.technical_notes}</span>
                      </div>
                    )}
                    {docSchedForSelectedDay?.notes && (
                      <div className="flex items-start gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5">
                        <FileText className="w-3 h-3 text-slate-400 flex-shrink-0 mt-0.5" />
                        <span>{docSchedForSelectedDay.notes}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card actions */}
                {canManage && (
                  <div className="flex items-center gap-1 px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                    {docSchedForSelectedDay ? (
                      <button onClick={() => openEditSchedule(docSchedForSelectedDay)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-cyan-700 bg-white border border-cyan-200 hover:bg-cyan-50 transition-all">
                        <Pencil className="w-3.5 h-3.5" />
                        تعديل الموعد
                      </button>
                    ) : (
                      <button onClick={() => openAddSchedule(doctor.id, selectedDay)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-cyan-700 bg-white border border-cyan-200 hover:bg-cyan-50 transition-all">
                        <Plus className="w-3.5 h-3.5" />
                        إضافة موعد
                      </button>
                    )}
                    <button onClick={() => setViewDoctor(doctor)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all">
                      <Eye className="w-3.5 h-3.5" />
                      الجدول الكامل
                    </button>
                    {currentUser?.role === "admin" && (
                      <button
                        onClick={() => handleToggleDoctorStatus(doctor)}
                        className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium transition-all mr-auto ${
                          doctor.status === "active" ? "text-red-600 hover:bg-red-50" : "text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        {doctor.status === "active" ? "تعطيل" : "تفعيل"}
                      </button>
                    )}
                  </div>
                )}
                {isViewer && (
                  <div className="flex items-center gap-1 px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                    <button onClick={() => setViewDoctor(doctor)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all">
                      <Eye className="w-3.5 h-3.5" />
                      عرض الجدول الكامل
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating add button — adds existing doctor to schedule */}
      {canManage && unscheduledDoctors.length > 0 && (
        <button
          onClick={openAddToSchedule}
          className="fixed bottom-6 left-6 w-14 h-14 bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-full shadow-xl shadow-cyan-500/30 flex items-center justify-center hover:scale-105 transition-transform z-30"
          title="إضافة طبيب للجدول"
        >
          <CalendarPlus className="w-6 h-6" />
        </button>
      )}

      {/* Schedule modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowScheduleModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">{editSchedule ? "تعديل موعد" : "إضافة موعد"}</h2>
              <button onClick={() => setShowScheduleModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">الطبيب</label>
                <input type="text" value={doctors.find((d) => d.id === modalDoctorId)?.name ?? ""} disabled className={inputClass + " bg-slate-50 text-slate-500"} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">اليوم</label>
                <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className={inputClass}>
                  {DAYS_OF_WEEK.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">من الساعة</label>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputClass} dir="ltr" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">إلى الساعة</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputClass} dir="ltr" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">ملاحظات</label>
                <input type="text" value={schedNotes} onChange={(e) => setSchedNotes(e.target.value)} className={inputClass} placeholder="ملاحظات التوفر..." />
              </div>
              {schedError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{schedError}</div>}
            </div>
            <div className="flex gap-3 p-6 border-t border-slate-100">
              <button onClick={() => setShowScheduleModal(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all">إلغاء</button>
              <button onClick={handleSaveSchedule} disabled={savingSched} className="flex-1 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20">
                {savingSched ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "حفظ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add doctor to schedule modal */}
      {showAddToScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowAddToScheduleModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-xl font-bold text-slate-800">إضافة طبيب للجدول</h2>
                <p className="text-xs text-slate-500 mt-1">يوم {selectedDayLabel}</p>
              </div>
              <button onClick={() => setShowAddToScheduleModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {unscheduledDoctors.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <UserCircle className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm">جميع الأطباء مجدولون لهذا اليوم</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">اختر طبيباً</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={addSchedSearch}
                        onChange={(e) => setAddSchedSearch(e.target.value)}
                        placeholder="بحث بالاسم..."
                        className={inputClass + " mb-2"}
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
                      {filteredUnscheduled.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setAddSchedDoctorId(d.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-right transition-all ${
                            addSchedDoctorId === d.id ? "bg-cyan-50" : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center flex-shrink-0">
                            <UserCircle className="w-4 h-4 text-blue-700" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{d.name}</p>
                            {d.specialty && <p className="text-xs text-slate-500 truncate">{d.specialty}</p>}
                          </div>
                          {addSchedDoctorId === d.id && (
                            <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center flex-shrink-0 mr-auto">
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            </div>
                          )}
                        </button>
                      ))}
                      {filteredUnscheduled.length === 0 && (
                        <p className="text-center text-xs text-slate-400 py-4">لا توجد نتائج</p>
                      )}
                    </div>
                  </div>

                  {addSchedDoctorId && (
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">من الساعة</label>
                        <input type="time" value={addSchedStart} onChange={(e) => setAddSchedStart(e.target.value)} className={inputClass} dir="ltr" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">إلى الساعة</label>
                        <input type="time" value={addSchedEnd} onChange={(e) => setAddSchedEnd(e.target.value)} className={inputClass} dir="ltr" />
                      </div>
                    </div>
                  )}

                  {addSchedError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{addSchedError}</div>}
                </>
              )}
            </div>
            {unscheduledDoctors.length > 0 && (
              <div className="flex gap-3 p-6 border-t border-slate-100 sticky bottom-0 bg-white">
                <button onClick={() => setShowAddToScheduleModal(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all">إلغاء</button>
                <button onClick={handleAddToSchedule} disabled={!addSchedDoctorId || savingAddSched} className="flex-1 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20">
                  {savingAddSched ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "إضافة للجدول"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View / Edit schedule modal */}
      {viewDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setViewDoctor(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
                  <UserCircle className="w-5 h-5 text-blue-700" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">جدول {viewDoctor.name}</h2>
                  {viewDoctor.specialty && <p className="text-xs text-slate-500">{viewDoctor.specialty}</p>}
                </div>
              </div>
              <button onClick={() => setViewDoctor(null)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-3">
              {!isViewer && <p className="text-xs text-slate-400 mb-2">يمكنك تعديل أيام وساعات العمل مباشرة - التغييرات تُحفظ تلقائياً</p>}
              {DAYS_OF_WEEK.map((d) => {
                const sched = schedules.find((s) => s.doctor_id === viewDoctor.id && s.day_of_week === d.value);
                const today = d.value === getTodayKey();
                return (
                  <div key={d.value} className={`rounded-xl border ${sched ? "bg-cyan-50 border-cyan-200" : "bg-slate-50 border-slate-100"} ${today ? "ring-2 ring-cyan-400/40" : ""} p-3`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-slate-700">{d.label}{today && <span className="text-xs text-cyan-600 mr-1">(اليوم)</span>}</span>
                      {sched && canManage && (
                        <button onClick={() => setConfirmDeleteSched(sched)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {sched ? (
                      isViewer ? (
                        <div className="flex items-center gap-2 text-sm text-slate-600" dir="ltr">
                          <span className="font-medium">{to12Hour(sched.start_time)}</span>
                          <span className="text-slate-400">-</span>
                          <span className="font-medium">{to12Hour(sched.end_time)}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            defaultValue={sched.start_time}
                            onBlur={async (e) => {
                              if (e.target.value === sched.start_time) return;
                              await supabase.from("doctor_schedules").update({ start_time: e.target.value }).eq("id", sched.id);
                              setSchedules((prev) => prev.map((s) => s.id === sched.id ? { ...s, start_time: e.target.value } : s));
                            }}
                            className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400/40 bg-white"
                            dir="ltr"
                          />
                          <span className="text-slate-400 text-sm">-</span>
                          <input
                            type="time"
                            defaultValue={sched.end_time}
                            onBlur={async (e) => {
                              if (e.target.value === sched.end_time) return;
                              await supabase.from("doctor_schedules").update({ end_time: e.target.value }).eq("id", sched.id);
                              setSchedules((prev) => prev.map((s) => s.id === sched.id ? { ...s, end_time: e.target.value } : s));
                            }}
                            className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400/40 bg-white"
                            dir="ltr"
                          />
                          <span className="text-xs text-slate-400 mr-1" dir="ltr">{to12Hour(sched.start_time)} - {to12Hour(sched.end_time)}</span>
                        </div>
                      )
                    ) : (
                      isViewer ? (
                        <span className="text-xs text-slate-400">لا يوجد موعد</span>
                      ) : (
                        <button
                          onClick={async () => {
                            const { data } = await supabase.from("doctor_schedules").insert({
                              doctor_id: viewDoctor.id,
                              day_of_week: d.value,
                              start_time: "09:00",
                              end_time: "17:00",
                            }).select("id, doctor_id, day_of_week, start_time, end_time, notes").single();
                            if (data) setSchedules((prev) => [...prev, data as DoctorSchedule]);
                          }}
                          className="flex items-center gap-1 text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          إضافة يوم عمل
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Delete schedule confirmation */}
      {confirmDeleteSched && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setConfirmDeleteSched(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center"><Trash2 className="w-5 h-5 text-red-600" /></div>
              <h3 className="text-lg font-bold text-slate-800">حذف الموعد</h3>
            </div>
            <p className="text-sm text-slate-600 mb-6">هل أنت متأكد من حذف هذا الموعد؟</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteSched(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
              <button onClick={handleDeleteSchedule} className="flex-1 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all text-sm">حذف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
