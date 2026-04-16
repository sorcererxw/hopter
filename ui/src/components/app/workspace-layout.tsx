import { useEffect, useMemo, useState, type PropsWithChildren } from "react"

import { SearchDialog } from "@/components/app/search-dialog"
import { SessionRail } from "@/components/app/session-rail"
import { WorkspaceShellContext } from "@/components/app/workspace-shell-context"
import { useWorkspaceEvents } from "@/lib/sse/use-workspace-events"

export function WorkspaceLayout({ children }: PropsWithChildren) {
  useWorkspaceEvents()
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

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

  const shellContext = useMemo(
    () => ({
      closeSidebar: () => setSidebarOpen(false),
      openSearch: () => setSearchOpen(true),
      openSidebar: () => setSidebarOpen(true),
      sidebarOpen,
    }),
    [sidebarOpen]
  )

  return (
    <WorkspaceShellContext.Provider value={shellContext}>
      <div className="h-screen overflow-hidden bg-[var(--workspace-page-bg)] text-[var(--workspace-text-primary)]">
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

        {/* Mobile overlay */}
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        {/* Mobile drawer */}
        <aside
          className={`fixed left-0 top-0 z-50 h-full w-[var(--sidebar-width)] border-r border-[color:var(--workspace-border)] bg-[var(--workspace-sidebar-bg)] transition-transform duration-200 ease-out md:hidden ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SessionRail
            onNavigate={() => setSidebarOpen(false)}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </aside>

        {/* Desktop layout */}
        <div className="grid h-full min-h-0 min-w-0 md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
          <aside className="hidden min-h-0 h-full border-r border-[color:var(--workspace-border)] bg-[var(--workspace-sidebar-bg)] md:flex md:flex-col">
            <SessionRail onOpenSearch={() => setSearchOpen(true)} />
          </aside>

          <main className="min-h-0 min-w-0 overflow-hidden bg-[var(--workspace-page-bg)]">
            {children}
          </main>
        </div>
      </div>
    </WorkspaceShellContext.Provider>
  )
}
