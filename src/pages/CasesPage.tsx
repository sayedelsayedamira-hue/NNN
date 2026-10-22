import { useEffect, useState, useCallback } from "react";
import { supabase, type Case, type User, type AppUser, type CaseStatus, STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/lib/supabase";
import { exportCasesToExcel } from "@/lib/excel";
import CaseModal from "@/components/CaseModal";
import ImportModal from "@/components/ImportModal";
import { Plus, FileSpreadsheet, Pencil, Trash2, Search, Loader2, ClipboardList, Flame, AlertTriangle, ChevronUp, ChevronDown, Upload, ClipboardCheck, Clock3, Calendar, Stethoscope, X, CheckCheck, UserCog, FileX2, Check, XCircle, Inbox, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { notifyCaseEvent } from "@/lib/push";

interface CasesPageProps {
  user: AppUser;
}

type SortField = "created_at" | "patient_name" | "priority" | "status";
type SortDir = "asc" | "desc";

const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, routine: 2 };
const statusOrder: Record<string, number> = { pending: 0, in_progress: 1, finished: 2 };

interface DeletionRequest {
  id: string;
  case_id: string;
  requester_name: string;
  patient_name: string;
  patient_code: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewer_name: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export default function CasesPage({ user }: CasesPageProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [doctors, setDoctors] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCase, setEditCase] = useState<Case | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [confirmDelete, setConfirmDelete] = useState<Case | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDoctorId, setBulkDoctorId] = useState("");
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [pendingRequestIds, setPendingRequestIds] = useState<Set<string>>(new Set());
  const [confirmRequestDelete, setConfirmRequestDelete] = useState<Case | null>(null);
  const [confirmBulkRequestDelete, setConfirmBulkRequestDelete] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [reviewingRequest, setReviewingRequest] = useState<DeletionRequest | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;

  const isAdmin = user.role === "admin";
  const isCoordinator = user.role === "coordinator";
  const isViewer = user.role === "viewer";
  const canCreateEdit = isAdmin || isCoordinator;
  const canDelete = isAdmin;
  const canRequestDelete = isCoordinator;
  const canViewAll = canCreateEdit || isViewer;

  const loadDoctors = useCallback(async () => {
    if (!canViewAll) return;
    const { data, error } = await supabase
      .from("users")
      .select("id, name, mobile, role, specialty, technical_notes, status, created_at")
      .eq("role", "doctor")
      .eq("status", "active")
      .order("name");
    if (!error && data) setDoctors(data as User[]);
  }, [canCreateEdit]);

  const loadCases = useCallback(async (showLoading: boolean = false) => {
    if (showLoading) setLoading(true);
    let query = supabase
      .from("cases")
      .select("*, doctor:users!cases_assigned_doctor_id_fkey(id, name, mobile, role, specialty, technical_notes, status, created_at)")
      .order("created_at", { ascending: false });
    if (!canViewAll) {
      query = query.eq("assigned_doctor_id", user.id);
    }
    const { data, error } = await query;
    if (!error && data) setCases(data as unknown as Case[]);
    if (showLoading) setLoading(false);
  }, [user, canViewAll]);

  const loadDeletionRequests = useCallback(async () => {
    if (!canCreateEdit) return;
    const { data, error } = await supabase
      .from("case_deletion_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setDeletionRequests(data as DeletionRequest[]);
      const pending = new Set<string>();
      for (const r of data as DeletionRequest[]) {
        if (r.status === "pending") pending.add(r.case_id);
      }
      setPendingRequestIds(pending);
    }
  }, [canCreateEdit]);

  useEffect(() => {
    loadCases(true);
    loadDoctors();
    loadDeletionRequests();
    const channel = supabase
      .channel("cases-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cases" }, () => {
        loadCases(false);
        loadDeletionRequests();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cases" }, () => {
        loadCases(false);
        loadDeletionRequests();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "cases" }, () => {
        loadCases(false);
        loadDeletionRequests();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "case_deletion_requests" }, () => loadDeletionRequests())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "case_deletion_requests" }, () => loadDeletionRequests())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadCases, loadDoctors, loadDeletionRequests]);

  const handleSaved = () => { setShowModal(false); setEditCase(null); loadCases(false); };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from("cases").delete().eq("id", confirmDelete.id);
    if (!error) {
      setCases((prev) => prev.filter((c) => c.id !== confirmDelete.id));
      setPendingRequestIds((prev) => { const next = new Set(prev); next.delete(confirmDelete.id); return next; });
      setConfirmDelete(null);
      loadDeletionRequests();
    }
  };

  const handleStatusChange = async (caseId: string, newStatus: CaseStatus) => {
    const caseBefore = cases.find((c) => c.id === caseId);
    const prevStatus = caseBefore?.status;
    const { error } = await supabase.from("cases").update({ status: newStatus }).eq("id", caseId);
    if (!error) {
      setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, status: newStatus } : c));
      if (prevStatus && prevStatus !== newStatus && !canCreateEdit) {
        notifyCaseEvent("status_change", { caseId, prevStatus, newStatus }).catch(() => {});
      }
    } else {
      loadCases(false);
    }
  };

  const handleExport = () => {
    exportCasesToExcel(filteredCases, canViewAll ? "all_cases" : "my_worklist");
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const filteredCases = cases
    .filter((c) => {
      const matchesSearch = c.patient_name.toLowerCase().includes(search.toLowerCase()) || c.patient_code.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || c.priority === priorityFilter;
      const matchesDoctor = doctorFilter === "all" || c.assigned_doctor_id === doctorFilter;
      const caseDate = new Date(c.created_at);
      const matchesDateFrom = !dateFrom || caseDate >= new Date(dateFrom + "T00:00:00");
      const matchesDateTo = !dateTo || caseDate <= new Date(dateTo + "T23:59:59");
      return matchesSearch && matchesStatus && matchesPriority && matchesDoctor && matchesDateFrom && matchesDateTo;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "created_at") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (sortField === "patient_name") cmp = a.patient_name.localeCompare(b.patient_name);
      else if (sortField === "priority") cmp = priorityOrder[a.priority] - priorityOrder[b.priority];
      else if (sortField === "status") cmp = statusOrder[a.status] - statusOrder[b.status];
      return sortDir === "asc" ? cmp : -cmp;
    });

  const totalPages = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedCases = filteredCases.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, priorityFilter, doctorFilter, dateFrom, dateTo, sortField, sortDir]);

  const allSelected = pagedCases.length > 0 && pagedCases.every((c) => selectedIds.has(c.id));
  const someSelected = pagedCases.some((c) => selectedIds.has(c.id)) && !allSelected;

  const toggleSelectPage = () => {
    if (allSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); pagedCases.forEach((c) => next.delete(c.id)); return next; });
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); pagedCases.forEach((c) => next.add(c.id)); return next; });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCases.length && filteredCases.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCases.map((c) => c.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkDoctorId("");
  };

  const handleBulkChangeDoctor = async () => {
    if (!bulkDoctorId || selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("cases").update({ assigned_doctor_id: bulkDoctorId }).in("id", ids);
    if (!error) {
      const doctor = doctors.find((d) => d.id === bulkDoctorId);
      setCases((prev) => prev.map((c) => selectedIds.has(c.id) ? { ...c, assigned_doctor_id: bulkDoctorId, doctor: doctor ?? c.doctor } : c));
      setBulkDoctorId("");
      clearSelection();
    }
    setBulkActionLoading(false);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("cases").delete().in("id", ids);
    if (!error) {
      setCases((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      setConfirmBulkDelete(false);
      clearSelection();
      loadDeletionRequests();
    }
    setBulkActionLoading(false);
  };

  const handleRequestDelete = async () => {
    if (!confirmRequestDelete) return;
    setBulkActionLoading(true);
    const { error } = await supabase.from("case_deletion_requests").insert({
      case_id: confirmRequestDelete.id,
      requested_by: user.id,
      requester_name: user.name,
      patient_name: confirmRequestDelete.patient_name,
      patient_code: confirmRequestDelete.patient_code,
      reason: deletionReason || null,
    });
    if (!error) {
      notifyCaseEvent("deletion_request", { caseId: confirmRequestDelete.id, patientCode: confirmRequestDelete.patient_code }).catch(() => {});
      setConfirmRequestDelete(null);
      setDeletionReason("");
      loadDeletionRequests();
    }
    setBulkActionLoading(false);
  };

  const handleBulkRequestDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const selectedCases = cases.filter((c) => selectedIds.has(c.id));
    const rows = selectedCases.map((c) => ({
      case_id: c.id,
      requested_by: user.id,
      requester_name: user.name,
      patient_name: c.patient_name,
      patient_code: c.patient_code,
      reason: deletionReason || null,
    }));
    const { error } = await supabase.from("case_deletion_requests").insert(rows);
    if (!error) {
      notifyCaseEvent("deletion_request", { caseId: "bulk", patientCode: "", count: rows.length }).catch(() => {});
      setConfirmBulkRequestDelete(false);
      setDeletionReason("");
      clearSelection();
      loadDeletionRequests();
    }
    setBulkActionLoading(false);
  };

  const handleReviewRequest = async (approve: boolean) => {
    if (!reviewingRequest) return;
    setReviewLoading(true);
    if (approve) {
      const { error: delError } = await supabase.from("cases").delete().eq("id", reviewingRequest.case_id);
      if (delError) { setReviewLoading(false); return; }
      setCases((prev) => prev.filter((c) => c.id !== reviewingRequest.case_id));
    }
    const { error } = await supabase.from("case_deletion_requests").update({
      status: approve ? "approved" : "rejected",
      reviewed_by: user.id,
      reviewer_name: user.name,
      review_note: reviewNote || null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", reviewingRequest.id);
    if (!error) {
      setDeletionRequests((prev) => prev.map((r) => r.id === reviewingRequest.id ? { ...r, status: approve ? "approved" : "rejected", reviewer_name: user.name, review_note: reviewNote || null, reviewed_at: new Date().toISOString() } : r));
      setPendingRequestIds((prev) => { const next = new Set(prev); next.delete(reviewingRequest.case_id); return next; });
      notifyCaseEvent("deletion_reviewed", {
        caseId: reviewingRequest.case_id,
        patientCode: reviewingRequest.patient_code,
        status: approve ? "approved" : "rejected",
        targetUserId: undefined,
      }).catch(() => {});
      setReviewingRequest(null);
      setReviewNote("");
    }
    setReviewLoading(false);
  };

  const pendingRequests = deletionRequests.filter((r) => r.status === "pending");

  const rowBg = (c: Case) => {
    if (selectedIds.has(c.id)) return "bg-cyan-50 hover:bg-cyan-100";
    if (c.priority === "critical") return "bg-red-50 hover:bg-red-100";
    if (c.priority === "urgent") return "bg-orange-50 hover:bg-orange-100";
    return "hover:bg-slate-50";
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 cursor-pointer select-none" onClick={() => toggleSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  const inputClass = "px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all";

  return (
    <div className="space-y-6" style={{ paddingBottom: selectedIds.size > 0 ? "80px" : undefined }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{canViewAll ? "جميع الحالات" : "قائمة عملي"}</h1>
          <p className="text-slate-500 text-sm mt-1">{canViewAll ? (isViewer ? "عرض جميع حالات الأشعة" : "إدارة جميع حالات الأشعة") : "الحالات المسندة إليك"}</p>
        </div>
        <div className="flex gap-3">
          {canCreateEdit && (
            <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              تصدير Excel
            </button>
          )}
          {canCreateEdit && (
            <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">
              <Upload className="w-4 h-4 text-cyan-600" />
              استيراد Excel
            </button>
          )}
          {canCreateEdit && (
            <button onClick={() => { setEditCase(null); setShowModal(true); }} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 transition-all text-sm shadow-lg shadow-cyan-500/20">
              <Plus className="w-4 h-4" />
              حالة جديدة
            </button>
          )}
        </div>
      </div>

      {/* Deletion requests panel (admin) */}
      {isAdmin && pendingRequests.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <Inbox className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">طلبات حذف الحالات</h2>
              <p className="text-xs text-slate-500">{pendingRequests.length} طلب بانتظار المراجعة</p>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {pendingRequests.map((req) => (
              <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                    <FileX2 className="w-4 h-4 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{req.patient_name} <span className="text-slate-400 font-mono text-xs" dir="ltr">({req.patient_code})</span></p>
                    <p className="text-xs text-slate-500">طلب بواسطة: {req.requester_name}{req.reason ? ` — السبب: ${req.reason}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setReviewingRequest(req)} className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 transition-all">مراجعة</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent reviewed requests (coordinator) */}
      {isCoordinator && deletionRequests.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-slate-50 border-b border-slate-100">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
              <FileX2 className="w-5 h-5 text-slate-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">طلبات الحذف السابقة</h2>
              <p className="text-xs text-slate-500">آخر 10 طلبات</p>
            </div>
          </div>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {deletionRequests.slice(0, 10).map((req) => (
              <div key={req.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center">
                    {req.status === "approved" ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : req.status === "rejected" ? (
                      <XCircle className="w-4 h-4 text-red-500" />
                    ) : (
                      <Clock3 className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{req.patient_name} <span className="text-slate-400 font-mono text-xs" dir="ltr">({req.patient_code})</span></p>
                    <p className="text-xs text-slate-500">
                      {req.status === "approved" ? "تمت الموافقة" : req.status === "rejected" ? "تم الرفض" : "بانتظار المراجعة"}
                      {req.reviewer_name ? ` — ${req.reviewer_name}` : ""}
                      {req.review_note ? ` — ${req.review_note}` : ""}
                    </p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  req.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                  req.status === "rejected" ? "bg-red-100 text-red-700" :
                  "bg-amber-100 text-amber-700"
                }`}>
                  {req.status === "approved" ? "موافق" : req.status === "rejected" ? "مرفوض" : "معلق"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-slate-500" />
          </div>
          <div>
            <p className="text-sm text-slate-500">إجمالي الحالات</p>
            <p className="text-2xl font-bold text-slate-800">{filteredCases.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
              <Clock3 className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-slate-500">قيد التنفيذ</p>
              <p className="text-2xl font-bold text-blue-600">{filteredCases.filter((c) => c.status === "in_progress" || c.status === "pending").length}</p>
            </div>
          </div>
          {(() => {
            const inProgress = filteredCases.filter((c) => c.status === "in_progress" || c.status === "pending");
            const byDoctor = new Map<string, number>();
            for (const c of inProgress) {
              const name = c.doctor?.name ?? "غير مسند";
              byDoctor.set(name, (byDoctor.get(name) ?? 0) + 1);
            }
            const sorted = Array.from(byDoctor.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
            if (sorted.length === 0) return null;
            return (
              <div className="mt-2 pt-2 border-t border-slate-50 space-y-0.5">
                {sorted.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate">{name}</span>
                    <span className="font-medium text-blue-500 mr-1">{count}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
            <ClipboardCheck className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-slate-500 text-sm">الحالات المكتملة</p>
            <p className="text-2xl font-bold text-emerald-600">{filteredCases.filter((c) => c.status === "finished").length}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم المريض أو الكود..." className="w-full pr-10 pl-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass}>
          <option value="all">كل الحالات</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className={inputClass}>
          <option value="all">كل الأولويات</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {canViewAll && (
          <select value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)} className={inputClass}>
            <option value="all">كل الأطباء</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>

      {/* Date filter row */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Calendar className="w-4 h-4" />
          <span className="font-medium">تصفية بالتاريخ</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 whitespace-nowrap">من</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 whitespace-nowrap">إلى</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all" />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-red-500 transition-colors">
              <X className="w-4 h-4" />
              مسح التاريخ
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-slate-300 animate-spin" />
          </div>
        ) : filteredCases.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center">
              <ClipboardList className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-sm mt-2">لا توجد حالات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {canCreateEdit && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectPage}
                        className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                      />
                    </th>
                  )}
                  <SortHeader field="patient_name" label="المريض" />
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">الكود</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">نوع الفحص</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">اسم الفحص</th>
                  <SortHeader field="priority" label="الأولوية" />
                  {canViewAll && <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">الطبيب</th>}
                  <SortHeader field="status" label="الحالة" />
                  <SortHeader field="created_at" label="التاريخ" />
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">رابط</th>
                  {canCreateEdit && <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">إجراءات</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pagedCases.map((c) => (
                  <tr key={c.id} className={`${rowBg(c)} transition-colors`}>
                    {canCreateEdit && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">
                      {c.patient_name}
                      {pendingRequestIds.has(c.id) && (
                        <span className="inline-flex items-center gap-1 mr-2 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          <Clock3 className="w-3 h-3" /> طلب حذف
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 font-mono" dir="ltr">{c.patient_code}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 font-medium">{c.exam_type}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{c.exam_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                        c.priority === "critical" ? "bg-red-100 text-red-700" :
                        c.priority === "urgent" ? "bg-orange-100 text-orange-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>
                        {c.priority === "critical" && <Flame className="w-3 h-3" />}
                        {c.priority === "urgent" && <AlertTriangle className="w-3 h-3" />}
                        {PRIORITY_OPTIONS.find((p) => p.value === c.priority)?.label}
                      </span>
                    </td>
                    {canViewAll && <td className="px-4 py-3 text-sm text-slate-600">{c.doctor?.name ?? "—"}</td>}
                    <td className="px-4 py-3">
                      {canCreateEdit || !canViewAll ? (
                        <select value={c.status} onChange={(e) => handleStatusChange(c.id, e.target.value as CaseStatus)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          c.status === "finished" ? "bg-emerald-100 text-emerald-700" :
                          c.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                          "bg-amber-100 text-amber-700"
                        }`}>
                          {STATUS_OPTIONS.find((s) => s.value === c.status)?.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500" dir="ltr">{new Date(c.created_at).toLocaleString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-3">
                      {c.onepacs_link ? (
                        <a
                          href={c.onepacs_link}
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
                    {canCreateEdit && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => { setEditCase(c); setShowModal(true); }} className="p-2 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-all">
                            <Pencil className="w-4 h-4" />
                          </button>
                          {canDelete && (
                            <button onClick={() => setConfirmDelete(c)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {canRequestDelete && !pendingRequestIds.has(c.id) && (
                            <button onClick={() => { setConfirmRequestDelete(c); setDeletionReason(""); }} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" title="طلب حذف">
                              <FileX2 className="w-4 h-4" />
                            </button>
                          )}
                          {canRequestDelete && pendingRequestIds.has(c.id) && (
                            <span className="text-xs text-amber-500 px-2 py-1 bg-amber-50 rounded-lg" title="طلب الحذف قيد المراجعة">
                              <Clock3 className="w-4 h-4 inline" />
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredCases.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-slate-500">
            عرض {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredCases.length)} من {filteredCases.length} حالة
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
              السابق
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
              .map((p, idx, arr) => (
                <span key={p} className="flex items-center">
                  {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-slate-400">…</span>}
                  <button
                    onClick={() => setCurrentPage(p)}
                    className={`w-9 h-9 flex items-center justify-center text-sm font-medium rounded-xl transition-all ${
                      p === safePage
                        ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {p}
                  </button>
                </span>
              ))}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              التالي
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <CaseModal case={editCase} doctors={doctors} canEdit={canCreateEdit} onClose={() => { setShowModal(false); setEditCase(null); }} onSaved={handleSaved} />
      )}

      {showImport && (
        <ImportModal doctors={doctors} onClose={() => setShowImport(false)} onImported={() => loadCases(false)} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">حذف الحالة</h3>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              هل أنت متأكد من حذف حالة <span className="font-semibold">{confirmDelete.patient_name}</span> ({confirmDelete.patient_code})؟ لا يمكن التراجع عن هذا الإجراء.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
              <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all text-sm">حذف</button>
            </div>
          </div>
        </div>
      )}

      {/* Request deletion modal (coordinator) */}
      {confirmRequestDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setConfirmRequestDelete(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <FileX2 className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">طلب حذف حالة</h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              سيتم إرسال طلب حذف لحالة <span className="font-semibold">{confirmRequestDelete.patient_name}</span> ({confirmRequestDelete.patient_code}) إلى المسؤول للمراجعة.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">سبب الحذف (اختياري)</label>
              <textarea value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all min-h-[60px] resize-y" placeholder="اكتب سبب طلب الحذف..." />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmRequestDelete(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
              <button onClick={handleRequestDelete} disabled={bulkActionLoading} className="flex-1 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {bulkActionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                إرسال الطلب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk request deletion modal (coordinator) */}
      {confirmBulkRequestDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setConfirmBulkRequestDelete(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <FileX2 className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">طلب حذف حالات</h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              سيتم إرسال طلب حذف لـ <span className="font-semibold">{selectedIds.size}</span> حالة إلى المسؤول للمراجعة.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">سبب الحذف (اختياري)</label>
              <textarea value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all min-h-[60px] resize-y" placeholder="اكتب سبب طلب الحذف..." />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmBulkRequestDelete(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
              <button onClick={handleBulkRequestDelete} disabled={bulkActionLoading} className="flex-1 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {bulkActionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                إرسال الطلبات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review deletion request modal (admin) */}
      {reviewingRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => { setReviewingRequest(null); setReviewNote(""); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <FileX2 className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">مراجعة طلب الحذف</h3>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">المريض</span>
                <span className="text-sm font-medium text-slate-800">{reviewingRequest.patient_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">الكود</span>
                <span className="text-sm font-mono text-slate-700" dir="ltr">{reviewingRequest.patient_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">طلب بواسطة</span>
                <span className="text-sm font-medium text-slate-800">{reviewingRequest.requester_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">التاريخ</span>
                <span className="text-sm text-slate-700">{new Date(reviewingRequest.created_at).toLocaleDateString("ar-EG")}</span>
              </div>
              {reviewingRequest.reason && (
                <div>
                  <span className="text-xs text-slate-500 block mb-1">السبب</span>
                  <span className="text-sm text-slate-700">{reviewingRequest.reason}</span>
                </div>
              )}
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">ملاحظة المراجعة (اختياري)</label>
              <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all min-h-[60px] resize-y" placeholder="اكتب ملاحظة..." />
            </div>
            <div className="flex gap-3">
              <button onClick={() => handleReviewRequest(false)} disabled={reviewLoading} className="flex-1 py-2.5 border border-red-200 text-red-600 font-medium rounded-xl hover:bg-red-50 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {reviewLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                <XCircle className="w-4 h-4" />
                رفض
              </button>
              <button onClick={() => handleReviewRequest(true)} disabled={reviewLoading} className="flex-1 py-2.5 bg-emerald-500 text-white font-semibold rounded-xl hover:bg-emerald-600 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {reviewLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                <Check className="w-4 h-4" />
                موافقة وحذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && canCreateEdit && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-2xl shadow-2xl px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 sm:gap-4 max-w-[calc(100vw-2rem)]">
          <div className="flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium whitespace-nowrap">{selectedIds.size} حالة محددة</span>
          </div>
          <div className="h-5 w-px bg-slate-700 hidden sm:block" />
          <div className="flex items-center gap-2">
            <UserCog className="w-4 h-4 text-cyan-400" />
            <select
              value={bulkDoctorId}
              onChange={(e) => setBulkDoctorId(e.target.value)}
              className="bg-slate-800 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
            >
              <option value="">تغيير الطبيب</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {bulkDoctorId && (
              <button
                onClick={handleBulkChangeDoctor}
                disabled={bulkActionLoading}
                className="px-3 py-1.5 bg-cyan-500 text-white text-sm font-medium rounded-lg hover:bg-cyan-400 transition-all disabled:opacity-50"
              >
                {bulkActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد"}
              </button>
            )}
          </div>
          {canDelete && (
            <>
              <div className="h-5 w-px bg-slate-700 hidden sm:block" />
              <button
                onClick={() => setConfirmBulkDelete(true)}
                disabled={bulkActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/90 text-white text-sm font-medium rounded-lg hover:bg-red-500 transition-all disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                حذف المحدد
              </button>
            </>
          )}
          {canRequestDelete && (
            <>
              <div className="h-5 w-px bg-slate-700 hidden sm:block" />
              <button
                onClick={() => { setConfirmBulkRequestDelete(true); setDeletionReason(""); }}
                disabled={bulkActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/90 text-white text-sm font-medium rounded-lg hover:bg-amber-500 transition-all disabled:opacity-50"
              >
                <FileX2 className="w-4 h-4" />
                طلب حذف المحدد
              </button>
            </>
          )}
          <button
            onClick={clearSelection}
            className="flex items-center gap-1 px-2 py-1.5 text-slate-400 hover:text-white text-sm transition-colors"
          >
            <X className="w-4 h-4" />
            إلغاء
          </button>
        </div>
      )}

      {/* Bulk delete confirmation */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setConfirmBulkDelete(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">حذف الحالات المحددة</h3>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              هل أنت متأكد من حذف <span className="font-semibold">{selectedIds.size}</span> حالة؟ لا يمكن التراجع عن هذا الإجراء.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmBulkDelete(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
              <button onClick={handleBulkDelete} disabled={bulkActionLoading} className="flex-1 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {bulkActionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
