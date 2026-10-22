import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface LoginRequest {
  mobile: string;
  password: string;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const iterations = parseInt(parts[0]);
    const salt = parts[1];
    const hash = parts[2];
    const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derivedBits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" }, keyMaterial, 256);
    const derivedHash = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
    return derivedHash === hash;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { mobile, password } = (await req.json()) as LoginRequest;
    if (!mobile || !password) {
      return new Response(JSON.stringify({ error: "رقم الهاتف وكلمة المرور مطلوبة" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, mobile, password, role, specialty, technical_notes, status, created_at")
      .eq("mobile", mobile)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: "فشل تسجيل الدخول" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!user) {
      return new Response(JSON.stringify({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (user.status === "inactive") {
      return new Response(JSON.stringify({ error: "هذا الحساب غير نشط. يرجى التواصل مع المسؤول" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Record last login timestamp
    await supabase.from("users").update({ last_login: new Date().toISOString() }).eq("id", user.id);

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return new Response(JSON.stringify({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const shadowEmail = `user_${user.id}@radiology.local`;
    const shadowPassword = `ShadowPass_${user.id}!23`;

    const { error: createError } = await supabase.auth.admin.createUser({
      email: shadowEmail,
      password: shadowPassword,
      email_confirm: true,
      app_metadata: { role: user.role, custom_user_id: user.id },
    });

    if (createError && !createError.message.includes("already been registered")) {
      return new Response(JSON.stringify({ error: "فشل تسجيل الدخول. حاول مرة أخرى" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (createError) {
      const { data: userList } = await supabase.auth.admin.listUsers();
      const existing = userList?.users?.find((u: { email: string; id: string }) => u.email === shadowEmail);
      if (existing) {
        await supabase.auth.admin.updateUserById(existing.id, { app_metadata: { role: user.role, custom_user_id: user.id } });
      }
    }

    const pubClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: signInData, error: signInError } = await pubClient.auth.signInWithPassword({ email: shadowEmail, password: shadowPassword });

    if (signInError || !signInData.session) {
      return new Response(JSON.stringify({ error: "فشل تسجيل الدخول. حاول مرة أخرى" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      user: {
        id: user.id, name: user.name, mobile: user.mobile, role: user.role,
        specialty: user.specialty, technical_notes: user.technical_notes, status: user.status,
        created_at: user.created_at,
      },
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_at: signInData.session.expires_at,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "حدث خطأ غير متوقع" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
