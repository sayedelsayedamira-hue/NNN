import { useEffect, useState, useCallback } from "react";
import { supabase, type Case, type User, type AppUser, EXAM_TYPES, PRIORITY_OPTIONS, STATUS_OPTIONS } from "@/lib/supabase";
import { ClipboardList, Clock, CheckCircle2, Users, AlertTriangle, Flame, CalendarClock, TrendingUp, Activity, Stethoscope, BarChart3, Calendar } from "lucide-react";

interface DashboardProps {
  user: AppUser;
}

interface Stats {
  total: number;
  pending: number;
  finished: number;
  inProgress: number;
  urgent: number;
  critical: number;
  todayCount: number;
  perDoctor: { name: string; count: number; pending: number; finished: number; inProgress: number }[];
  perExamType: { type: string; count: number; pending: number }[];
  perPriority: { priority: string; label: string; count: number; color: string }[];
  perStatus: { status: string; label: string; count: number; color: string }[];
  dailyChart: { date: string; label: string; count: number }[];
}

const EXAM_COLORS: Record<string, string> = {
  MR: "bg-violet-500",
  CT: "bg-cyan-500",
  Xray: "bg-blue-500",
  US: "bg-teal-500",
};

const PRIORITY_COLORS: Record<string, string> = {
  routine: "bg-slate-400",
  urgent: "bg-orange-500",
  critical: "bg-red-500",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500",
  in_progress: "bg-blue-500",
  finished: "bg-emerald-500",
};

const DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function formatArabicDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("ar-EG");
}

function formatArabicNumber(n: number): string {
  return n.toLocaleString("ar-EG");
}

type Preset = "today" | "7days" | "30days" | "thisMonth" | "all";

function toISODate(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().split("T")[0];
}

// Return the local date portion (YYYY-MM-DD) of a UTC timestamp string,
// interpreted in the browser's local timezone.
function localDateOf(utcStr: string): string {
  const d = new Date(utcStr);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().split("T")[0];
}

function getPresetRange(preset: Preset): { from: string; to: string } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  switch (preset) {
    case "today": {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      return { from: toISODate(from), to: toISODate(to) };
    }
    case "7days": {
      const from = new Date();
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { from: toISODate(from), to: toISODate(to) };
    }
    case "30days": {
      const from = new Date();
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
      return { from: toISODate(from), to: toISODate(to) };
    }
    case "thisMonth": {
      const from = new Date(to.getFullYear(), to.getMonth(), 1);
      return { from: toISODate(from), to: toISODate(to) };
    }
    case "all":
      return { from: "", to: "" };
  }
}

function buildDailyChart(fromDate: Date, toDate: Date, cases: Case[]): { date: string; label: string; count: number }[] {
  const result: { date: string; label: string; count: number }[] = [];
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDate);
  to.setHours(0, 0, 0, 0);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const cap = Math.min(days, 31);
  for (let i = 0; i < cap; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const dateStr = toISODate(d);
    result.push({
      date: dateStr,
      label: cap <= 7 ? DAY_NAMES[d.getDay()] : d.toLocaleDateString("ar-EG", { day: "numeric", month: "numeric" }),
      count: cases.filter((c) => localDateOf(c.created_at) === dateStr).length,
    });
  }
  return result;
}

