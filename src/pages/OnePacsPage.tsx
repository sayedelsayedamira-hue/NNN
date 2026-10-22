import { useState, useCallback, useEffect } from "react";
import {
  fetchOnePacsWorklist,
  testOnePacsConnection,
  getOnePacsConfig,
  saveOnePacsConfig,
  getFieldMapping,
  saveFieldMapping,
  syncOnePacsToCases,
  type OnePacsRecord,
  type OnePacsConfigInfo,
  type OnePacsFieldMapping,
} from "@/lib/onepacsService";
import {
  Loader2, RefreshCw, Search, AlertCircle, Inbox, Wifi, WifiOff,
  ChevronRight, ChevronLeft, Database, Settings, Save, X, CheckCircle,
  ArrowRightLeft, Link2, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

const PAGE_SIZE = 25;

const COLUMN_LABELS: Record<string, string> = {
  patientName: "اسم المريض",
  patientId: "كود المريض",
  accessionNumber: "رقم الدخول",
  studyDate: "تاريخ الفحص",
  modality: "نوع الفحص",
  studyDescription: "وصف الفحص",
  referringPhysician: "الطبيب المُحيل",
  readingPhysician: "طبيب القراءة",
  status: "الحالة",
  priority: "الأولوية",
  link: "رابط الفحص",
};

const ONEPACS_FIELD_OPTIONS = [
  "name", "patientId", "accessionNumber", "studyDescription", "modalitiesInStudy",
  "referringPhysicianName", "assignedToUser", "status", "stat", "studyPk",
  "studyIuid", "facilityName", "patientNotes", "bodyPartsInStudy",
  "studyDateTimeWithTimeZone", "receivedTime", "createdTime", "worklistStat",
  "confirmationState", "hasDraft", "hasReport", "requestedReadType",
];

const CASE_FIELD_LABELS: Record<string, string> = {
  case_patient_name: "اسم المريض",
  case_patient_code: "كود المريض",
  case_exam_type: "نوع الفحص",
  case_exam_name: "اسم الفحص",
  case_status: "الحالة",
  case_priority: "الأولوية",
  case_notes: "ملاحظات",
  case_onepacs_study_uid: "معرف الدراسة (Study UID)",
  case_onepacs_link: "رابط OnePacs",
};

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") {
    if ((key === "studyDate" || key === "createdDate") && value.length >= 10) {
      const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
      if (!isNaN(d.getTime())) return d.toLocaleDateString("ar-EG");
    }
    return value;
  }
  return String(value);
}

