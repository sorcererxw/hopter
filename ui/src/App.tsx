import { Suspense, lazy, type ReactNode } from "react"
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"

import { ThemeProvider } from "@/components/theme-provider"
import { useAuthStatus } from "@/features/auth/use-auth"
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

function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation()
  const auth = useAuthStatus()

  if (auth.isLoading) {
    return null
  }

  if (auth.data?.authenticated === false) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="orchd-theme">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="login" element={renderLazyRoute(<LoginRoute />)} />
            <Route
              path="settings"
              element={renderLazyRoute(
                <ProtectedRoute>
                  <SettingsRoute />
                </ProtectedRoute>
              )}
            />
            <Route
              element={
                <ProtectedRoute>
                  <WorkspaceRouteFrame />
                </ProtectedRoute>
              }
            >
              <Route index element={renderLazyRoute(<HomeRoute />)} />
              <Route
                path="sessions/:sessionId"
                element={renderLazyRoute(<SessionRoute />)}
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
