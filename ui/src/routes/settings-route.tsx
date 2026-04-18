import {
  ArrowLeft,
  Blocks,
  Bot,
  Brush,
  Settings,
} from "lucide-react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"

import { RailRow } from "@/components/app/rail-row"
import { SidebarPane } from "@/components/app/sidebar-pane"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { id: "general", label: "General", icon: Settings, path: "/settings" },
  {
    id: "appearance",
    label: "Appearance",
    icon: Brush,
    path: "/settings/appearance",
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: Blocks,
    path: "/settings/plugins",
  },
  { id: "agents", label: "Agents", icon: Bot, path: "/settings/agents" },
] as const

export function SettingsRoute() {
  const navigate = useNavigate()
  const location = useLocation()

  const activeId =
    NAV_ITEMS.find(
      (item) =>
        item.path !== "/settings" && location.pathname.startsWith(item.path)
    )?.id ?? "general"

  return (
    <div className="flex h-dvh bg-background text-foreground font-medium">
      <SidebarPane className="py-4">
        <div className="mb-3 px-2">
          <RailRow
            icon={<ArrowLeft className="size-3.5" />}
            label="Back to app"
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
          />
        </div>

        <div className="space-y-0.5 px-2">
          {NAV_ITEMS.map(({ icon: Icon, id, label, path }) => (
            <RailRow
              key={id}
              icon={<Icon className="size-3.5" />}
              label={label}
              to={path}
              className={cn(
                activeId === id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            />
          ))}
        </div>
      </SidebarPane>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-12 py-8 font-medium text-foreground">
        <div className="max-w-2xl">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export function SettingsIndexRedirect() {
  return <Navigate to="/settings" replace />
}

