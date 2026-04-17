import { useEffect, useMemo, useState, type PropsWithChildren } from "react"

import { ProjectPickerDialog } from "@/components/app/project-picker-dialog"
import { SearchDialog } from "@/components/app/search-dialog"
import { SessionRail } from "@/components/app/session-rail"
import { WorkspaceShellContext } from "@/components/app/workspace-shell-context"
import { useWorkspaceEvents } from "@/lib/sse/use-workspace-events"

export function WorkspaceLayout({ children }: PropsWithChildren) {
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
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
      closeProjectPicker: () => setProjectPickerOpen(false),
      closeSidebar: () => setSidebarOpen(false),
      openProjectPicker: () => setProjectPickerOpen(true),
      openSearch: () => setSearchOpen(true),
      openSidebar: () => setSidebarOpen(true),
      projectPickerOpen,
      sidebarOpen,
    }),
    [projectPickerOpen, sidebarOpen]
  )

  return (
    <WorkspaceShellContext.Provider value={shellContext}>
      <div className="h-dvh overflow-hidden bg-background text-foreground">
        <ProjectPickerDialog open={projectPickerOpen} />
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <aside
          className={`fixed left-0 top-0 z-50 h-full w-[248px] border-r border-border bg-sidebar transition-transform duration-300 md:hidden ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SessionRail
            onNavigate={() => setSidebarOpen(false)}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </aside>

        <div className="grid h-full min-h-0 min-w-0 md:grid-cols-[248px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 h-full border-r border-border bg-sidebar md:flex md:flex-col">
            <SessionRail onOpenSearch={() => setSearchOpen(true)} />
          </aside>

          <main className="min-h-0 min-w-0 overflow-hidden bg-background">
            {children}
          </main>
        </div>
      </div>
    </WorkspaceShellContext.Provider>
  )
}
