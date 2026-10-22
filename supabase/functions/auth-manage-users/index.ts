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
    if (authUser.app_metadata?.role !== "admin") {
      return new Response(JSON.stringify({ error: "فقط المسؤول يمكنه إدارة المستخدمين" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const action = body.action;

    if (action === "create") {
      const { name, mobile, password, role, specialty, technical_notes, schedules } = body;
      if (!name || !mobile || !password || !role) {
        return new Response(JSON.stringify({ error: "الاسم ورقم الهاتف وكلمة المرور والدور مطلوبة" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (password.length < 6) {
        return new Response(JSON.stringify({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: existing } = await supabase.from("users").select("id").eq("mobile", mobile).maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({ error: "رقم الهاتف مستخدم بالفعل" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const hashedPassword = await hashPassword(password);
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({ name, mobile, password: hashedPassword, role, specialty: specialty || null, technical_notes: technical_notes || null, status: "active" })
        .select("id, name, mobile, role, specialty, technical_notes, status, created_at")
        .single();

      if (insertError) {
        return new Response(JSON.stringify({ error: `فشل إنشاء المستخدم: ${insertError.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // If creating a doctor with schedule entries, insert them
      if (role === "doctor" && Array.isArray(schedules) && schedules.length > 0) {
        const scheduleRows = schedules.map((s: { day_of_week: string; start_time: string; end_time: string; notes?: string }) => ({
          doctor_id: newUser.id,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          notes: s.notes || null,
        }));
        const { error: scheduleError } = await supabase.from("doctor_schedules").insert(scheduleRows);
        if (scheduleError) {
          // User created but schedules failed - return success with warning
          return new Response(JSON.stringify({ user: newUser, scheduleError: "تم إنشاء المستخدم ولكن فشل حفظ الجدول" }), { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      return new Response(JSON.stringify({ user: newUser }), { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update") {
      const { id, name, mobile, role, specialty, technical_notes, status } = body;
      if (!id) {
        return new Response(JSON.stringify({ error: "معرف المستخدم مطلوب" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (mobile !== undefined) updateData.mobile = mobile;
      if (role !== undefined) updateData.role = role;
      if (specialty !== undefined) updateData.specialty = specialty || null;
      if (technical_notes !== undefined) updateData.technical_notes = technical_notes || null;
      if (status !== undefined) updateData.status = status;

      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", id)
        .select("id, name, mobile, role, specialty, technical_notes, status, created_at")
        .single();

      if (updateError) {
        return new Response(JSON.stringify({ error: `فشل تحديث المستخدم: ${updateError.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ user: updatedUser }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      const { userId } = body;
      if (!userId) {
        return new Response(JSON.stringify({ error: "معرف المستخدم مطلوب" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Prevent deleting admin
      const { data: targetUser } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
      if (targetUser?.role === "admin") {
        return new Response(JSON.stringify({ error: "لا يمكن حذف حساب المسؤول" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: deleteError } = await supabase.from("users").delete().eq("id", userId);
      if (deleteError) {
        return new Response(JSON.stringify({ error: "فشل حذف المستخدم" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "resetPassword") {
      const { userId, newPassword } = body;
      if (!userId || !newPassword) {
        return new Response(JSON.stringify({ error: "معرف المستخدم وكلمة المرور الجديدة مطلوبة" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (newPassword.length < 6) {
        return new Response(JSON.stringify({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const hashedPassword = await hashPassword(newPassword);
      const { error: updateError } = await supabase.from("users").update({ password: hashedPassword }).eq("id", userId);
      if (updateError) {
        return new Response(JSON.stringify({ error: "فشل إعادة تعيين كلمة المرور" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "إجراء غير معروف" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `حدث خطأ غير متوقع: ${msg}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
