import { Suspense, lazy, type ReactNode } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"

import { ThemeProvider } from "@/components/theme-provider"
import { queryClient } from "@/lib/query/client"
const HomeRoute = lazy(() =>
  import("@/routes/home-route").then((module) => ({
    default: module.HomeRoute,
  }))
)
const LoginRoute = lazy(() =>
  import("@/routes/login-route").then((module) => ({
    default: module.LoginRoute,
  }))
)
const SessionRoute = lazy(() =>
  import("@/routes/session-route").then((module) => ({
    default: module.SessionRoute,
  }))
)
const SettingsRoute = lazy(() =>
  import("@/routes/settings-route").then((module) => ({
    default: module.SettingsRoute,
  }))
)
const WorkspaceRouteFrame = lazy(() =>
  import("@/components/app/workspace-route-frame").then((module) => ({
    default: module.WorkspaceRouteFrame,
  }))
)

function renderLazyRoute(element: ReactNode) {
  return <Suspense fallback={null}>{element}</Suspense>
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="orchd-theme">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="settings" element={renderLazyRoute(<SettingsRoute />)} />
            <Route element={<WorkspaceRouteFrame />}>
              <Route index element={renderLazyRoute(<HomeRoute />)} />
            <Route
              path="sessions/:sessionId"
              element={renderLazyRoute(<SessionRoute />)}
            />
          </Route>
            <Route path="login" element={renderLazyRoute(<LoginRoute />)} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