function DailyLineChart({ data, maxCount }: { data: { date: string; label: string; count: number }[]; maxCount: number }) {
  const W = 600;
  const H = 200;
  const padTop = 36;
  const padBottom = 40;
  const padLeft = 20;
  const padRight = 30;
  const plotH = H - padTop - padBottom;
  const plotW = W - padLeft - padRight;
  const n = data.length;
  const stepX = n > 1 ? plotW / (n - 1) : plotW;

  const xy = data.map((d, i) => ({
    x: padLeft + i * stepX,
    y: padTop + plotH - (d.count / maxCount) * plotH,
    ...d,
  }));

  const linePath = xy.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${xy[xy.length - 1].x.toFixed(1)} ${padTop + plotH} L ${xy[0].x.toFixed(1)} ${padTop + plotH} Z`;

  const arrowSize = 7;
  const lastPt = xy[xy.length - 1];
  const prevPt = xy[xy.length - 2];
  const angle = prevPt ? Math.atan2(lastPt.y - prevPt.y, lastPt.x - prevPt.x) : 0;

  return (
    <div className="w-full overflow-x-auto mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padTop + plotH * t;
          return <line key={t} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="#f1f5f9" strokeWidth={1} />;
        })}

        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGrad)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Arrow head at the end */}
        {n >= 2 && (
          <polygon
            points={`${lastPt.x},${lastPt.y} ${lastPt.x - arrowSize * Math.cos(angle - 0.4)},${lastPt.y - arrowSize * Math.sin(angle - 0.4)} ${lastPt.x - arrowSize * Math.cos(angle + 0.4)},${lastPt.y - arrowSize * Math.sin(angle + 0.4)}`}
            fill="#2563eb"
          />
        )}

        {/* Dots + count labels + day labels */}
        {xy.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4.5} fill="#fff" stroke="url(#lineGrad)" strokeWidth={2.5} className="transition-all duration-300 hover:r-6" />
            <text x={p.x} y={p.y - 12} textAnchor="middle" className="text-xs font-semibold fill-slate-600" style={{ fontSize: 11 }}>
              {formatArabicNumber(p.count)}
            </text>
            <text x={p.x} y={H - padBottom + 20} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10 }}>
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function Dashboard({ user }: DashboardProps) {
  const [stats, setStats] = useState<Stats>({
    total: 0, pending: 0, finished: 0, inProgress: 0,
    urgent: 0, critical: 0, todayCount: 0, perDoctor: [], perExamType: [], perPriority: [], perStatus: [], dailyChart: [],
  });
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<Preset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const isAdmin = user.role === "admin";
  const isCoordinator = user.role === "coordinator";
  const isViewer = user.role === "viewer";
  const canSeeAll = isAdmin || isCoordinator || isViewer;

  const applyPreset = (p: Preset) => {
    const range = getPresetRange(p);
    setPreset(p);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const loadStats = useCallback(async () => {
    let query = supabase.from("cases").select("id, status, priority, assigned_doctor_id, created_at, exam_type, exam_name, doctor:users!cases_assigned_doctor_id_fkey(id, name)");
    if (!canSeeAll) {
      query = query.eq("assigned_doctor_id", user.id);
    }
    if (dateFrom) {
      // Build a local-timezone ISO string so the DB filter matches the user's clock
      const fromLocal = new Date(`${dateFrom}T00:00:00`);
      query = query.gte("created_at", fromLocal.toISOString());
    }
    if (dateTo) {
      const toLocal = new Date(`${dateTo}T23:59:59.999`);
      query = query.lte("created_at", toLocal.toISOString());
    }
    const { data: cases, error } = await query;
    if (error || !cases) { setLoading(false); return; }

    const typedCases = cases as unknown as Case[];
    const todayStr = toISODate(new Date());

    // Build daily chart from selected range, or last 7 days if "all"
    let chart: { date: string; label: string; count: number }[];
    if (dateFrom && dateTo) {
      chart = buildDailyChart(new Date(dateFrom), new Date(dateTo), typedCases);
    } else {
      const from = new Date();
      from.setDate(from.getDate() - 6);
      chart = buildDailyChart(from, new Date(), typedCases);
    }

    // Per exam type
    const perExamType = EXAM_TYPES.map((type) => ({
      type,
      count: typedCases.filter((c) => c.exam_type === type).length,
      pending: typedCases.filter((c) => c.exam_type === type && c.status === "pending").length,
    })).filter((e) => e.count > 0).sort((a, b) => b.count - a.count);

    // Per priority
    const perPriority = PRIORITY_OPTIONS.map((p) => ({
      priority: p.value,
      label: p.label,
      count: typedCases.filter((c) => c.priority === p.value).length,
      color: PRIORITY_COLORS[p.value],
    }));

    // Per status
    const perStatus = STATUS_OPTIONS.map((s) => ({
      status: s.value,
      label: s.label,
      count: typedCases.filter((c) => c.status === s.value).length,
      color: STATUS_COLORS[s.value],
    }));

    const s: Stats = {
      total: typedCases.length,
      pending: typedCases.filter((c) => c.status === "pending").length,
      finished: typedCases.filter((c) => c.status === "finished").length,
      inProgress: typedCases.filter((c) => c.status === "in_progress").length,
      urgent: typedCases.filter((c) => c.priority === "urgent").length,
      critical: typedCases.filter((c) => c.priority === "critical").length,
      todayCount: typedCases.filter((c) => localDateOf(c.created_at) === todayStr).length,
      perExamType,
      perPriority,
      perStatus,
      dailyChart: chart,
      perDoctor: [],
    };

    if (canSeeAll) {
      const { data: doctors } = await supabase
        .from("users")
        .select("id, name")
        .eq("role", "doctor")
        .eq("status", "active");
      if (doctors) {
        s.perDoctor = (doctors as User[]).map((d) => {
          const docCases = typedCases.filter((c) => c.assigned_doctor_id === d.id);
          return {
            name: d.name,
            count: docCases.length,
            pending: docCases.filter((c) => c.status === "pending").length,
            finished: docCases.filter((c) => c.status === "finished").length,
            inProgress: docCases.filter((c) => c.status === "in_progress").length,
          };
        }).sort((a, b) => b.count - a.count);
      }
    }

    setStats(s);
    setLoading(false);
  }, [user, canSeeAll, dateFrom, dateTo]);

  useEffect(() => {
    setLoading(true);
    loadStats();
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cases" }, () => loadStats())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cases" }, () => loadStats())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "cases" }, () => loadStats())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadStats]);

  const cards = [
    { label: "إجمالي الحالات", value: stats.total, icon: ClipboardList, color: "from-slate-700 to-slate-900", iconColor: "text-slate-300" },
    { label: "قيد الانتظار", value: stats.pending, icon: Clock, color: "from-amber-500 to-amber-600", iconColor: "text-amber-100" },
    { label: "قيد التنفيذ", value: stats.inProgress, icon: TrendingUp, color: "from-blue-500 to-blue-600", iconColor: "text-blue-100" },
    { label: "مكتمل", value: stats.finished, icon: CheckCircle2, color: "from-emerald-500 to-emerald-600", iconColor: "text-emerald-100" },
    { label: "عاجل", value: stats.urgent, icon: AlertTriangle, color: "from-orange-500 to-orange-600", iconColor: "text-orange-100" },
    { label: "حرج", value: stats.critical, icon: Flame, color: "from-red-500 to-red-600", iconColor: "text-red-100" },
    { label: "حالات اليوم", value: stats.todayCount, icon: CalendarClock, color: "from-cyan-500 to-cyan-600", iconColor: "text-cyan-100" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  const maxDayCount = Math.max(...stats.dailyChart.map((d) => d.count), 1);
  const maxExamCount = Math.max(...stats.perExamType.map((e) => e.count), 1);
  const completionRate = stats.total > 0 ? Math.round((stats.finished / stats.total) * 100) : 0;

  const chartTitle = dateFrom && dateTo
    ? `الحالات من ${formatArabicDate(dateFrom)} إلى ${formatArabicDate(dateTo)}`
    : "الحالات خلال آخر 7 أيام";

  const presetButtons: { value: Preset; label: string }[] = [
    { value: "today", label: "اليوم" },
    { value: "7days", label: "7 أيام" },
    { value: "30days", label: "30 يوم" },
    { value: "thisMonth", label: "هذا الشهر" },
    { value: "all", label: "الكل" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">مرحباً، {user.name}</h1>
        <p className="text-slate-500 text-sm mt-1">
          {canSeeAll ? "نظرة عامة على جميع حالات الأشعة" : "نظرة عامة على قائمة عملك"}
        </p>
      </div>

      {/* Date range filter */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="w-5 h-5 text-cyan-600" />
            <span className="text-sm font-semibold text-slate-700 ml-1">الفترة الزمنية</span>
            <div className="flex flex-wrap gap-1.5">
              {presetButtons.map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => applyPreset(btn.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    preset === btn.value
                      ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-500 whitespace-nowrap">من</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setPreset("all"); setDateFrom(e.target.value); }}
                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all"
                dir="ltr"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-500 whitespace-nowrap">إلى</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setPreset("all"); setDateTo(e.target.value); }}
                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all"
                dir="ltr"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => applyPreset("all")}
                className="px-3 py-2 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all font-medium"
              >
                مسح التاريخ
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`bg-gradient-to-br ${card.color} rounded-2xl p-4 lg:p-6 shadow-lg`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white/80 text-xs lg:text-sm font-medium">{card.label}</p>
                  <p className="text-white text-2xl lg:text-3xl font-bold mt-2">{formatArabicNumber(card.value)}</p>
                </div>
                <div className={`w-10 h-10 lg:w-12 lg:h-12 bg-white/10 rounded-xl flex items-center justify-center ${card.iconColor}`}>
                  <Icon className="w-5 h-5 lg:w-6 lg:h-6" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Completion rate gauge */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Activity className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-800">نسبة الإنجاز</h2>
          </div>
          <div className="flex flex-col items-center justify-center py-4">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="52" fill="none" stroke="url(#gradient)" strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(completionRate / 100) * 327} 327`}
                  className="transition-all duration-700"
                />
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-bold text-slate-800">{formatArabicNumber(completionRate)}%</span>
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-3">
              {formatArabicNumber(stats.finished)} من {formatArabicNumber(stats.total)} حالة مكتملة
            </p>
          </div>
        </div>

        {/* Daily chart — line with arrows and dots */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 lg:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-800">{chartTitle}</h2>
          </div>
          <DailyLineChart data={stats.dailyChart} maxCount={maxDayCount} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status distribution */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-800">توزيع الحالات حسب الحالة</h2>
          </div>
          <div className="space-y-4">
            {stats.perStatus.map((s) => (
              <div key={s.status}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">{s.label}</span>
                  <span className="text-sm font-semibold text-slate-600">{formatArabicNumber(s.count)}</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${s.color} rounded-full transition-all duration-700`}
                    style={{ width: `${stats.total > 0 ? (s.count / stats.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority distribution */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-800">توزيع الحالات حسب الأولوية</h2>
          </div>
          <div className="space-y-4">
            {stats.perPriority.map((p) => (
              <div key={p.priority}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">{p.label}</span>
                  <span className="text-sm font-semibold text-slate-600">{formatArabicNumber(p.count)}</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${p.color} rounded-full transition-all duration-700`}
                    style={{ width: `${stats.total > 0 ? (p.count / stats.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Exam type breakdown */}
      {stats.perExamType.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Stethoscope className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-800">توزيع الحالات حسب نوع الفحص</h2>
          </div>
          <div className="space-y-4">
            {stats.perExamType.map((e) => (
              <div key={e.type}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${EXAM_COLORS[e.type] || "bg-slate-400"}`} />
                    <span className="text-sm font-medium text-slate-700">{e.type}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{formatArabicNumber(e.pending)} قيد الانتظار</span>
                    <span className="text-sm font-semibold text-slate-600">{formatArabicNumber(e.count)}</span>
                  </div>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${EXAM_COLORS[e.type] || "bg-slate-400"} rounded-full transition-all duration-700`}
                    style={{ width: `${(e.count / maxExamCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per doctor table */}
      {canSeeAll && stats.perDoctor.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-3 p-6 border-b border-slate-100">
            <Users className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-bold text-slate-800">الحالات حسب الطبيب</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500">الطبيب</th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-slate-500">الإجمالي</th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-slate-500">قيد الانتظار</th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-slate-500">قيد التنفيذ</th>
                  <th className="text-center px-6 py-3 text-xs font-semibold text-slate-500">مكتمل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {stats.perDoctor.map((d) => (
                  <tr key={d.name} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-800">{d.name}</td>
                    <td className="px-6 py-4 text-center text-sm font-semibold text-slate-600">{formatArabicNumber(d.count)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{formatArabicNumber(d.pending)}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{formatArabicNumber(d.inProgress)}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">{formatArabicNumber(d.finished)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