export default function OnePacsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [records, setRecords] = useState<OnePacsRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState("receivedTime");
  const [dir, setDir] = useState<"ASC" | "DESC">("DESC");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [configNotSet, setConfigNotSet] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const result = await fetchOnePacsWorklist({ start, limit: PAGE_SIZE, sort, dir, search });
      setRecords(result.records);
      setTotal(result.total);
      setConfigNotSet(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setRecords([]);
      setTotal(0);
      if (msg.includes("لم يتم إعداد")) setConfigNotSet(true);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [start, sort, dir, search]);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setStart(0);
  };

  const handleRefresh = () => loadData(true);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testOnePacsConnection();
      setTestResult({ ok: true, msg: result.message });
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncOnePacsToCases();
      setSyncResult({ ok: true, msg: result.message });
    } catch (err) {
      setSyncResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
    }
  };

  const handleSort = (col: string) => {
    if (sort === col) {
      setDir(dir === "ASC" ? "DESC" : "ASC");
    } else {
      setSort(col);
      setDir("ASC");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(start / PAGE_SIZE) + 1;

  const columns = records.length > 0
    ? Object.keys(records[0]).slice(0, 10)
    : Object.keys(COLUMN_LABELS);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">قائمة OnePacs</h1>
          <p className="text-slate-500 text-sm mt-1">عرض الحالات من نظام OnePacs الخارجي</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {isAdmin && (
            <button
              onClick={() => setShowMapping(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm"
            >
              <Link2 className="w-4 h-4 text-purple-600" />
              ربط الحقول
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm"
            >
              <Settings className="w-4 h-4" />
              الإعدادات
            </button>
          )}
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4 text-cyan-600" />}
            اختبار الاتصال
          </button>
          {isAdmin && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4 text-emerald-600" />}
              ترحيل للحالات
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 transition-all text-sm shadow-lg shadow-cyan-500/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحديث
          </button>
        </div>
      </div>

      {/* Test/Sync result banners */}
      {testResult && (
        <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
          testResult.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
        }`}>
          {testResult.ok ? <Wifi className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" /> : <WifiOff className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p className={`text-sm font-medium ${testResult.ok ? "text-emerald-700" : "text-red-700"}`}>
              {testResult.ok ? "تم الاختبار بنجاح" : "فشل الاختبار"}
            </p>
            <p className={`text-xs mt-0.5 ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>{testResult.msg}</p>
          </div>
          <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {syncResult && (
        <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
          syncResult.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
        }`}>
          {syncResult.ok ? <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p className={`text-sm font-medium ${syncResult.ok ? "text-emerald-700" : "text-red-700"}`}>
              {syncResult.ok ? "تمت المزامنة" : "فشلت المزامنة"}
            </p>
            <p className={`text-xs mt-0.5 ${syncResult.ok ? "text-emerald-600" : "text-red-600"}`}>{syncResult.msg}</p>
          </div>
          <button onClick={() => setSyncResult(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Config not set banner */}
      {configNotSet && isAdmin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 flex items-start gap-3">
          <Settings className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700">لم يتم إعداد بيانات OnePacs</p>
            <p className="text-xs text-amber-600 mt-1">اضغط زر "الإعدادات" لإضافة اسم المستخدم وكلمة المرور وعنوان الخادم.</p>
          </div>
          <button onClick={() => setShowSettings(true)} className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-white border border-amber-200 rounded-lg hover:bg-amber-50 transition-all">الإعدادات</button>
        </div>
      )}

      {/* Error banner */}
      {error && !loading && !configNotSet && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700">تعذر جلب البيانات من OnePacs</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
          </div>
          <button onClick={handleRefresh} className="px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-all">إعادة المحاولة</button>
        </div>
      )}

      {/* Search bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="بحث باسم المريض..."
            className="w-full pr-10 pl-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all"
          />
        </div>
        <button onClick={handleSearch} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">بحث</button>
        {(search || searchInput) && (
          <button onClick={() => { setSearch(""); setSearchInput(""); setStart(0); }} className="px-4 py-2.5 text-sm text-slate-500 hover:text-red-500 transition-colors">مسح</button>
        )}
      </div>

      {/* Data table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-cyan-400 animate-spin" /></div>
        ) : records.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center"><Inbox className="w-6 h-6 text-slate-300" /></div>
            <p className="text-sm mt-2">لا توجد سجلات في OnePacs</p>
            <p className="text-xs text-slate-400 mt-1">قد تكون القائمة فارغة أو أن معايير البحث لا تطابق أي سجل</p>
          </div>
        ) : error && !configNotSet ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center"><Database className="w-6 h-6 text-red-300" /></div>
            <p className="text-sm mt-2">تعذر تحميل البيانات</p>
          </div>
        ) : null}
        {records.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {columns.map((col) => (
                    <th key={col} onClick={() => handleSort(col)} className="text-right px-4 py-3 text-xs font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700 transition-colors">
                      <span className="inline-flex items-center gap-1">
                        {COLUMN_LABELS[col] ?? col}
                        {sort === col && <span className="text-cyan-500">{dir === "ASC" ? "↑" : "↓"}</span>}
                      </span>
                    </th>
                  ))}
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">رابط</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {records.map((record, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-3 text-sm text-slate-700">{formatValue(col, record[col])}</td>
                    ))}
                    <td className="px-4 py-3">
                      {record.studyPk ? (
                        <a
                          href={`https://my.onepacs.com/x/s/l/${record.studyPk}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-cyan-600 hover:text-cyan-700 text-xs font-medium"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          فتح
                        </a>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-slate-500">عرض {start + 1}–{Math.min(start + PAGE_SIZE, total)} من {total} سجل</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setStart(Math.max(0, start - PAGE_SIZE))} disabled={start === 0 || loading} className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight className="w-4 h-4" />السابق
            </button>
            <span className="px-3 py-2 text-sm font-medium text-slate-600 bg-slate-50 rounded-xl">{currentPage} / {totalPages}</span>
            <button onClick={() => setStart(start + PAGE_SIZE)} disabled={start + PAGE_SIZE >= total || loading} className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              التالي<ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {!loading && records.length > 0 && (
        <p className="text-xs text-slate-400 text-center">البيانات معروضة مباشرة من OnePacs ولا يتم حفظها في قاعدة البيانات المحلية</p>
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); setStart(0); loadData(true); setTestResult(null); }} />
      )}

      {showMapping && (
        <FieldMappingModal onClose={() => setShowMapping(false)} />
      )}
    </div>
  );
}

function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState("https://my.onepacs.com");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [worklistEndpoint, setWorklistEndpoint] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [existing, setExisting] = useState<OnePacsConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const config = await getOnePacsConfig();
        if (config) {
          setExisting(config);
          setBaseUrl(config.base_url);
          setUsername(config.username);
          setWorklistEndpoint(config.worklist_endpoint ?? "");
          setEnabled(config.enabled);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveOnePacsConfig({ baseUrl, username, password, worklistEndpoint, enabled });
      setSaved(true);
      setTimeout(() => onSaved(), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-800">إعدادات OnePacs</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-cyan-400 animate-spin" /></div>
        ) : (
          <div className="p-6 space-y-4">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
            {saved && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center gap-2 text-xs text-emerald-600"><CheckCircle className="w-4 h-4" />تم حفظ الإعدادات بنجاح</div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">عنوان الخادم (Base URL)</label>
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://my.onepacs.com" dir="ltr" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">مسار الـ Worklist (اختياري)</label>
              <input type="text" value={worklistEndpoint} onChange={(e) => setWorklistEndpoint(e.target.value)} placeholder="/json/worklist/WorklistAjax.action" dir="ltr" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all" />
              <p className="text-xs text-slate-400 mt-1">اتركه فارغاً لاستخدام المسار الافتراضي</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم المستخدم</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" dir="ltr" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور {existing && <span className="text-slate-400 font-normal">(أدخلها لإعادة التعيين)</span>}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" dir="ltr" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-400/40" />
              <span className="text-sm text-slate-700">تفعيل التكامل</span>
            </label>
            {existing && <p className="text-xs text-slate-400">آخر تحديث: {new Date(existing.updated_at).toLocaleDateString("ar-EG")}</p>}
            <div className="flex gap-3 pt-2">
              <button onClick={handleSave} disabled={saving || (!username) || (!existing && !password)} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 transition-all text-sm shadow-lg shadow-cyan-500/20 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}حفظ
              </button>
              <button onClick={onClose} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldMappingModal({ onClose }: { onClose: () => void }) {
  const [mapping, setMapping] = useState<OnePacsFieldMapping>({
    case_patient_name: "name",
    case_patient_code: "patientId",
    case_exam_type: "modalitiesInStudy",
    case_exam_name: "studyDescription",
    case_status: "status",
    case_priority: "stat",
    case_notes: "patientNotes",
    case_onepacs_study_uid: "studyIuid",
    case_onepacs_link: "studyPk",
    auto_sync_enabled: false,
    sync_interval_minutes: 5,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mappingKeys: Array<keyof OnePacsFieldMapping> = [
    "case_patient_name", "case_patient_code", "case_exam_type", "case_exam_name",
    "case_status", "case_priority", "case_notes", "case_onepacs_study_uid", "case_onepacs_link",
  ];

  useEffect(() => {
    (async () => {
      try {
        const data = await getFieldMapping();
        if (data) setMapping(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveFieldMapping(mapping);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-bold text-slate-800">ربط حقول OnePacs بصفحة الحالات</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-purple-400 animate-spin" /></div>
        ) : (
          <div className="p-6 space-y-4">
            <div className="rounded-xl bg-purple-50 border border-purple-200 px-4 py-3">
              <p className="text-sm text-purple-700">
                حدد حقل OnePacs الذي يتطابق مع كل عمود في صفحة الحالات. عند الترحيل، سيتم استخدام هذه الربطات لتحويل البيانات.
              </p>
            </div>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
            {saved && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center gap-2 text-xs text-emerald-600"><CheckCircle className="w-4 h-4" />تم حفظ الربط بنجاح</div>}

            <div className="space-y-3">
              {mappingKeys.map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-40 flex-shrink-0">
                    <label className="text-sm font-medium text-slate-700">{CASE_FIELD_LABELS[key]}</label>
                  </div>
                  <ArrowRightLeft className="w-4 h-4 text-slate-300 flex-shrink-0" />
                  <select
                    value={mapping[key] as string}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-transparent transition-all"
                  >
                    {ONEPACS_FIELD_OPTIONS.map((field) => (
                      <option key={field} value={field}>{field}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={mapping.auto_sync_enabled} onChange={(e) => setMapping((prev) => ({ ...prev, auto_sync_enabled: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-400/40" />
                <span className="text-sm text-slate-700">تفعيل المزامنة التلقائية</span>
              </label>
              {mapping.auto_sync_enabled && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700">الفاصل (دقائق)</label>
                  <input type="number" min={1} max={60} value={mapping.sync_interval_minutes} onChange={(e) => setMapping((prev) => ({ ...prev, sync_interval_minutes: parseInt(e.target.value) || 5 }))} className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400/40" />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-l from-purple-500 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-400 hover:to-indigo-500 transition-all text-sm shadow-lg shadow-purple-500/20 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}حفظ الربط
              </button>
              <button onClick={onClose} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إغلاق</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
