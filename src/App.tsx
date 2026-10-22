import { useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useNewCaseNotification } from "@/lib/useNewCaseNotification";
import LoginPage from "@/pages/LoginPage";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import CasesPage from "@/pages/CasesPage";
import UsersPage from "@/pages/UsersPage";
import SchedulePage from "@/pages/SchedulePage";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import NotificationsPage from "@/pages/NotificationsPage";
import OnePacsPage from "@/pages/OnePacsPage";
import { Loader2 } from "lucide-react";
import type { UserRole } from "@/lib/supabase";

function AppContent() {
  const { user, loading } = useAuth();
  const [view, setView] = useState("dashboard");

  // Visual + sound notifications for case events (new case, reassignment, status change)
  useNewCaseNotification(user);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const role: UserRole = user.role;
  const allowedViews: Record<UserRole, string[]> = {
    admin: ["dashboard", "cases", "onepacs", "users", "schedule", "notifications"],
    coordinator: ["dashboard", "cases", "onepacs", "schedule", "notifications"],
    doctor: ["dashboard", "cases", "notifications", "password"],
    viewer: ["dashboard", "cases", "onepacs", "users", "schedule", "notifications"],
  };
  const allowed = allowedViews[role];
  const activeView = allowed.includes(view) ? view : "dashboard";

  const handleNavigate = (v: string) => {
    if (allowed.includes(v)) setView(v);
  };

  return (
    <AppLayout activeView={activeView} onNavigate={handleNavigate}>
      {activeView === "dashboard" && <Dashboard user={user} />}
      {activeView === "cases" && <CasesPage user={user} />}
      {activeView === "onepacs" && <OnePacsPage />}
      {activeView === "users" && (role === "admin" || role === "viewer") && <UsersPage />}
      {activeView === "schedule" && (role === "admin" || role === "coordinator" || role === "viewer") && <SchedulePage />}
      {activeView === "notifications" && <NotificationsPage />}
      {activeView === "password" && role === "doctor" && <ChangePasswordPage />}
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
