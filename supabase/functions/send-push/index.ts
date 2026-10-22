import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// --- Web Push implementation using Web Crypto API ---

function base64UrlToBytes(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = base64Url + padding;
  const b64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// VAPID JWT signing using ECDSA P-256
async function createVapidJwt(payload: Record<string, unknown>, privateKeyDerB64: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };

  const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the private key from DER PKCS8
  const derBytes = base64UrlToBytes(privateKeyDerB64);
  const keyData = derBytes.buffer.slice(derBytes.byteOffset, derBytes.byteOffset + derBytes.byteLength);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const signatureB64 = bytesToBase64Url(new Uint8Array(signature));
  return `${signingInput}.${signatureB64}`;
}

// AES-GCM encryption for the payload (RFC 8188)
async function encryptPayload(
  payload: string,
  p256dhB64: string,
  authB64: string
): Promise<{ ciphertext: ArrayBuffer; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const encoder = new TextEncoder();

  // 1. Generate local ECDH key pair (P-256)
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // 2. Import the subscriber's public key (p256dh)
  const subscriberPubKeyBytes = base64UrlToBytes(p256dhB64);
  const subscriberPubKey = await crypto.subtle.importKey(
    "raw",
    subscriberPubKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // 3. Compute shared secret via ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberPubKey },
    localKeyPair.privateKey,
    256
  );

  // 4. Export local public key for the header
  const localPubKeyRaw = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);
  const localPublicKey = new Uint8Array(localPubKeyRaw);

  // 5. Compute PRK via HKDF (RFC 8291)
  // HKDF(salt=auth_secret, IKM=shared_secret, info="WebPush: info\0"||ua_pub||as_pub, L=32)
  const authBytes = base64UrlToBytes(authB64);

  const webpushInfo = new Uint8Array([
    ...encoder.encode("WebPush: info\0"),
    ...subscriberPubKeyBytes,
    ...localPublicKey,
  ]);

  const ikmKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(sharedSecret),
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );

  const prk = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authBytes, info: webpushInfo },
    ikmKey,
    256
  );

  // 6. Generate random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 7. Derive content encryption key (CEK) and nonce
  // CEK = HKDF(salt, prk, "Content-Encoding: aes128gcm\0", 16)
  // Nonce = HKDF(salt, prk, "Content-Encoding: nonce\0", 12)
  const cekInfo = encoder.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = encoder.encode("Content-Encoding: nonce\0");

  const prkKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(prk),
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );

  const cek = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt, info: cekInfo },
    prkKey,
    128
  );

  const nonce = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt, info: nonceInfo },
    prkKey,
    96
  );

  // 8. Encrypt the payload with AES-128-GCM
  // Padding: 2-byte big-endian length of padding + padding bytes + 0x02 (last record)
  const payloadBytes = encoder.encode(payload);
  const padding = new Uint8Array(0); // no padding
  const paddedPayload = new Uint8Array(payloadBytes.length + padding.length + 1);
  paddedPayload.set(payloadBytes, 0);
  paddedPayload.set(padding, payloadBytes.length);
  paddedPayload[paddedPayload.length - 1] = 0x02; // last record marker

  const cekKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(cek),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) },
    cekKey,
    paddedPayload
  );

  return { ciphertext, salt, localPublicKey };
}

// Build the binary content-coding header (aes128gcm)
function buildHeader(salt: Uint8Array, localPublicKey: Uint8Array, rs: number = 4096): Uint8Array {
  // Header: salt (16) || rs (4, big-endian) || keylen (1) || keyid (65)
  const header = new Uint8Array(16 + 4 + 1 + localPublicKey.length);
  header.set(salt, 0);
  const rsView = new DataView(header.buffer, 16, 4);
  rsView.setUint32(0, rs, false); // big-endian
  header[20] = localPublicKey.length; // keyid length
  header.set(localPublicKey, 21);
  return header;
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh_key: string; auth_key: string },
  payload: Record<string, unknown>,
  vapidConfig: { vapid_public_key: string; vapid_private_key: string; vapid_subject: string }
): Promise<{ success: boolean; status: number; endpoint: string }> {
  const { endpoint, p256dh_key, auth_key } = subscription;

  // Create VAPID JWT
  const audience = new URL(endpoint).origin;
  const jwtPayload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12 hours
    sub: vapidConfig.vapid_subject,
  };
  const vapidJwt = await createVapidJwt(jwtPayload, vapidConfig.vapid_private_key);

  // Encrypt payload
  const payloadStr = JSON.stringify(payload);
  const { ciphertext, salt, localPublicKey } = await encryptPayload(payloadStr, p256dh_key, auth_key);

  // Build the binary body: header + ciphertext
  const header = buildHeader(salt, localPublicKey);
  const body = new Uint8Array(header.length + ciphertext.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(ciphertext), header.length);

  // Send to push service
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
      "Authorization": `vapid t=${vapidJwt}, k=${vapidConfig.vapid_public_key}`,
    },
    body: body,
  });

  return { success: response.status === 201 || response.status === 200, status: response.status, endpoint };
}

