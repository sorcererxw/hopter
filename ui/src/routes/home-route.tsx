import { HomeWorkspacePane } from "@/components/app/session-detail-pane"
import { SessionRail } from "@/components/app/session-rail"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"

export function HomeRoute() {
  const { openSearch } = useWorkspaceShell()

  return (
    <>
      {/* Phone: thread list is the entry page */}
      <div className="h-full md:hidden">
        <SessionRail onOpenSearch={openSearch} />
      </div>
      {/* Desktop: persistent sidebar + workspace pane */}
      <div className="hidden h-full md:block">
        <HomeWorkspacePane />
      </div>
    </>
  )
}
