import { supabase } from "./supabase";
import type { AppUser } from "./supabase";

const SW_PATH = "/sw.js";
const VAPID_PUBLIC_KEY = "BHooX6-hWC0imy8tYkPTRG5Rr0hbq1eqmvp8rXRsMll3bslJ-oud6wyRjp-4Oj4Zzi7gX5NwcsZNylwkP3TQgqY";

export interface PushSubscriptionState {
  subscribed: boolean;
  permission: NotificationPermission | "unsupported";
  endpoint: string | null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`انتهت مهلة ${label} (${ms}ms)`)), ms)
    ),
  ]);
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    // Use register() directly — it returns a registration even before the SW is active.
    // Do NOT await navigator.serviceWorker.ready — it can hang forever in iframe/preview environments.
    const reg = await withTimeout(
      navigator.serviceWorker.register(SW_PATH, { scope: "/" }),
      10000,
      "تسجيل خدمة الإشعارات"
    );
    return reg;
  } catch (err) {
    console.error("[push] SW registration failed:", err);
    return null;
  }
}

export async function getSubscriptionState(): Promise<PushSubscriptionState> {
  if (!isPushSupported()) {
    return { subscribed: false, permission: "unsupported", endpoint: null };
  }

  const permission = "Notification" in window ? Notification.permission : "unsupported";

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { subscribed: false, permission, endpoint: null };

    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      return { subscribed: true, permission, endpoint: sub.endpoint };
    }
  } catch (err) {
    console.error("[push] getSubscriptionState error:", err);
  }

  return { subscribed: false, permission, endpoint: null };
}

export async function subscribePush(user: AppUser): Promise<{ error: string | null }> {
  if (!isPushSupported()) {
    return { error: "المتصفح لا يدعم الإشعارات" };
  }

  try {
    // Step 1: Register service worker
    console.log("[push] Step 1: Registering service worker...");
    const reg = await registerServiceWorker();
    if (!reg) {
      return { error: "فشل تسجيل خدمة الإشعارات (Service Worker). تأكد من استخدام Chrome أو Edge." };
    }
    console.log("[push] Step 1 done: SW registered");

    // Step 2: Request notification permission
    console.log("[push] Step 2: Requesting permission, current:", Notification.permission);
    if (Notification.permission === "default") {
      const perm = await withTimeout(
        Notification.requestPermission(),
        15000,
        "طلب إذن الإشعارات"
      );
      console.log("[push] Permission result:", perm);
      if (perm !== "granted") {
        return { error: "تم رفض إذن الإشعارات. يرجى السماح بالإشعارات من إعدادات المتصفح." };
      }
    } else if (Notification.permission === "denied") {
      return { error: "إشعارات المتصفح محظورة. يرجى السماح بها من إعدادات المتصفح (أيقونة القفل بجانب العنوان)." };
    }
    console.log("[push] Step 2 done: permission granted");

    // Step 3: Create push subscription
    console.log("[push] Step 3: Subscribing to push...");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }),
        15000,
        "إنشاء اشتراك Push"
      );
    }
    console.log("[push] Step 3 done: subscription created, endpoint:", sub.endpoint);

    // Step 4: Save to database
    console.log("[push] Step 4: Saving subscription to DB...");
    const subJson = sub.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint: subJson.endpoint,
      p256dh_key: subJson.keys!.p256dh,
      auth_key: subJson.keys!.auth,
      user_agent: navigator.userAgent,
    }, {
      onConflict: "user_id,endpoint",
    });

    if (error) {
      console.error("[push] Step 4 failed:", error.message);
      await sub.unsubscribe().catch(() => {});
      return { error: `فشل حفظ الاشتراك في الخادم: ${error.message}` };
    }
    console.log("[push] Step 4 done: saved to DB");

    return { error: null };
  } catch (err) {
    console.error("[push] subscribePush error:", err);
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return { error: `فشل الاشتراك: ${msg}` };
  }
}

export async function unsubscribePush(user: AppUser): Promise<{ error: string | null }> {
  if (!isPushSupported()) {
    return { error: "المتصفح لا يدعم الإشعارات" };
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id);

    if (error) {
      return { error: "فشل إلغاء الاشتراك من الخادم" };
    }

    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
    return { error: `فشل إلغاء الاشتراك: ${msg}` };
  }
}

export async function sendTestNotification(user: AppUser): Promise<{ error: string | null }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "غير مصرح" };

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "test",
        targetUserId: user.id,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { error: data.error || "فشل إرسال الإشعار التجريبي" };
    }

    return { error: null };
  } catch {
    return { error: "فشل الاتصال بالخادم" };
  }
}

export async function notifyCaseEvent(
  eventType: "new_case" | "reassigned" | "status_change" | "deletion_request" | "deletion_reviewed",
  payload: { caseId: string; targetUserId?: string; prevDoctorId?: string; newStatus?: string; prevStatus?: string; patientCode?: string; status?: string; count?: number }
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: "notify",
        eventType,
        caseId: payload.caseId,
        targetUserId: payload.targetUserId,
        prevDoctorId: payload.prevDoctorId,
        newStatus: payload.newStatus,
        prevStatus: payload.prevStatus,
        patientCode: payload.patientCode,
        reviewStatus: payload.status,
        count: payload.count,
      }),
    });
  } catch {
    // Silent fail — notifications are non-critical
  }
}

export function setupServiceWorkerMessageHandler(onCaseClick: (caseId: string | null) => void) {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "NOTIFICATION_CLICK") {
      onCaseClick(event.data.caseId || null);
    }
  });
}