// --- Main edge function ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify the caller's JWT
    const pubClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: authUser }, error: authError } = await pubClient.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const callerUserId = authUser.app_metadata?.custom_user_id;
    const callerRole = authUser.app_metadata?.role;
    if (!callerUserId) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const action = body.action;

    // --- TEST notification ---
    if (action === "test") {
      const targetUserId = body.targetUserId;
      if (!targetUserId || targetUserId !== callerUserId) {
        return new Response(JSON.stringify({ error: "غير مصرح" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const result = await sendNotificationToUser(supabase, targetUserId, {
        title: "إشعار تجريبي",
        body: "تم تشغيل الإشعارات بنجاح. ستتصلك إشعارات الحالات الجديدة هنا.",
        tag: "test-notification",
        url: "/",
      });

      return new Response(JSON.stringify({ success: true, sent: result.sent, removed: result.removed }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- NOTIFY (triggered after case event) ---
    if (action === "notify") {
      const { eventType, caseId, targetUserId, prevDoctorId } = body;

      if (!eventType || !caseId) {
        return new Response(JSON.stringify({ error: "بيانات غير مكتملة" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Verify the case exists and get its current state
      const { data: caseData } = await supabase
        .from("cases")
        .select("id, assigned_doctor_id, status, patient_code, priority")
        .eq("id", caseId)
        .maybeSingle();

      if (!caseData) {
        return new Response(JSON.stringify({ error: "الحالة غير موجودة" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const recipients: { userId: string; eventType: string }[] = [];

      if (eventType === "deletion_request") {
        // Notify all admins about a pending deletion request
        const { data: admins } = await supabase
          .from("users")
          .select("id")
          .eq("role", "admin")
          .eq("status", "active");
        if (admins) {
          for (const a of admins) {
            if (a.id !== callerUserId) {
              recipients.push({ userId: a.id, eventType: "deletion_request" });
            }
          }
        }
      } else if (eventType === "deletion_reviewed") {
        // Notify the requester about the review result
        if (targetUserId) {
          recipients.push({ userId: targetUserId, eventType: "deletion_reviewed" });
        }
      } else if (eventType === "new_case") {
        // Notify the assigned doctor (if targetUserId specified, only notify that user)
        if (targetUserId) {
          recipients.push({ userId: targetUserId, eventType: "new_case" });
        } else if (caseData.assigned_doctor_id) {
          recipients.push({ userId: caseData.assigned_doctor_id, eventType: "new_case" });
          // Also notify admins (except the creator)
          const { data: admins } = await supabase
            .from("users")
            .select("id")
            .eq("role", "admin")
            .eq("status", "active");
          if (admins) {
            for (const a of admins) {
              if (a.id !== callerUserId) {
                recipients.push({ userId: a.id, eventType: "new_case" });
              }
            }
          }
        }
      } else if (eventType === "reassigned") {
        // Notify the newly assigned doctor only
        if (targetUserId) {
          recipients.push({ userId: targetUserId, eventType: "reassigned" });
        } else if (caseData.assigned_doctor_id && caseData.assigned_doctor_id !== prevDoctorId) {
          recipients.push({ userId: caseData.assigned_doctor_id, eventType: "reassigned" });
        }
      } else if (eventType === "status_change") {
        // Notify admins about status change
        const { data: admins } = await supabase
          .from("users")
          .select("id")
          .eq("role", "admin")
          .eq("status", "active");
        if (admins) {
          for (const a of admins) {
            recipients.push({ userId: a.id, eventType: "status_change" });
          }
        }
      }

      let totalSent = 0;
      let totalRemoved = 0;

      for (const recipient of recipients) {
        // Check notification preferences
        const { data: prefs } = await supabase
          .from("notification_preferences")
          .select("enabled, notify_new_case, notify_reassigned, notify_status_change")
          .eq("user_id", recipient.userId)
          .maybeSingle();

        if (prefs) {
          if (!prefs.enabled) continue;
          if (recipient.eventType === "new_case" && !prefs.notify_new_case) continue;
          if (recipient.eventType === "reassigned" && !prefs.notify_reassigned) continue;
          if (recipient.eventType === "status_change" && !prefs.notify_status_change) continue;
          // deletion_request and deletion_reviewed are new event types — no prefs check yet
        }

        // Build non-sensitive notification payload
        const notifPayload = buildNotificationPayload(
          recipient.eventType,
          caseData.patient_code,
          caseId,
          caseData.priority,
          body.reviewStatus as string | undefined,
          body.count as number | undefined,
        );

        const result = await sendNotificationToUser(supabase, recipient.userId, notifPayload);
        totalSent += result.sent;
        totalRemoved += result.removed;

        // Log the notification
        await supabase.from("notification_log").upsert({
          event_id: `${caseId}:${recipient.eventType}:${recipient.userId}`,
          user_id: recipient.userId,
          case_id: caseId,
          event_type: recipient.eventType,
        }, { onConflict: "event_id" });
      }

      return new Response(JSON.stringify({ success: true, sent: totalSent, removed: totalRemoved }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "إجراء غير معروف" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `حدث خطأ غير متوقع: ${msg}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// --- Helper functions ---

function buildNotificationPayload(
  eventType: string,
  patientCode: string,
  caseId: string,
  priority: string,
  reviewStatus?: string,
  count?: number,
): Record<string, unknown> {
  const priorityLabel = priority === "critical" ? "حرج" : priority === "urgent" ? "عاجل" : "روتيني";

  if (eventType === "new_case") {
    return {
      title: "حالة جديدة",
      body: `تم إضافة حالة جديدة - الأولوية: ${priorityLabel} - المرجع: ${patientCode}`,
      tag: `new-${caseId}`,
      url: "/",
      caseId,
    };
  }
  if (eventType === "reassigned") {
    return {
      title: "حالة مسندة إليك",
      body: `تم إسناد حالة جديدة إليك - المرجع: ${patientCode}`,
      tag: `reassign-${caseId}`,
      url: "/",
      caseId,
    };
  }
  if (eventType === "status_change") {
    return {
      title: "تحديث حالة",
      body: `تم تحديث حالة - المرجع: ${patientCode}`,
      tag: `status-${caseId}`,
      url: "/",
      caseId,
    };
  }
  if (eventType === "deletion_request") {
    return {
      title: "طلب حذف حالة",
      body: `يوجد طلب حذف حالة جديد بانتظار الموافقة - المرجع: ${patientCode}`,
      tag: `del-req-${caseId}`,
      url: "/",
      caseId,
    };
  }
  if (eventType === "deletion_reviewed") {
    if (reviewStatus === "approved") {
      return {
        title: "تمت الموافقة على الحذف",
        body: count ? `تمت الموافقة على حذف ${count} حالة` : `تمت الموافقة على حذف الحالة - المرجع: ${patientCode}`,
        tag: `del-approved-${caseId}`,
        url: "/",
        caseId,
      };
    }
    return {
      title: "تم رفض الحذف",
      body: count ? `تم رفض طلب حذف ${count} حالة` : `تم رفض طلب حذف الحالة - المرجع: ${patientCode}`,
      tag: `del-rejected-${caseId}`,
      url: "/",
      caseId,
    };
  }
  return { title: "إشعار", body: "لديك إشعار جديد", url: "/" };
}

async function sendNotificationToUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  payload: Record<string, unknown>
): Promise<{ sent: number; removed: number }> {
  // Get VAPID config
  const { data: config } = await supabase
    .from("notification_config")
    .select("vapid_public_key, vapid_private_key, vapid_subject")
    .eq("id", 1)
    .maybeSingle();

  if (!config) return { sent: 0, removed: 0 };

  // Get all push subscriptions for the user
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("user_id", userId);

  if (!subscriptions || subscriptions.length === 0) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;

  for (const sub of subscriptions) {
    try {
      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh_key: sub.p256dh_key, auth_key: sub.auth_key },
        payload,
        config
      );

      if (result.success) {
        sent++;
      } else if (result.status === 404 || result.status === 410) {
        // Subscription expired — remove it
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        removed++;
      }
    } catch {
      // Individual subscription failure — continue to next
    }
  }

  return { sent, removed };
}
