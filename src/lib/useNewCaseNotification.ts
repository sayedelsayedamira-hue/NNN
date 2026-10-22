import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { notifyCaseEvent } from "./push";
import type { AppUser } from "./supabase";

const NOTIFICATION_SOUND_URL = "https://actions.google.com/sounds/v1/alarms/beep_short.ogg";

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

function playNotificationSound() {
  try {
    const audio = new Audio(NOTIFICATION_SOUND_URL);
    audio.volume = 0.8;
    audio.play().catch(() => {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, ctx.currentTime);
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.5);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

async function showInAppNotification(title: string, body: string, caseId: string | null) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      reg.showNotification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        tag: caseId ? `case-${caseId}` : "radiology-notification",
        renotify: true,
        data: { url: "/", caseId },
      } as NotificationOptions & { renotify: boolean });
    } else {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  } catch {
    // ignore
  }
}

export function useNewCaseNotification(user: AppUser | null) {
  const knownCaseIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const prefsRef = useRef<NotifPrefs>(DEFAULT_PREFS);
  const userId = user?.id ?? null;
  const role = user?.role ?? null;

  // Load notification preferences
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("enabled, sound_enabled, notify_new_case, notify_reassigned, notify_status_change")
        .eq("user_id", userId)
        .maybeSingle();
      if (data) {
        prefsRef.current = data as NotifPrefs;
      }
    })();

    // Subscribe to preference changes so toggles take effect immediately
    const prefsChannel = supabase
      .channel(`prefs-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notification_preferences", filter: `user_id=eq.${userId}` },
        (payload) => {
          const newRow = payload.new as NotifPrefs;
          if (newRow) prefsRef.current = { ...DEFAULT_PREFS, ...newRow };
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(prefsChannel); };
  }, [userId]);

  useEffect(() => {
    if (!userId || !role) return;

    // Preload existing case IDs so we only notify on truly new ones
    (async () => {
      let query = supabase.from("cases").select("id, assigned_doctor_id");
      if (role === "doctor") {
        query = query.eq("assigned_doctor_id", userId);
      }
      const { data } = await query;
      if (data) {
        knownCaseIds.current = new Set(data.map((c: { id: string }) => c.id));
      }
      initialized.current = true;
    })();

    const channel = supabase
      .channel(`doctor-notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cases" },
        (payload) => {
          if (!initialized.current) return;
          const newCase = payload.new as { id: string; assigned_doctor_id: string };
          if (newCase.assigned_doctor_id !== userId) return;
          if (knownCaseIds.current.has(newCase.id)) return;
          knownCaseIds.current.add(newCase.id);

          const prefs = prefsRef.current;
          if (!prefs.enabled || !prefs.notify_new_case) return;

          if (prefs.sound_enabled) playNotificationSound();
          showInAppNotification("حالة جديدة", "تم إضافة حالة جديدة إلى قائمتك", newCase.id);

          notifyCaseEvent("new_case", { caseId: newCase.id, targetUserId: userId }).catch(() => {});
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "cases" },
        (payload) => {
          if (!initialized.current) return;
          const updatedCase = payload.new as { id: string; assigned_doctor_id: string; status: string };
          const oldCase = payload.old as { assigned_doctor_id: string; status: string } | null;

          const prefs = prefsRef.current;
          if (!prefs.enabled) return;

          // Reassignment: case was assigned to this doctor
          if (
            role === "doctor" &&
            updatedCase.assigned_doctor_id === userId &&
            oldCase?.assigned_doctor_id !== userId &&
            !knownCaseIds.current.has(updatedCase.id) &&
            prefs.notify_reassigned
          ) {
            knownCaseIds.current.add(updatedCase.id);
            if (prefs.sound_enabled) playNotificationSound();
            showInAppNotification("حالة مسندة إليك", "تم إسناد حالة جديدة إليك", updatedCase.id);
            notifyCaseEvent("reassigned", { caseId: updatedCase.id, targetUserId: userId, prevDoctorId: oldCase?.assigned_doctor_id }).catch(() => {});
          }

          // Status change: notify admins/coordinators when a doctor changes status
          if (
            (role === "admin" || role === "coordinator") &&
            oldCase?.status !== updatedCase.status &&
            prefs.notify_status_change
          ) {
            const statusLabel = updatedCase.status === "finished" ? "مكتمل" : updatedCase.status === "in_progress" ? "قيد التنفيذ" : "قيد الانتظار";
            if (prefs.sound_enabled) playNotificationSound();
            showInAppNotification("تحديث حالة", `تم تغيير حالة إلى: ${statusLabel}`, updatedCase.id);
            notifyCaseEvent("status_change", { caseId: updatedCase.id, newStatus: updatedCase.status, prevStatus: oldCase?.status }).catch(() => {});
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, role]);
}
