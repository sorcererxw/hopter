import { useEffect, useState, type PropsWithChildren } from "react"

import { SearchDialog } from "@/components/app/search-dialog"
import { SessionRail } from "@/components/app/session-rail"
import { useWorkspaceEvents } from "@/lib/sse/use-workspace-events"

export function WorkspaceLayout({ children }: PropsWithChildren) {
  useWorkspaceEvents()
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((current) => !current)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-[#0f0f0f] text-foreground">
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="grid h-full min-h-0 min-w-0 md:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 h-full border-r border-white/7 bg-[#141414] md:flex md:flex-col">
          <SessionRail onOpenSearch={() => setSearchOpen(true)} />
        </aside>

        <main className="min-h-0 min-w-0 overflow-hidden bg-[#0f0f0f]">{children}</main>
      </div>
    </div>
  )
}
