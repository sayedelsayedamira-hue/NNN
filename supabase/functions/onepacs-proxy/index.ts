import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEFAULT_BASE_URL = "https://my.onepacs.com";
const DEFAULT_WORKLIST_ENDPOINT = "/json/worklist/WorklistAjax.action";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface OnePacsConfig {
  baseUrl: string;
  username: string;
  password: string;
  worklistEndpoint: string;
}

interface OnePacsSession {
  cookies: string;
  finalUrl: string;
}

interface FetchParams {
  start: number;
  limit: number;
  sort?: string;
  dir?: string;
  search?: string;
}

interface WorklistResult {
  records: Record<string, unknown>[];
  total: number;
  start: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("غير مصرح", 401);

    const pubClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: authUser }, error: authError } = await pubClient.auth.getUser();
    if (authError || !authUser) return jsonError("غير مصرح", 401);

    const callerRole = authUser.app_metadata?.role;
    const allowedRoles = ["admin", "coordinator", "viewer"];
    if (!allowedRoles.includes(callerRole)) return jsonError("ليس لديك صلاحية للوصول لهذه البيانات", 403);

    const body = await req.json();
    const action = body.action;

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- Config management (admin only) ---
    if (action === "getConfig") {
      if (callerRole !== "admin") return jsonError("فقط المسؤول يمكنه إدارة الإعدادات", 403);
      const { data } = await adminSupabase
        .from("onepacs_config")
        .select("id, base_url, username, worklist_endpoint, enabled, updated_at")
        .eq("id", 1)
        .maybeSingle();
      return jsonResponse({ config: data ?? null });
    }

    if (action === "saveConfig") {
      if (callerRole !== "admin") return jsonError("فقط المسؤول يمكنه إدارة الإعدادات", 403);
      const { baseUrl, username, password, worklistEndpoint, enabled } = body;
      if (!username || !password) return jsonError("اسم المستخدم وكلمة المرور مطلوبة", 400);

      // Strip any path/query from base_url — it must be just the origin
      let cleanBaseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
      try {
        const parsed = new URL(cleanBaseUrl);
        cleanBaseUrl = `${parsed.protocol}//${parsed.host}`;
      } catch { /* keep as-is if URL parsing fails */ }

      const row = {
        id: 1,
        base_url: cleanBaseUrl,
        username,
        password,
        worklist_endpoint: worklistEndpoint || null,
        enabled: enabled !== false,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await adminSupabase
        .from("onepacs_config")
        .upsert(row, { onConflict: "id" });

      if (upsertError) return jsonError(`فشل حفظ الإعدادات: ${upsertError.message}`, 500);
      return jsonResponse({ success: true });
    }

    // --- Data actions ---
    const config = await loadConfig(adminSupabase);
    if (!config) return jsonError("لم يتم إعداد بيانات OnePacs. المسؤول يجب أن يضيفها من صفحة الإعدادات.", 500);

    if (action === "diagnose") {
      if (callerRole !== "admin") return jsonError("فقط المسؤول يمكنه التشخيص", 403);
      return await runDiagnostic(config);
    }

    if (action === "test") {
      const session = await loginToOnePacs(config);
      const result = await fetchOnePacsWorklist(config, session, { start: 0, limit: 1 });
      return jsonResponse({
        success: true,
        message: `الاتصال ناجح. تم استلام ${result.records.length} سجل (إجمالي: ${result.total}).`,
        total: result.total,
      });
    }

    if (action === "fetch") {
      const start: number = body.start ?? 0;
      const limit: number = body.limit ?? 50;
      const sort: string = body.sort ?? "receivedTime";
      const dir: string = body.dir ?? "DESC";
      const search: string = body.search ?? "";

      const session = await loginToOnePacs(config);
      const result = await fetchOnePacsWorklist(config, session, { start, limit, sort, dir, search });
      return jsonResponse(result);
    }

    // --- Field mapping management (admin only) ---
    if (action === "getMapping") {
      const { data } = await adminSupabase
        .from("onepacs_field_mapping")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      return jsonResponse({ mapping: data ?? null });
    }

    if (action === "saveMapping") {
      if (callerRole !== "admin") return jsonError("فقط المسؤول يمكنه إدارة الإعدادات", 403);
      const m = body.mapping;
      if (!m) return jsonError("بيانات الربط مطلوبة", 400);

      const row = {
        id: 1,
        case_patient_name: m.case_patient_name ?? "name",
        case_patient_code: m.case_patient_code ?? "patientId",
        case_exam_type: m.case_exam_type ?? "modalitiesInStudy",
        case_exam_name: m.case_exam_name ?? "studyDescription",
        case_status: m.case_status ?? "status",
        case_priority: m.case_priority ?? "stat",
        case_notes: m.case_notes ?? "patientNotes",
        case_onepacs_study_uid: m.case_onepacs_study_uid ?? "studyIuid",
        case_onepacs_link: m.case_onepacs_link ?? "studyPk",
        auto_sync_enabled: m.auto_sync_enabled ?? false,
        sync_interval_minutes: m.sync_interval_minutes ?? 5,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await adminSupabase
        .from("onepacs_field_mapping")
        .upsert(row, { onConflict: "id" });

      if (upsertError) return jsonError(`فشل حفظ الربط: ${upsertError.message}`, 500);
      return jsonResponse({ success: true });
    }

    // --- Sync OnePacs records to cases table ---
    if (action === "sync") {
      if (callerRole !== "admin") return jsonError("فقط المسؤول يمكنه المزامنة", 403);

      // Load field mapping
      const { data: mappingData } = await adminSupabase
        .from("onepacs_field_mapping")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (!mappingData) return jsonError("لم يتم إعداد ربط الحقول. احفظ الإعدادات أولاً.", 400);

      // Fetch all worklist records from OnePacs
      const session = await loginToOnePacs(config);
      const result = await fetchOnePacsWorklist(config, session, { start: 0, limit: 500, sort: "receivedTime", dir: "DESC" });

      if (result.records.length === 0) {
        return jsonResponse({ success: true, message: "لا توجد حالات في OnePacs للمزامنة.", synced: 0 });
      }

      // Map OnePacs records to cases rows using the field mapping
      const casesRows = result.records.map((record: Record<string, unknown>) => {
        const getVal = (fieldName: string): string => {
          const val = record[fieldName];
          if (val === null || val === undefined) return "";
          if (typeof val === "boolean") return val ? "true" : "false";
          return String(val);
        };

        const studyUid = getVal(mappingData.case_onepacs_study_uid);
        const studyPk = getVal(mappingData.case_onepacs_link);

        // Build OnePacs link URL
        const onePacsLink = studyPk
          ? `${config.baseUrl}/x/s/l/${studyPk}`
          : null;

        // Map status: OnePacs status -> our status
        const onePacsStatus = getVal(mappingData.case_status).toLowerCase();
        let caseStatus = "pending";
        if (onePacsStatus.includes("read") || onePacsStatus.includes("assigned")) caseStatus = "in_progress";
        else if (onePacsStatus.includes("dictated") || onePacsStatus.includes("transcribed")) caseStatus = "completed";
        else if (onePacsStatus.includes("confirmed")) caseStatus = "completed";

        // Map priority: OnePacs stat -> our priority
        const onePacsStat = getVal(mappingData.case_priority).toLowerCase();
        const casePriority = onePacsStat === "true" || onePacsStat === "stat" ? "urgent" : "routine";

        return {
          patient_name: getVal(mappingData.case_patient_name) || "غير معروف",
          patient_code: getVal(mappingData.case_patient_code) || "",
          exam_type: getVal(mappingData.case_exam_type) || "",
          exam_name: getVal(mappingData.case_exam_name) || "",
          status: caseStatus,
          priority: casePriority,
          notes: getVal(mappingData.case_notes) || null,
          onepacs_study_uid: studyUid || null,
          onepacs_link: onePacsLink,
        };
      });

      // Deduplicate by study_uid — skip records that already exist
      let inserted = 0;
      let skipped = 0;

      for (const row of casesRows) {
        if (!row.onepacs_study_uid) {
          // No study UID — check by patient_code + exam_name to avoid duplicates
          const { data: existing } = await adminSupabase
            .from("cases")
            .select("id")
            .eq("patient_code", row.patient_code)
            .eq("exam_name", row.exam_name)
            .limit(1);

          if (existing && existing.length > 0) {
            skipped++;
            continue;
          }
        } else {
          const { data: existing } = await adminSupabase
            .from("cases")
            .select("id")
            .eq("onepacs_study_uid", row.onepacs_study_uid)
            .limit(1);

          if (existing && existing.length > 0) {
            skipped++;
            continue;
          }
        }

        const { error: insertError } = await adminSupabase
          .from("cases")
          .insert(row);

        if (insertError) {
          console.error("Insert error:", insertError.message, "row:", JSON.stringify(row));
        } else {
          inserted++;
        }
      }

      return jsonResponse({
        success: true,
        message: `تمت مزامنة ${inserted} حالة من OnePacs. تم تخطي ${skipped} حالة موجودة.`,
        synced: inserted,
        skipped,
        total: result.total,
      });
    }

    return jsonError("إجراء غير معروف.", 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`حدث خطأ: ${msg}`, 500);
  }
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(msg: string, status = 500): Response {
  return jsonResponse({ error: msg }, status);
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

async function loadConfig(supabase: ReturnType<typeof createClient>): Promise<OnePacsConfig | null> {
  const { data } = await supabase
    .from("onepacs_config")
    .select("base_url, username, password, worklist_endpoint, enabled")
    .eq("id", 1)
    .maybeSingle();

  if (!data || !data.enabled || !data.username || !data.password) return null;

  return {
    baseUrl: (data.base_url || DEFAULT_BASE_URL).replace(/\/$/, ""),
    username: data.username,
    password: data.password,
    worklistEndpoint: data.worklist_endpoint || DEFAULT_WORKLIST_ENDPOINT,
  };
}

// ---------------------------------------------------------------------------
// Cookie utilities
// ---------------------------------------------------------------------------

function extractCookies(setCookieHeader: string): string {
  const parts = setCookieHeader.split(/,(?=\s*\w+=)/);
  const cookieParts: string[] = [];
  for (const part of parts) {
    const match = part.match(/^([^=]+)=([^;]*)/);
    if (match) cookieParts.push(`${match[1].trim()}=${match[2].trim()}`);
  }
  return cookieParts.join("; ");
}

function combineCookies(existing: string, setCookieHeader: string): string {
  const newCookies = extractCookies(setCookieHeader);
  if (!newCookies) return existing;
  if (!existing) return newCookies;

  const cookieMap = new Map<string, string>();
  for (const c of [...existing.split("; "), ...newCookies.split("; ")]) {
    const idx = c.indexOf("=");
    if (idx > 0) cookieMap.set(c.slice(0, idx).trim(), c.slice(idx + 1).trim());
  }
  return [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function cookieNames(cookies: string): string[] {
  return cookies.split("; ").map((c) => c.split("=")[0]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// fetchWithCookies: follows redirects manually, collecting cookies at every hop
// ---------------------------------------------------------------------------

interface HttpHop {
  url: string;
  method: string;
  status: number;
  location: string | null;
  contentType: string | null;
  setCookie: boolean;
}

async function fetchWithCookies(
  url: string,
  init: RequestInit & { cookies: string },
  maxRedirects = 8
): Promise<{ response: Response; cookies: string; hops: HttpHop[]; finalUrl: string }> {
  let currentUrl = url;
  let cookies = init.cookies;
  let response: Response | null = null;
  const hops: HttpHop[] = [];

  for (let i = 0; i <= maxRedirects; i++) {
    const headers = new Headers(init.headers);
    if (cookies) headers.set("Cookie", cookies);

    response = await fetch(currentUrl, { ...init, headers, redirect: "manual" });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookies = combineCookies(cookies, setCookie);

    const status = response.status;
    const location = response.headers.get("location");

    hops.push({
      url: currentUrl,
      method: init.method ?? "GET",
      status,
      location,
      contentType: response.headers.get("content-type"),
      setCookie: !!setCookie,
    });

    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      if (!location) break;
      currentUrl = new URL(location, currentUrl).href;
      if (status === 303 || (status === 302 && init.method === "POST")) {
        init = { ...init, method: "GET", body: undefined };
      }
      continue;
    }
    break;
  }

  return { response: response!, cookies, hops, finalUrl: currentUrl };
}

// ---------------------------------------------------------------------------
// Login to OnePacs — 3-step flow verified from /login/login.js and /login/authstandard.js
// ---------------------------------------------------------------------------

async function loginToOnePacs(config: OnePacsConfig): Promise<OnePacsSession> {
  const baseUrl = config.baseUrl;

  // Step 1: GET /login — establishes a SESSION cookie
  const step1 = await fetchWithCookies(`${baseUrl}/login`, {
    method: "GET",
    cookies: "",
    headers: { "Accept": "text/html", "User-Agent": BROWSER_UA },
  });
  let cookies = step1.cookies;

  // Step 2: POST /choose-login-method with username — server selects auth method, redirects to /authstandard
  const step2Body = new URLSearchParams();
  step2Body.append("username", config.username);

  const step2 = await fetchWithCookies(`${baseUrl}/choose-login-method`, {
    method: "POST",
    cookies,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/html",
      "User-Agent": BROWSER_UA,
      "Referer": `${baseUrl}/login`,
      "Origin": baseUrl,
    },
    body: step2Body.toString(),
  }, 3);
  cookies = step2.cookies;

  // Step 3: POST /login with username + password — authenticates and sets final SESSION cookie
  const step3Body = new URLSearchParams();
  step3Body.append("username", config.username);
  step3Body.append("password", config.password);

  const step3 = await fetchWithCookies(`${baseUrl}/login`, {
    method: "POST",
    cookies,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/html",
      "User-Agent": BROWSER_UA,
      "Referer": `${baseUrl}/authstandard?username=${encodeURIComponent(config.username)}`,
      "Origin": baseUrl,
    },
    body: step3Body.toString(),
  }, 5);
  cookies = step3.cookies;

  const finalStatus = step3.response.status;
  const finalUrl = step3.finalUrl;

  // Login succeeds when redirect lands on the worklist page
  // Login fails when it redirects back to /login (without "worklist" in the URL)
  if (finalUrl.includes("/login") && !finalUrl.includes("worklist")) {
    throw new Error("فشل تسجيل الدخول إلى OnePacs — اسم المستخدم أو كلمة المرور غير صحيحة.");
  }

  if (finalStatus === 401 || finalStatus === 403) {
    throw new Error("فشل تسجيل الدخول إلى OnePacs — اسم المستخدم أو كلمة المرور غير صحيحة.");
  }

  if (!cookies) {
    throw new Error(`لم يتم استلام Cookie من OnePacs بعد تسجيل الدخول. Status: ${finalStatus}`);
  }

  return { cookies, finalUrl };
}

// ---------------------------------------------------------------------------
// Fetch worklist — retrieves the user's saved worklist filter config from
// WorklistInitialStateAjax.action, then applies those filters to the data request
// ---------------------------------------------------------------------------

const DEFAULT_WORKLIST_FILTERS: Record<string, string> = {
  "query.pastDay": "30",
  "query.daysType": "RECEIVED_TIME",
  "query.readCheck": "true",
  "query.unconfirmed": "true",
  "query.confirmed": "true",
  "query.statCheck": "true",
  "query.criticalCheck": "true",
  "query.noFlagCheck": "true",
  "query.notStatCheck": "true",
  "query.greenCheck": "true",
  "query.redCheck": "true",
  "query.statPlusCheck": "true",
  "query.blueCheck": "true",
  "query.asapCheck": "true",
  "query.assignedCheck": "true",
  "query.readyCheck": "true",
  "query.dictatedCheck": "true",
  "query.transcribedCheck": "true",
  "query.inTransCheck": "true",
  "query.disregardCheck": "true",
  "query.forComparisonCheck": "true",
  "query.confirmationNotRequired": "true",
  "query.filterProperty[0]": "PATIENT_NAME",
  "query.filterComparison[0]": "LIKE",
  "query.filterValue[0]": "",
  "query.filterProperty[1]": "STUDYDESCRIPTION",
  "query.filterComparison[1]": "LIKE",
  "query.filterValue[1]": "",
  "query.filterProperty[2]": "FACILITY_NAME",
  "query.filterComparison[2]": "LIKE",
  "query.filterValue[2]": "",
};

async function fetchWorklistFilters(
  config: OnePacsConfig,
  session: OnePacsSession
): Promise<Record<string, string>> {
  try {
    const { response } = await fetchWithCookies(
      `${config.baseUrl}/json/worklist/WorklistInitialStateAjax.action`,
      {
        method: "POST",
        cookies: session.cookies,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": BROWSER_UA,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": session.finalUrl,
        },
        body: "initialWorklistState=true",
      },
      0
    );

    if (response.ok) {
      const ct = response.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const data = await response.json() as { tabs?: Array<{ query?: Record<string, unknown> }> };
        const firstTab = data.tabs?.find((t) => t.query) ?? data.tabs?.[0];
        if (firstTab?.query) {
          const filters: Record<string, string> = {};
          for (const [key, val] of Object.entries(firstTab.query)) {
            if (typeof val === "string") {
              filters[`query.${key}`] = val;
            } else if (typeof val === "boolean") {
              filters[`query.${key}`] = val ? "true" : "false";
            }
          }
          return filters;
        }
      }
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_WORKLIST_FILTERS;
}

async function fetchOnePacsWorklist(
  config: OnePacsConfig,
  session: OnePacsSession,
  params: FetchParams
): Promise<WorklistResult> {
  const endpoint = `${config.baseUrl}${config.worklistEndpoint}`;

  // Fetch the user's saved worklist filter configuration
  const filters = await fetchWorklistFilters(config, session);

  const formData = new URLSearchParams();
  formData.append("start", String(params.start));
  formData.append("limit", String(params.limit));
  formData.append("sort", params.sort ?? "receivedTime");
  formData.append("dir", params.dir ?? "DESC");
  formData.append("jsonTableData", "true");

  // Apply saved filters
  for (const [key, val] of Object.entries(filters)) {
    formData.append(key, val);
  }

  // Override search filter if provided
  if (params.search && params.search.trim()) {
    formData.set("query.filterProperty[0]", "PATIENT_NAME");
    formData.set("query.filterComparison[0]", "LIKE");
    formData.set("query.filterValue[0]", params.search.trim());
  }

  // POST attempt
  const postResult = await fetchWithCookies(endpoint, {
    method: "POST",
    cookies: session.cookies,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "User-Agent": BROWSER_UA,
      "X-Requested-With": "XMLHttpRequest",
      "Referer": session.finalUrl,
    },
    body: formData.toString(),
  }, 0);

  const postResp = postResult.response;
  const postCt = postResp.headers.get("content-type") ?? "";

  if (postResp.ok && postCt.includes("application/json")) {
    const data = await postResp.json();
    return parseWorklistData(data, params);
  }

  // GET fallback
  const getUrl = `${endpoint}?${formData.toString()}`;
  const getResult = await fetchWithCookies(getUrl, {
    method: "GET",
    cookies: session.cookies,
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "User-Agent": BROWSER_UA,
      "X-Requested-With": "XMLHttpRequest",
      "Referer": session.finalUrl,
    },
  }, 0);

  const getResp = getResult.response;
  const getCt = getResp.headers.get("content-type") ?? "";

  if (getResp.ok && getCt.includes("application/json")) {
    const data = await getResp.json();
    return parseWorklistData(data, params);
  }

  // Both failed — build detailed error with HTTP status codes
  const postStatus = postResp.status;
  const getStatus = getResp.status;

  if (postStatus === 302 || postStatus === 301) {
    const loc = postResp.headers.get("location") ?? "";
    if (loc.includes("login") || loc.includes("error")) {
      throw new Error("انتهت جلسة OnePacs — تم إعادة توجيه لصفحة تسجيل الدخول. تحقق من بيانات الاعتماد.");
    }
  }

  if (postStatus === 401 || postStatus === 403 || getStatus === 401 || getStatus === 403) {
    throw new Error("فشل المصادقة مع OnePacs (401/403) — تحقق من بيانات الاعتماد.");
  }

  if (postStatus === 404 || getStatus === 404) {
    throw new Error(`مسار الـ endpoint غير موجود (404): ${config.worklistEndpoint}. راجع إعدادات OnePacs.`);
  }

  const bodyPreview = await postResp.text().catch(() => "");
  const isLoginHtml = bodyPreview.toLowerCase().includes("login") || bodyPreview.toLowerCase().includes("spring_security");
  const pageTitle = bodyPreview.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";

  throw new Error(
    `OnePacs أعاد HTML بدلاً من JSON.\n` +
    `POST status: ${postStatus}, Content-Type: ${postCt}\n` +
    `GET status: ${getStatus}, Content-Type: ${getCt}\n` +
    `Endpoint: ${config.worklistEndpoint}\n` +
    `Page title: "${pageTitle}"\n` +
    `Is login page: ${isLoginHtml}\n` +
    `Response size: ${bodyPreview.length}\n` +
    `First 200 chars: ${bodyPreview.slice(0, 200)}`
  );
}

function parseWorklistData(data: Record<string, unknown>, params: FetchParams): WorklistResult {
  const records: Record<string, unknown>[] =
    (data.records as Record<string, unknown>[]) ??
    (data.data as Record<string, unknown>[]) ??
    (data.rows as Record<string, unknown>[]) ??
    [];
  const total: number =
    (data.total as number) ??
    (data.totalCount as number) ??
    (data.results as number) ??
    records.length;

  return { records, total, start: params.start, limit: params.limit };
}

// ---------------------------------------------------------------------------
// DIAGNOSTIC: full HTTP trace — no secrets leaked
// ---------------------------------------------------------------------------

async function runDiagnostic(config: OnePacsConfig): Promise<Response> {
  const diag: {
    config: { baseUrl: string; worklistEndpoint: string; usernameLength: number; hasPassword: boolean };
    step1: { url: string; status: number; hops: HttpHop[]; cookiesAfter: string[] };
    step2: { url: string; status: number; hops: HttpHop[]; cookiesAfter: string[]; finalUrl: string };
    step3: { url: string; status: number; hops: HttpHop[]; cookiesAfter: string[]; finalUrl: string; title: string };
    worklist: { url: string; status: number; contentType: string; isJson: boolean; isLoginHtml: boolean; bodyPreview: string; bodySize: number };
    conclusion: string;
  } = {
    config: {
      baseUrl: config.baseUrl,
      worklistEndpoint: config.worklistEndpoint,
      usernameLength: config.username.length,
      hasPassword: !!config.password,
    },
    step1: { url: "", status: 0, hops: [], cookiesAfter: [] },
    step2: { url: "", status: 0, hops: [], cookiesAfter: [], finalUrl: "" },
    step3: { url: "", status: 0, hops: [], cookiesAfter: [], finalUrl: "", title: "" },
    worklist: { url: "", status: 0, contentType: "", isJson: false, isLoginHtml: false, bodyPreview: "", bodySize: 0 },
    conclusion: "",
  };

  try {
    // Step 1: GET /login
    const s1 = await fetchWithCookies(`${config.baseUrl}/login`, {
      method: "GET",
      cookies: "",
      headers: { "Accept": "text/html", "User-Agent": BROWSER_UA },
    });
    let cookies = s1.cookies;
    diag.step1 = { url: `${config.baseUrl}/login`, status: s1.response.status, hops: s1.hops, cookiesAfter: cookieNames(cookies) };

    // Step 2: POST /choose-login-method
    const s2Body = new URLSearchParams();
    s2Body.append("username", config.username);
    const s2 = await fetchWithCookies(`${config.baseUrl}/choose-login-method`, {
      method: "POST",
      cookies,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html",
        "User-Agent": BROWSER_UA,
        "Referer": `${config.baseUrl}/login`,
        "Origin": config.baseUrl,
      },
      body: s2Body.toString(),
    }, 3);
    cookies = s2.cookies;
    diag.step2 = { url: `${config.baseUrl}/choose-login-method`, status: s2.response.status, hops: s2.hops, cookiesAfter: cookieNames(cookies), finalUrl: s2.finalUrl };

    // Step 3: POST /login with credentials
    const s3Body = new URLSearchParams();
    s3Body.append("username", config.username);
    s3Body.append("password", config.password);
    const s3 = await fetchWithCookies(`${config.baseUrl}/login`, {
      method: "POST",
      cookies,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html",
        "User-Agent": BROWSER_UA,
        "Referer": `${config.baseUrl}/authstandard?username=${encodeURIComponent(config.username)}`,
        "Origin": config.baseUrl,
      },
      body: s3Body.toString(),
    }, 5);
    cookies = s3.cookies;
    const s3Body_text = await s3.response.text().catch(() => "");
    const s3Title = s3Body_text.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    diag.step3 = { url: `${config.baseUrl}/login`, status: s3.response.status, hops: s3.hops, cookiesAfter: cookieNames(cookies), finalUrl: s3.finalUrl, title: s3Title };

    // Worklist request
    const endpoint = `${config.baseUrl}${config.worklistEndpoint}`;
    const wlBody = new URLSearchParams();
    wlBody.append("start", "0");
    wlBody.append("limit", "1");
    wlBody.append("jsonTableData", "true");

    const wl = await fetchWithCookies(endpoint, {
      method: "POST",
      cookies,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "User-Agent": BROWSER_UA,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": s3.finalUrl,
      },
      body: wlBody.toString(),
    }, 0);

    const wlBodyText = await wl.response.text().catch(() => "");
    const wlCt = wl.response.headers.get("content-type") ?? "";

    diag.worklist = {
      url: endpoint,
      status: wl.response.status,
      contentType: wlCt,
      isJson: wlCt.includes("application/json"),
      isLoginHtml: wlBodyText.toLowerCase().includes("login") || wlBodyText.toLowerCase().includes("spring_security"),
      bodyPreview: wlBodyText.slice(0, 300),
      bodySize: wlBodyText.length,
    };

    // Conclusion
    if (diag.worklist.isJson) {
      diag.conclusion = "نجح: الـ endpoint يعيد JSON. التكامل يعمل بشكل صحيح.";
    } else if (diag.worklist.isLoginHtml) {
      diag.conclusion = "فشل: الجلسة غير مصادق عليها — يعيد صفحة تسجيل الدخول. تحقق من اسم المستخدم وكلمة المرور.";
    } else if (diag.worklist.status === 404) {
      diag.conclusion = `فشل: مسار الـ endpoint غير موجود (404): ${config.worklistEndpoint}`;
    } else if (s3.finalUrl.includes("/login") && !s3.finalUrl.includes("worklist")) {
      diag.conclusion = "فشل: بيانات الاعتماد غير صحيحة — إعادة توجيه لصفحة تسجيل الدخول بعد تسجيل الدخول.";
    } else {
      diag.conclusion = `فشل: الـ endpoint يعيد HTML (status=${diag.worklist.status}). قد يكون المسار خاطئ أو الجلسة غير صالحة.`;
    }
  } catch (err) {
    diag.conclusion = `استثناء أثناء التشخيص: ${err instanceof Error ? err.message : String(err)}`;
  }

  return jsonResponse(diag);
}
