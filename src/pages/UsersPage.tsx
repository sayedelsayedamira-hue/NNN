import { useEffect, useState, useCallback } from "react";
import { supabase, type User, type UserRole, ROLE_OPTIONS, ROLE_LABELS, DAYS_OF_WEEK } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { UserPlus, Trash2, Loader2, X, Users, Phone, Pencil, KeyRound, CheckCircle2, XCircle, Calendar, Plus, Eye } from "lucide-react";

interface ScheduleEntry {
  day_of_week: string;
  start_time: string;
  end_time: string;
  notes: string;
}

interface FormData {
  name: string;
  mobile: string;
  password: string;
  role: UserRole;
  specialty: string;
  technical_notes: string;
  status: string;
}

const emptyForm: FormData = { name: "", mobile: "", password: "", role: "doctor", specialty: "", technical_notes: "", status: "active" };

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const isViewer = currentUser?.role === "viewer";
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetSaving, setResetSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select("id, name, mobile, role, specialty, technical_notes, status, created_at")
      .order("created_at", { ascending: false });
    if (!error && data) setUsers(data as User[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const openCreate = () => {
    setEditUser(null);
    setForm(emptyForm);
    setScheduleEntries([]);
    setError(null);
    setShowModal(true);
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({ name: u.name, mobile: u.mobile, password: "", role: u.role, specialty: u.specialty ?? "", technical_notes: u.technical_notes ?? "", status: u.status });
    setScheduleEntries([]);
    setError(null);
    setShowModal(true);
  };

  const addScheduleEntry = () => {
    setScheduleEntries([...scheduleEntries, { day_of_week: "saturday", start_time: "09:00", end_time: "17:00", notes: "" }]);
  };

  const removeScheduleEntry = (idx: number) => {
    setScheduleEntries(scheduleEntries.filter((_, i) => i !== idx));
  };

  const updateScheduleEntry = (idx: number, field: keyof ScheduleEntry, value: string) => {
    setScheduleEntries(scheduleEntries.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleSave = async () => {
    setError(null);
    if (!form.name.trim() || !form.mobile.trim()) { setError("الاسم ورقم الهاتف مطلوبان"); return; }
    if (!editUser && form.password.length < 6) { setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); return; }

    setSaving(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      if (editUser) {
        const response = await fetch(`${supabaseUrl}/functions/v1/auth-manage-users`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ action: "update", id: editUser.id, name: form.name, mobile: form.mobile, role: form.role, specialty: form.specialty, technical_notes: form.technical_notes, status: form.status }),
        });
        const result = await response.json();
        if (!response.ok) { setError(result.error || "فشل التحديث"); setSaving(false); return; }
      } else {
        const response = await fetch(`${supabaseUrl}/functions/v1/auth-manage-users`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            action: "create",
            name: form.name,
            mobile: form.mobile,
            password: form.password,
            role: form.role,
            specialty: form.specialty,
            technical_notes: form.technical_notes,
            schedules: form.role === "doctor" ? scheduleEntries : [],
          }),
        });
        const result = await response.json();
        if (!response.ok) { setError(result.error || "فشل الإنشاء"); setSaving(false); return; }
      }
      setShowModal(false);
      loadUsers();
    } catch { setError("خطأ في الشبكة"); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${supabaseUrl}/functions/v1/auth-manage-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "delete", userId: confirmDelete.id }),
      });
      if (response.ok) { setConfirmDelete(null); loadUsers(); }
    } catch { /* ignore */ }
  };

  const handleResetPassword = async () => {
    if (!resetUser || !newPassword) return;
    if (newPassword.length < 6) { setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); return; }
    setResetSaving(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${supabaseUrl}/functions/v1/auth-manage-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "resetPassword", userId: resetUser.id, newPassword }),
      });
      if (response.ok) { setResetUser(null); setNewPassword(""); setError(null); }
    } catch { /* ignore */ }
    setResetSaving(false);
  };

  const inputClass = "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all";

  const roleBadge = (role: UserRole) => {
    const styles: Record<UserRole, string> = { admin: "bg-cyan-100 text-cyan-700", coordinator: "bg-teal-100 text-teal-700", doctor: "bg-blue-100 text-blue-700", viewer: "bg-slate-200 text-slate-700" };
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${styles[role]}`}>{ROLE_LABELS[role]}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">المستخدمون</h1>
          <p className="text-slate-500 text-sm mt-1">إدارة حسابات المسؤولين والمنسقين والأطباء</p>
        </div>
        {!isViewer && (
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 transition-all text-sm shadow-lg shadow-cyan-500/20">
            <UserPlus className="w-4 h-4" />
            إضافة مستخدم
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-slate-300 animate-spin" /></div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center"><Users className="w-6 h-6 text-slate-300" /></div>
            <p className="text-sm mt-2">لا يوجد مستخدمون</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">الاسم</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">الهاتف</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">الدور</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">التخصص</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">الحالة</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center text-sm font-semibold text-blue-700">{u.name.charAt(0).toUpperCase()}</div>
                        <span className="text-sm font-medium text-slate-800">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2 text-sm text-slate-600" dir="ltr"><Phone className="w-3.5 h-3.5 text-slate-400" />{u.mobile}</div></td>
                    <td className="px-4 py-3">{roleBadge(u.role)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{u.specialty ?? "—"}</td>
                    <td className="px-4 py-3">
                      {u.status === "active" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> نشط</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400"><XCircle className="w-3.5 h-3.5" /> غير نشط</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isViewer ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 bg-slate-100">
                            <Eye className="w-3.5 h-3.5 ml-1" />
                            عرض
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setResetUser(u)} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" title="إعادة تعيين كلمة المرور"><KeyRound className="w-4 h-4" /></button>
                          <button onClick={() => openEdit(u)} className="p-2 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-all"><Pencil className="w-4 h-4" /></button>
                          {u.role !== "admin" && (
                            <button onClick={() => setConfirmDelete(u)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
              <h2 className="text-xl font-bold text-slate-800">{editUser ? "تعديل مستخدم" : "إضافة مستخدم"}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">الاسم</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="أدخل الاسم" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">رقم الهاتف</label>
                <input type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className={inputClass} placeholder="رقم الهاتف" dir="ltr" style={{ textAlign: "right" }} />
              </div>
              {!editUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور</label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} placeholder="6 أحرف على الأقل" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">الدور</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} className={inputClass}>
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">التخصص</label>
                <input type="text" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} className={inputClass} placeholder="مثال: أشعة الجهاز العصبي" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">ملاحظات فنية</label>
                <textarea value={form.technical_notes} onChange={(e) => setForm({ ...form, technical_notes: e.target.value })} className={inputClass + " min-h-[60px] resize-y"} placeholder="ملاحظات فنية..." />
              </div>
              {editUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">الحالة</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputClass}>
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                  </select>
                </div>
              )}

              {/* Schedule entries for new doctors */}
              {!editUser && form.role === "doctor" && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-cyan-600" />
                      <span className="text-sm font-semibold text-slate-700">أيام وساعات العمل</span>
                    </div>
                    <button type="button" onClick={addScheduleEntry} className="flex items-center gap-1 text-xs text-cyan-600 hover:text-cyan-700 font-medium">
                      <Plus className="w-3.5 h-3.5" />
                      إضافة يوم
                    </button>
                  </div>
                  {scheduleEntries.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-2">لم تتم إضافة أيام عمل. يمكن إضافتها لاحقاً من صفحة الجداول.</p>
                  )}
                  {scheduleEntries.map((entry, idx) => (
                    <div key={idx} className="flex flex-wrap items-end gap-2 pb-3 border-b border-slate-100 last:border-0">
                      <div className="flex-1 min-w-[120px]">
                        <label className="block text-xs text-slate-500 mb-1">اليوم</label>
                        <select value={entry.day_of_week} onChange={(e) => updateScheduleEntry(idx, "day_of_week", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                          {DAYS_OF_WEEK.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      </div>
                      <div className="w-24">
                        <label className="block text-xs text-slate-500 mb-1">من</label>
                        <input type="time" value={entry.start_time} onChange={(e) => updateScheduleEntry(idx, "start_time", e.target.value)} className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400/40" dir="ltr" />
                      </div>
                      <div className="w-24">
                        <label className="block text-xs text-slate-500 mb-1">إلى</label>
                        <input type="time" value={entry.end_time} onChange={(e) => updateScheduleEntry(idx, "end_time", e.target.value)} className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400/40" dir="ltr" />
                      </div>
                      <button type="button" onClick={() => removeScheduleEntry(idx)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex gap-3 p-6 border-t border-slate-100 sticky bottom-0 bg-white">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all">إلغاء</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20">
                {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "حفظ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => { setResetUser(null); setNewPassword(""); setError(null); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center"><KeyRound className="w-5 h-5 text-amber-600" /></div>
              <h3 className="text-lg font-bold text-slate-800">إعادة تعيين كلمة المرور</h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">إعادة تعيين كلمة المرور لـ <span className="font-semibold">{resetUser.name}</span></p>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} placeholder="كلمة المرور الجديدة" />
            {error && <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-600">{error}</div>}
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setResetUser(null); setNewPassword(""); setError(null); }} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
              <button onClick={handleResetPassword} disabled={resetSaving} className="flex-1 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 disabled:opacity-50 transition-all text-sm">
                {resetSaving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "إعادة تعيين"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center"><Trash2 className="w-5 h-5 text-red-600" /></div>
              <h3 className="text-lg font-bold text-slate-800">حذف مستخدم</h3>
            </div>
            <p className="text-sm text-slate-600 mb-6">هل أنت متأكد من حذف <span className="font-semibold">{confirmDelete.name}</span>؟</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all text-sm">إلغاء</button>
              <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all text-sm">حذف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
