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
const TasksRoute = lazy(() =>
  import("@/routes/tasks-route").then((module) => ({
    default: module.TasksRoute,
  }))
)
const PluginsRoute = lazy(() =>
  import("@/routes/plugins-route").then((module) => ({
    default: module.PluginsRoute,
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

function LegacyHashRedirect({
  fallbackHash = "",
  to,
}: {
  fallbackHash?: string
  to: string
}) {
  const location = useLocation()

  return <Navigate to={`${to}${location.hash || fallbackHash}`} replace />
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
              <Route path="tasks" element={renderLazyRoute(<TasksRoute />)} />
              <Route
                path="plugins"
                element={renderLazyRoute(<PluginsRoute />)}
              />
              <Route
                path="settings"
                element={renderLazyRoute(<SettingsRoute />)}
              />
              <Route
                path="settings/appearance"
                element={
                  <LegacyHashRedirect
                    to="/settings"
                    fallbackHash="#appearance"
                  />
                }
              />
              <Route
                path="settings/plugins"
                element={<Navigate to="/plugins" replace />}
              />
              <Route
                path="settings/agents"
                element={
                  <LegacyHashRedirect to="/settings" fallbackHash="#agents" />
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfigBackedThemeProvider>
    </QueryClientProvider>
  )
}
