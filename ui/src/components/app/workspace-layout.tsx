import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react"
import { matchPath, useLocation } from "react-router-dom"

import { getToolbarMode, getWorkspacePosture, type WorkspacePosture } from "@/components/app/workspace-posture"
import { SessionRail } from "@/components/app/session-rail"
import { SidebarPane } from "@/components/app/sidebar-pane"
import { WorkspaceShellContext } from "@/components/app/workspace-shell-context"
import { useWorkspaceEvents } from "@/lib/sse/use-workspace-events"

const ProjectPickerDialog = lazy(() =>
  import("@/components/app/project-picker-dialog").then((module) => ({
    default: module.ProjectPickerDialog,
  }))
)
const SearchDialog = lazy(() =>
  import("@/components/app/search-dialog").then((module) => ({
    default: module.SearchDialog,
  }))
)

export function WorkspaceLayout({ children }: PropsWithChildren) {
  const location = useLocation()
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const eventStream = useWorkspaceEvents()
  const [searchOpen, setSearchOpen] = useState(false)
  const [posture, setPosture] = useState<WorkspacePosture>(() => {
    if (typeof window === "undefined") {
      return "wide"
    }

    return getWorkspacePosture(window.innerWidth)
  })
  const [railVisible, setRailVisible] = useState(() => {
    if (typeof window === "undefined") {
      return true
    }

    return getWorkspacePosture(window.innerWidth) === "wide"
  })
  const explicitRailPreferenceRef = useRef(false)

  const isSessionRoute = Boolean(
    matchPath("/sessions/:sessionId", location.pathname)
  )
  const showPhoneDetail = posture === "phone" && isSessionRoute
  const showPhoneList = posture === "phone" && !isSessionRoute
  const showInlineRail = posture !== "phone" && railVisible
  const toolbarMode = getToolbarMode(posture, railVisible)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((current) => !current)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [posture])

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined
    }

    function syncPosture() {
      setPosture(getWorkspacePosture(window.innerWidth))
    }

    syncPosture()
    window.addEventListener("resize", syncPosture)
    return () => window.removeEventListener("resize", syncPosture)
  }, [])

  useEffect(() => {
    if (posture === "phone") {
      setRailVisible(false)
      return
    }

    if (explicitRailPreferenceRef.current) {
      return
    }

    setRailVisible(posture === "wide")
  }, [posture])

  const shellContext = useMemo(
    () => ({
      closeProjectPicker: () => setProjectPickerOpen(false),
      eventStreamState: eventStream.status,
      hideRail: () => {
        explicitRailPreferenceRef.current = true
        setRailVisible(false)
      },
      lastEventAt: eventStream.lastEventAt,
      openProjectPicker: () => setProjectPickerOpen(true),
      openSearch: () => setSearchOpen(true),
      posture,
      projectPickerOpen,
      railVisible,
      showRail: () => {
        explicitRailPreferenceRef.current = true
        setRailVisible(true)
      },
      toggleRail: () => {
        explicitRailPreferenceRef.current = true
        setRailVisible((current) => !current)
      },
      toolbarMode,
    }),
    [
      eventStream.lastEventAt,
      eventStream.status,
      posture,
      projectPickerOpen,
      railVisible,
      toolbarMode,
    ]
  )

  const rail = <SessionRail onOpenSearch={() => setSearchOpen(true)} />

  return (
    <WorkspaceShellContext.Provider value={shellContext}>
      <div
        className="h-dvh overflow-hidden bg-background text-foreground"
        data-rail-visible={railVisible ? "true" : "false"}
        data-shell-posture={posture}
      >
        {projectPickerOpen ? (
          <Suspense fallback={null}>
            <ProjectPickerDialog open={projectPickerOpen} />
          </Suspense>
        ) : null}
        {searchOpen ? (
          <Suspense fallback={null}>
            <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
          </Suspense>
        ) : null}

        {showPhoneList ? (
          <div className="h-full min-h-0" data-testid="workspace-phone-list">
            {rail}
          </div>
        ) : null}

        {showPhoneList ? null : (
          <>
          <div className="flex h-full min-h-0 min-w-0">
              {showInlineRail ? (
                <SidebarPane
                  className="h-full min-h-0"
                  data-testid="workspace-rail-pane"
                >
                  {rail}
                </SidebarPane>
              ) : null}

              <main
                className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
                data-testid={
                  showPhoneDetail
                    ? "workspace-phone-detail"
                    : "workspace-shell-detail"
                }
              >
                {children}
              </main>
            </div>
          </>
        )}
      </div>
    </WorkspaceShellContext.Provider>
  )
}
