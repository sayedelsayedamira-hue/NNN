import { useState, useEffect, useCallback } from "react";
import { supabase, type AppUser } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { isPushSupported, getSubscriptionState, subscribePush, unsubscribePush, sendTestNotification, registerServiceWorker, setupServiceWorkerMessageHandler, type PushSubscriptionState } from "@/lib/push";
import { Bell, BellOff, Volume2, VolumeX, Send, Trash2, Loader2, CheckCircle2, AlertTriangle, Monitor, Smartphone, Info } from "lucide-react";

interface NotifPrefs {
  enabled: boolean;
  sound_enabled: boolean;
  notify_new_case: boolean;
  notify_reassigned: boolean;
  notify_status_change: boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
  enabled: true,
  sound_enabled: true,
  notify_new_case: true,
  notify_reassigned: true,
  notify_status_change: true,
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [pushSupported] = useState(isPushSupported());
  const [subState, setSubState] = useState<PushSubscriptionState>({ subscribed: false, permission: "default", endpoint: null });
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [loadingState, setLoadingState] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!user) return;
    setLoadingState(true);

    const state = await getSubscriptionState();
    setSubState(state);

    const { data } = await supabase
      .from("notification_preferences")
      .select("enabled, sound_enabled, notify_new_case, notify_reassigned, notify_status_change")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      setPrefs(data as NotifPrefs);
    }

    setLoadingState(false);
  }, [user]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    if (!user) return;
    registerServiceWorker();
    setupServiceWorkerMessageHandler(() => {
      // Could navigate to cases page on click — handled at app level
    });
  }, [user]);

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  };

  const handleSubscribe = async () => {
    if (!user) return;
    setSubscribing(true);
    setError(null);
    const { error: err } = await subscribePush(user);
    if (err) {
      setError(err);
    } else {
      flashSuccess("تم تفعيل الإشعارات بنجاح");
      await loadState();
    }
    setSubscribing(false);
  };

  const handleUnsubscribe = async () => {
    if (!user) return;
    setUnsubscribing(true);
    setError(null);
    const { error: err } = await unsubscribePush(user);
    if (err) {
      setError(err);
    } else {
      flashSuccess("تم إلغاء الاشتراك في الإشعارات");
      await loadState();
    }
    setUnsubscribing(false);
  };

  const handleTest = async () => {
    if (!user) return;
    setSendingTest(true);
    setError(null);
    const { error: err } = await sendTestNotification(user);
    if (err) {
      setError(err);
    } else {
      flashSuccess("تم إرسال إشعار تجريبي");
    }
    setSendingTest(false);
  };

  const handlePrefChange = async (key: keyof NotifPrefs, value: boolean) => {
    if (!user) return;
    const newPrefs = { ...prefs, [key]: value };
    setPrefs(newPrefs);
    setSavingPrefs(true);
    setError(null);

    const { error: err } = await supabase
      .from("notification_preferences")
      .upsert({
        user_id: user.id,
        ...newPrefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (err) {
      setError("فشل حفظ التفضيلات");
      setPrefs(prefs); // revert
    }
    setSavingPrefs(false);
  };

  const toggleClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-cyan-500" : "bg-slate-300"}`;
  const knobClass = (on: boolean) =>
    `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "-translate-x-6" : "-translate-x-1"}`;

  const Toggle = ({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={toggleClass(on)}
      aria-pressed={on}
    >
      <span className={knobClass(on)} />
    </button>
  );

  const SettingRow = ({ icon: Icon, title, desc, on, onChange, disabled }: {
    icon: typeof Bell;
    title: string;
    desc: string;
    on: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <div className="flex items-center justify-between py-4 px-4 hover:bg-slate-50 transition-colors rounded-xl">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? "bg-cyan-100 text-cyan-600" : "bg-slate-100 text-slate-400"}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
        </div>
      </div>
      <Toggle on={on} onChange={onChange} disabled={disabled} />
    </div>
  );

  if (loadingState) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-slate-300 animate-spin" />
      </div>
    );
  }

  const isSubscribed = subState.subscribed;
  const permissionDenied = subState.permission === "denied";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Bell className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">إعدادات الإشعارات</h1>
          <p className="text-slate-500 text-sm mt-1">تحكم في إشعارات سطح المكتب</p>
        </div>
      </div>

      {/* Success / Error banners */}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-600 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Browser support warning */}
      {!pushSupported && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">المتصفح لا يدعم الإشعارات</p>
            <p className="text-xs text-amber-700 mt-1">
              يستخدم هذا المتصفح إصداراً لا يدعم Web Push API. يرجى استخدام Chrome أو Edge على سطح المكتب لتلقي إشعارات Windows.
            </p>
          </div>
        </div>
      )}

      {/* Permission denied warning */}
      {pushSupported && permissionDenied && !isSubscribed && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">إشعارات المتصفح محظورة</p>
            <p className="text-xs text-amber-700 mt-1">
              يرجى السماح بالإشعارات من إعدادات المتصفح: انقر على أيقونة القفل بجانب عنوان الموقع، ثم السماح بالإشعارات، ثم أعد تحميل الصفحة.
            </p>
          </div>
        </div>
      )}

      {/* Subscription status card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSubscribed ? "bg-emerald-100" : "bg-slate-100"}`}>
              {isSubscribed ? <Monitor className="w-5 h-5 text-emerald-600" /> : <Monitor className="w-5 h-5 text-slate-400" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">حالة الاشتراك</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {isSubscribed ? "هذا الجهاز مشترك في الإشعارات" : "هذا الجهاز غير مشترك"}
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${isSubscribed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              <span className={`w-2 h-2 rounded-full ${isSubscribed ? "bg-emerald-500" : "bg-slate-400"}`} />
              {isSubscribed ? "مشترك" : "غير مشترك"}
            </span>
          </div>
        </div>

        <div className="p-5 flex flex-wrap gap-3">
          {!isSubscribed ? (
            <button
              onClick={handleSubscribe}
              disabled={subscribing || !pushSupported || permissionDenied}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-l from-cyan-500 to-blue-600 text-white font-semibold rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm shadow-lg shadow-cyan-500/20"
            >
              {subscribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
              تفعيل الإشعارات
            </button>
          ) : (
            <>
              <button
                onClick={handleTest}
                disabled={sendingTest}
                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-all text-sm"
              >
                {sendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-cyan-600" />}
                إرسال إشعار تجريبي
              </button>
              <button
                onClick={handleUnsubscribe}
                disabled={unsubscribing}
                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-red-200 text-red-600 font-medium rounded-xl hover:bg-red-50 disabled:opacity-50 transition-all text-sm"
              >
                {unsubscribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                إلغاء الاشتراك
              </button>
            </>
          )}
        </div>
      </div>

      {/* Notification preferences */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">تفضيلات الإشعارات</h2>
          <p className="text-xs text-slate-500 mt-0.5">اختر الأحداث التي تريد تلقي إشعارات عنها</p>
        </div>

        <div className="p-2 divide-y divide-slate-50">
          <SettingRow
            icon={isSubscribed ? Bell : BellOff}
            title="تفعيل الإشعارات"
            desc="تشغيل أو إيقاف جميع الإشعارات"
            on={prefs.enabled}
            onChange={(v) => handlePrefChange("enabled", v)}
          />
          <SettingRow
            icon={prefs.sound_enabled ? Volume2 : VolumeX}
            title="أصوات الإشعارات"
            desc="تشغيل صوت عند وصول إشعار جديد (داخل المتصفح)"
            on={prefs.sound_enabled}
            onChange={(v) => handlePrefChange("sound_enabled", v)}
          />

          <div className="py-3 px-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">أنواع الأحداث</p>
          </div>

          <SettingRow
            icon={Bell}
            title="حالة جديدة"
            desc="إشعار عند إضافة حالة جديدة أو إسنادها إليك"
            on={prefs.notify_new_case}
            onChange={(v) => handlePrefChange("notify_new_case", v)}
            disabled={!prefs.enabled}
          />
          <SettingRow
            icon={Bell}
            title="إعادة إسناد"
            desc="إشعار عند إعادة إسناد حالة إليك"
            on={prefs.notify_reassigned}
            onChange={(v) => handlePrefChange("notify_reassigned", v)}
            disabled={!prefs.enabled}
          />
          <SettingRow
            icon={Bell}
            title="تغيير الحالة"
            desc="إشعار عند تغيير حالة من قبل الطبيب (للمسؤولين)"
            on={prefs.notify_status_change}
            onChange={(v) => handlePrefChange("notify_status_change", v)}
            disabled={!prefs.enabled}
          />
        </div>

        {savingPrefs && (
          <div className="px-5 py-2 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            جارٍ الحفظ...
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">معلومات هامة</p>
            <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
              <li>تعمل إشعارات Windows عند استخدام Chrome أو Edge على سطح المكتب</li>
              <li>يمكن أن تصل الإشعارات حتى عند إغلاق تبويب الموقع (حسب دعم النظام)</li>
              <li>لا تتضمن الإشعارات أسماء المرضى أو تفاصيل حساسة — فقط كود المرجع</li>
              <li>يجب تسجيل الدخول لعرض تفاصيل الحالة عند النقر على الإشعار</li>
              <li>كل جهاز يحتاج لتفعيل الاشتراك بشكل منفصل</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
