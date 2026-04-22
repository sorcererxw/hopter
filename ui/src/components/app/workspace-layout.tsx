import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react"
import { matchPath, useLocation, useNavigate } from "react-router-dom"

import {
  getToolbarMode,
  getWorkspacePosture,
  type WorkspacePosture,
} from "@/components/app/workspace-posture"
import { SessionRail } from "@/components/app/session-rail"
import { SidebarPane } from "@/components/app/sidebar-pane"
import { WorkspaceShellContext } from "@/components/app/workspace-shell-context"
import { useWorkspaceEvents } from "@/lib/sse/use-workspace-events"
import { cn } from "@/lib/utils"

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
  const navigate = useNavigate()
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
  const isComposeRoute =
    location.pathname === "/" &&
    new URLSearchParams(location.search).get("compose") === "1"
  const isProjectPickerRoute = location.pathname === "/projects/new"
  const isTasksRoute =
    location.pathname === "/tasks" || location.pathname.startsWith("/tasks/")
  const isPluginsRoute =
    location.pathname === "/plugins" ||
    location.pathname.startsWith("/plugins/")
  const isSettingsRoute =
    location.pathname === "/settings" ||
    location.pathname.startsWith("/settings/")
  const showPhoneDetail =
    posture === "phone" &&
    (isSessionRoute ||
      isComposeRoute ||
      isProjectPickerRoute ||
      isTasksRoute ||
      isPluginsRoute ||
      isSettingsRoute)
  const showPhoneList = posture === "phone" && !showPhoneDetail
  const showRailSlot = posture !== "phone"
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
      openProjectPicker: () => {
        if (posture === "phone") {
          navigate("/projects/new")
          return
        }
        setProjectPickerOpen(true)
      },
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
      navigate,
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
              {showRailSlot ? (
                <div
                  aria-hidden={!railVisible}
                  className={cn(
                    "h-full min-h-0 shrink-0 overflow-hidden transition-all duration-200 ease-out",
                    railVisible
                      ? "w-[248px] translate-x-0 opacity-100"
                      : "pointer-events-none w-0 -translate-x-2 opacity-0"
                  )}
                  data-testid="workspace-rail-pane"
                >
                  <SidebarPane className="h-full min-h-0">{rail}</SidebarPane>
                </div>
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
