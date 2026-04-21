import { Suspense, lazy, useEffect, useState, type ReactNode } from "react"
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"

import { ThemeProvider, type Theme } from "@/components/theme-provider"
import { useAuthStatus } from "@/features/auth/use-auth"
import {
  themePreferenceFromConfig,
  themePreferenceToProto,
  useConfig,
  useUpdateConfig,
} from "@/features/config/use-config"
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
const SettingsGeneralPage = lazy(() =>
  import("@/routes/settings/settings-general-page").then((module) => ({
    default: module.SettingsGeneralPage,
  }))
)
const SettingsAppearancePage = lazy(() =>
  import("@/routes/settings/settings-appearance-page").then((module) => ({
    default: module.SettingsAppearancePage,
  }))
)
const SettingsPluginsPage = lazy(() =>
  import("@/routes/settings/settings-plugins-page").then((module) => ({
    default: module.SettingsPluginsPage,
  }))
)
const SettingsAgentsPage = lazy(() =>
  import("@/routes/settings/settings-agents-page").then((module) => ({
    default: module.SettingsAgentsPage,
  }))
)
const WorkspaceRouteFrame = lazy(() =>
  import("@/components/app/workspace-route-frame").then((module) => ({
    default: module.WorkspaceRouteFrame,
  }))
)
const ProjectPickerPage = lazy(() =>
  import("@/components/app/project-picker-dialog").then((module) => ({
    default: module.ProjectPickerPage,
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

function ConfigBackedThemeProvider({ children }: { children: ReactNode }) {
  const configQuery = useConfig()
  const updateConfig = useUpdateConfig()
  const configTheme = themePreferenceFromConfig(configQuery.data)
  const [optimisticTheme, setOptimisticTheme] = useState<Theme | null>(null)
  const theme = optimisticTheme ?? configTheme

  useEffect(() => {
    if (optimisticTheme === configTheme) {
      setOptimisticTheme(null)
    }
  }, [configTheme, optimisticTheme])

  function handleThemeChange(nextTheme: Theme) {
    setOptimisticTheme(nextTheme)
    updateConfig.mutate(
      {
        appearance: {
          theme: themePreferenceToProto(nextTheme),
        },
        expectedRevision: configQuery.data?.revision ?? 0n,
      },
      {
        onError: () => {
          setOptimisticTheme(null)
        },
      }
    )
  }

  return (
    <ThemeProvider
      defaultTheme="system"
      onThemeChange={handleThemeChange}
      theme={theme}
    >
      {children}
    </ThemeProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigBackedThemeProvider>
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
            >
              <Route index element={renderLazyRoute(<SettingsGeneralPage />)} />
              <Route
                path="appearance"
                element={renderLazyRoute(<SettingsAppearancePage />)}
              />
              <Route
                path="plugins"
                element={renderLazyRoute(<SettingsPluginsPage />)}
              />
              <Route
                path="agents"
                element={renderLazyRoute(<SettingsAgentsPage />)}
              />
            </Route>
            <Route
              element={
                <ProtectedRoute>
                  <WorkspaceRouteFrame />
                </ProtectedRoute>
              }
            >
              <Route index element={renderLazyRoute(<HomeRoute />)} />
              <Route
                path="projects/new"
                element={renderLazyRoute(<ProjectPickerPage />)}
              />
              <Route
                path="sessions/:sessionId"
                element={renderLazyRoute(<SessionRoute />)}
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfigBackedThemeProvider>
    </QueryClientProvider>
  )
}
