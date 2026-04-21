import { ArrowLeft, Blocks, Bot, Brush, Settings } from "lucide-react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"

import { RailRow } from "@/components/app/rail-row"
import { SidebarPane } from "@/components/app/sidebar-pane"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

  const handleTabChange = (value: string) => {
    const nextItem = NAV_ITEMS.find((item) => item.id === value)
    if (nextItem) {
      navigate(nextItem.path)
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background font-medium text-foreground md:flex-row">
      <div className="border-b border-border px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Back to app"
            title="Back to app"
            onClick={() => navigate("/")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft />
          </Button>

          <Tabs
            value={activeId}
            onValueChange={handleTabChange}
            className="min-w-0 flex-1 gap-0"
          >
            <div className="overflow-x-auto">
              <TabsList className="min-w-max">
                {NAV_ITEMS.map(({ id, label }) => (
                  <TabsTrigger key={id} value={id}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        </div>
      </div>

      <SidebarPane className="hidden py-4 md:flex">
        <div className="mb-3 px-2">
          <RailRow
            icon={<ArrowLeft className="size-3.5" />}
            label="Back to app"
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
          />
        </div>

        <div className="flex flex-col gap-0.5 px-2">
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

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 text-foreground md:px-12 md:py-8">
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
