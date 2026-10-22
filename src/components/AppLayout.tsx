import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Stethoscope, LogOut, LayoutDashboard, ClipboardList, Users, Calendar, KeyRound, Bell, Menu, X, Database } from "lucide-react";
import { useState } from "react";
import { ROLE_LABELS } from "@/lib/supabase";

interface LayoutProps {
  children: ReactNode;
  activeView: string;
  onNavigate: (view: string) => void;
}

export default function AppLayout({ children, activeView, onNavigate }: LayoutProps) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = user?.role ?? "doctor";

  const navItems: Record<string, { id: string; label: string; icon: typeof LayoutDashboard }[]> = {
    admin: [
      { id: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
      { id: "cases", label: "الحالات", icon: ClipboardList },
      { id: "onepacs", label: "OnePacs", icon: Database },
      { id: "users", label: "المستخدمون", icon: Users },
      { id: "schedule", label: "جداول الأطباء", icon: Calendar },
      { id: "notifications", label: "الإشعارات", icon: Bell },
    ],
    coordinator: [
      { id: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
      { id: "cases", label: "الحالات", icon: ClipboardList },
      { id: "onepacs", label: "OnePacs", icon: Database },
      { id: "schedule", label: "جداول الأطباء", icon: Calendar },
      { id: "notifications", label: "الإشعارات", icon: Bell },
    ],
    doctor: [
      { id: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
      { id: "cases", label: "قائمة عملي", icon: ClipboardList },
      { id: "notifications", label: "الإشعارات", icon: Bell },
      { id: "password", label: "تغيير كلمة المرور", icon: KeyRound },
    ],
    viewer: [
      { id: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
      { id: "cases", label: "الحالات", icon: ClipboardList },
      { id: "onepacs", label: "OnePacs", icon: Database },
      { id: "users", label: "المستخدمون", icon: Users },
      { id: "schedule", label: "جداول الأطباء", icon: Calendar },
      { id: "notifications", label: "الإشعارات", icon: Bell },
    ],
  };

  const items = navItems[role] ?? navItems.doctor;

  const handleNav = (id: string) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 right-0 left-0 bg-slate-900 text-white z-30 flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm">نظام الأشعة</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Overlay for mobile */}
      {mobileOpen && <div className="lg:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside className={`w-64 bg-slate-900 text-white flex flex-col fixed h-full z-40 transition-transform duration-300 right-0 ${
        mobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
      }`}>
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">نظام الأشعة</h1>
              <p className="text-xs text-slate-400">{ROLE_LABELS[role]}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {items.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-2 mb-2">
            <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-semibold text-white">
              {user?.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-slate-400 truncate" dir="ltr">{user?.mobile}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:mr-64 pt-14 lg:pt-0">
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
