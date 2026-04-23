import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react"
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
  localePreferenceFromConfig,
  localePreferenceToProto,
  themePreferenceFromConfig,
  themePreferenceToProto,
  useConfig,
  useUpdateConfig,
  type LocalePreference,
} from "@/features/config/use-config"
import { HopterI18nProvider } from "@/lib/i18n/provider"
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
  import("@/components/app/workspace").then((module) => ({
    default: module.WorkspaceRouteFrame,
  }))
)
const ProjectPickerPage = lazy(() =>
  import("@/components/app/projects").then((module) => ({
    default: module.ProjectPickerPage,
  }))
)

function renderLazyRoute(element: ReactNode) {
  return <Suspense fallback={null}>{element}</Suspense>
}

// App-level route guard. The browser shell stays mounted only after the
// backend confirms the local host session is authenticated.
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

// Theme and locale both come from persisted config, but the UI keeps a short
// optimistic value so the shell reacts immediately before the mutation settles.
function ConfigBackedPreferencesProvider({
  children,
}: {
  children: ReactNode
}) {
  const configQuery = useConfig()
  const updateConfig = useUpdateConfig()
  const configTheme = themePreferenceFromConfig(configQuery.data)
  const configLocale = localePreferenceFromConfig(configQuery.data)
  const [optimisticTheme, setOptimisticTheme] = useState<Theme | null>(null)
  const [optimisticLocale, setOptimisticLocale] =
    useState<LocalePreference | null>(null)
  const theme = optimisticTheme ?? configTheme
  const locale = optimisticLocale ?? configLocale

  useEffect(() => {
    if (optimisticTheme === configTheme) {
      setOptimisticTheme(null)
    }
  }, [configTheme, optimisticTheme])

  useEffect(() => {
    if (optimisticLocale === configLocale) {
      setOptimisticLocale(null)
    }
  }, [configLocale, optimisticLocale])

  function handleThemeChange(nextTheme: Theme) {
    setOptimisticTheme(nextTheme)
    updateConfig.mutate(
      {
        appearance: {
          locale: localePreferenceToProto(locale),
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

  const handleLocaleChange = useCallback(
    (nextLocale: LocalePreference) => {
      setOptimisticLocale(nextLocale)
      updateConfig.mutate(
        {
          appearance: {
            locale: localePreferenceToProto(nextLocale),
            theme: themePreferenceToProto(theme),
          },
          expectedRevision: configQuery.data?.revision ?? 0n,
        },
        {
          onError: () => {
            setOptimisticLocale(null)
          },
        }
      )
    },
    [configQuery.data?.revision, theme, updateConfig]
  )

  return (
    <HopterI18nProvider locale={locale} onLocaleChange={handleLocaleChange}>
      <ThemeProvider
        defaultTheme="system"
        onThemeChange={handleThemeChange}
        theme={theme}
      >
        {children}
      </ThemeProvider>
    </HopterI18nProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigBackedPreferencesProvider>
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
      </ConfigBackedPreferencesProvider>
    </QueryClientProvider>
  )
}
