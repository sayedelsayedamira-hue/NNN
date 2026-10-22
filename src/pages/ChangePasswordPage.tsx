import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { KeyRound, Loader2, Lock, CheckCircle2 } from "lucide-react";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("جميع الحقول مطلوبة");
      return;
    }
    if (newPassword.length < 6) {
      setError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("كلمة المرور الجديدة وتأكيدها غير متطابقين");
      return;
    }

    setSaving(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${supabaseUrl}/functions/v1/auth-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "فشل تغيير كلمة المرور");
        setSaving(false);
        return;
      }
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("خطأ في الشبكة");
    }
    setSaving(false);
  };

  const inputClass = "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-transparent transition-all";

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <KeyRound className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">تغيير كلمة المرور</h1>
          <p className="text-slate-500 text-sm mt-1">قم بتحديث كلمة مرورك</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        {success && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-600 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            تم تغيير كلمة المرور بنجاح
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور الحالية</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass + " pr-10"} placeholder="كلمة المرور الحالية" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">كلمة المرور الجديدة</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass + " pr-10"} placeholder="6 أحرف على الأقل" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">تأكيد كلمة المرور الجديدة</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass + " pr-10"} placeholder="أعد إدخال كلمة المرور" required />
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}

          <button type="submit" disabled={saving} className="w-full py-3 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20">
            {saving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "تغيير كلمة المرور"}
          </button>
        </form>
      </div>
    </div>
  );
}
