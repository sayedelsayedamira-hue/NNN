import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function hashPassword(password: string): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = btoa(String.fromCharCode(...saltBytes));
  const iterations = 100000;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" }, keyMaterial, 256);
  const hash = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
  return `${iterations}:${salt}:${hash}`;
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const pubClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: authUser }, error: authError } = await pubClient.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const customUserId = authUser.app_metadata?.custom_user_id;
    if (!customUserId) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return new Response(JSON.stringify({ error: "كلمة المرور الحالية والجديدة مطلوبة" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (newPassword.length < 6) {
      return new Response(JSON.stringify({ error: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: user } = await supabase.from("users").select("password").eq("id", customUserId).maybeSingle();
    if (!user) {
      return new Response(JSON.stringify({ error: "المستخدم غير موجود" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const valid = await verifyPassword(currentPassword, user.password);
    if (!valid) {
      return new Response(JSON.stringify({ error: "كلمة المرور الحالية غير صحيحة" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const hashedPassword = await hashPassword(newPassword);
    const { error: updateError } = await supabase.from("users").update({ password: hashedPassword }).eq("id", customUserId);
    if (updateError) {
      return new Response(JSON.stringify({ error: "فشل تغيير كلمة المرور" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "حدث خطأ غير متوقع" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
