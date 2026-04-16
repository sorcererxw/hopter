import type { PropsWithChildren } from "react"

import { SessionRail } from "@/components/app/session-rail"
import { useWorkspaceEvents } from "@/lib/sse/use-workspace-events"

export function WorkspaceLayout({ children }: PropsWithChildren) {
  useWorkspaceEvents()

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <div className="grid h-full min-w-0 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden h-full border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
          <SessionRail />
        </aside>

        <main className="min-w-0 overflow-hidden bg-background">{children}</main>
      </div>
    </div>
  )
}
