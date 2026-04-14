import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";

import { BootSurface } from "@/components/orchd/boot-surface";
import { AppShell } from "@/shell/app-shell";
import { api } from "@/lib/api";
import type { AuthMe } from "@/lib/contracts";
import { BackendSessionDetailRoute } from "@/routes/backend-session-detail";
import { BindingCreateRoute } from "@/routes/binding-create";
import { BindingDetailRoute } from "@/routes/binding-detail";
import { DashboardRoute } from "@/routes/dashboard";
import { LoginRoute } from "@/routes/login";
import { NotFoundRoute } from "@/routes/not-found";
import { SettingsRoute } from "@/routes/settings";
import "./styles/index.css";

function ProtectedLayout({ auth }: { auth: AuthMe }) {
  if (auth.required && !auth.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppShell auth={auth}>
      <Outlet />
    </AppShell>
  );
}

function App() {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshAuth = async () => {
    try {
      const next = await api.get<AuthMe>("/api/auth/me");
      setAuth(next);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void refreshAuth();
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  if (!auth) {
    return <BootSurface message={authError ?? "Booting orchd…"} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute auth={auth} onLoggedIn={refreshAuth} />} />
        <Route element={<ProtectedLayout auth={auth} />}>
          <Route path="/" element={<DashboardRoute />} />
          <Route path="/bindings/new" element={<BindingCreateRoute />} />
          <Route path="/bindings/:bindingId" element={<BindingDetailRoute />} />
          <Route path="/backend-sessions/:handleId" element={<BackendSessionDetailRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="*" element={<NotFoundRoute />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
