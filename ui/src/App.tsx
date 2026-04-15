import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"

import { ThemeProvider } from "@/components/theme-provider"
import { WorkspaceLayout } from "@/components/app/workspace-layout"
import { queryClient } from "@/lib/query/client"
import { HomeRoute } from "@/routes/home-route"
import { LoginRoute } from "@/routes/login-route"
import { ProjectNewRoute } from "@/routes/project-new-route"
import { SessionRoute } from "@/routes/session-route"
import { SettingsRoute } from "@/routes/settings-route"

function WorkspaceRouteFrame() {
  return (
    <WorkspaceLayout>
      <Outlet />
    </WorkspaceLayout>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<WorkspaceRouteFrame />}>
              <Route index element={<HomeRoute />} />
              <Route path="sessions/:sessionId" element={<SessionRoute />} />
              <Route path="projects/new" element={<ProjectNewRoute />} />
              <Route path="settings" element={<SettingsRoute />} />
            </Route>
            <Route path="login" element={<LoginRoute />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
