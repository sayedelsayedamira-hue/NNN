import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase, type AppUser } from "./supabase";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (mobile: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "radiology_app_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (session) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            setUser(JSON.parse(stored));
          } catch {
            await supabase.auth.signOut();
          }
        } else {
          await supabase.auth.signOut();
        }
      }
      setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        if (event === "SIGNED_OUT" || !session) {
          localStorage.removeItem(STORAGE_KEY);
          setUser(null);
        }
      })();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (mobile: string, password: string) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/auth-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ mobile, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: data.error || "فشل تسجيل الدخول" };
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionError) {
        return { error: "فشل إنشاء الجلسة" };
      }

      const appUser: AppUser = data.user;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appUser));
      setUser(appUser);
      return { error: null };
    } catch {
      return { error: "خطأ في الشبكة. حاول مرة أخرى." };
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
