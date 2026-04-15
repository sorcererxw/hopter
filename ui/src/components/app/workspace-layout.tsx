import type { PropsWithChildren } from "react"
import { FolderPlus, Settings } from "lucide-react"
import { Link, NavLink } from "react-router-dom"

import { SessionRail } from "@/components/app/session-rail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useHostStatus } from "@/features/host/use-host-status"
import { useWorkspaceEvents } from "@/lib/sse/use-workspace-events"
import { cn } from "@/lib/utils"

export function WorkspaceLayout({ children }: PropsWithChildren) {
  useWorkspaceEvents()

  const { data: hostStatus } = useHostStatus()

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-80 shrink-0 border-r border-border/80 bg-sidebar md:flex md:flex-col">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              orchd
            </p>
            <h1 className="text-lg font-semibold">Workspace</h1>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/projects/new" data-testid="project-create-trigger">
              <FolderPlus className="size-4" />
              Project
            </Link>
          </Button>
        </div>
        <Separator />
        <SessionRail />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div>
                <p className="text-sm font-semibold">Local workspace</p>
                <p className="text-xs text-muted-foreground">
                  Continue Codex sessions without leaving the shell.
                </p>
              </div>
              {hostStatus ? (
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  {hostStatus.hostId || "host"} · {hostStatus.projectCount} projects
                </Badge>
              ) : null}
            </div>

            <nav className="flex items-center gap-2">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted text-foreground"
                  )
                }
              >
                Workspace
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted text-foreground"
                  )
                }
              >
                <Settings className="size-4" />
                Settings
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
