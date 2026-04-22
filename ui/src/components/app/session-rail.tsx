import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ChevronDown,
  Copy,
  Folder,
  FolderOpen,
  ListChecks,
  LoaderCircle,
  Settings,
  SquarePen,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { RailRow, type RailRowProps } from "@/components/app/rail-row"
import { ScrollbarIndicator } from "@/components/app/scrollbar-indicator"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  UpdatePolicy,
  UpdateState,
  type UpdateStatus,
} from "@/gen/proto/hopter/v1/host_pb"
import {
  useApplyUpdate,
  useHostUpdates,
} from "@/features/host/use-host-updates"
import { useSessions } from "@/features/sessions/use-sessions"
import { formatSessionStatus, timestampToDate } from "@/lib/format/proto"
import { cn } from "@/lib/utils"
import { useAutoHideScrollbar } from "@/components/app/use-auto-hide-scrollbar"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"

function formatRelativeTime(date?: Date) {
  if (!date) {
    return ""
  }

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) {
    return "now"
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

function sessionWeight(updatedAt?: Date) {
  if (!updatedAt) {
    return 0
  }

  return updatedAt.getTime()
}

function sessionDot(status: string) {
  switch (status.toLowerCase()) {
    case "running":
      return "bg-emerald-400/75"
    case "completed":
      return "bg-sky-400/75"
    case "waiting":
      return "bg-amber-300/70"
    default:
      return "bg-primary-muted/70"
  }
}

function RailBrand({ right }: { right?: ReactNode }) {
  return (
    <RailRow
      icon={
        <svg
          viewBox="0 0 200 186"
          aria-hidden="true"
          className="size-3.5 text-foreground"
          fill="none"
        >
          <path
            d="M180 154.858C180 148.718 175.011 143.716 168.828 143.716L149.016 143.71L159.045 160.252L159.096 160.336L159.145 160.42C161.089 163.773 164.7 166 168.828 166C175.011 166 180 160.999 180 154.858ZM81.1475 123.69L113.496 123.7L95.6289 94.2285L81.1475 123.69ZM105.883 31.1416C105.883 25.0016 100.895 20.0002 94.7119 20C88.5288 20 83.5402 25.0015 83.54 31.1416C83.54 33.0245 84.0012 34.7716 84.8086 36.3057L94.7109 53.4404L104.62 36.2939C105.424 34.7627 105.883 33.0197 105.883 31.1416ZM20 154.819C20.0001 160.96 24.9888 165.961 31.1719 165.961C35.2008 165.961 38.7371 163.839 40.7119 160.619L49.0371 143.682L31.1709 143.678C24.9881 143.678 20 148.679 20 154.819ZM125.883 31.1416C125.883 36.4459 124.548 41.4686 122.187 45.8613L122.113 45.9971L122.036 46.1299L106.331 73.3027L136.889 123.707L168.831 123.716C186.033 123.717 200 137.647 200 154.858C200 172.071 186.03 186 168.828 186C157.343 186 147.317 179.788 141.919 170.582L125.624 143.704L71.3193 143.688L58.3301 170.116L58.1582 170.413C52.779 179.691 42.7111 185.961 31.1719 185.961C13.9696 185.961 0.000107326 172.032 0 154.819C2.86102e-06 137.607 13.9695 123.678 31.1719 123.678L58.8652 123.685L83.3818 73.8066L67.3867 46.1299L67.3096 45.9971L67.2363 45.8604C64.8753 41.4677 63.54 36.4457 63.54 31.1416C63.5402 13.9293 77.5097 0 94.7119 0C111.914 0.000230651 125.883 13.9294 125.883 31.1416Z"
            fill="currentColor"
          />
        </svg>
      }
      interactive={false}
      className="text-foreground"
      labelClassName="min-w-0 font-semibold tracking-tight text-foreground"
      label="Hopter"
      right={right}
      rightClassName="opacity-100"
    />
  )
}

type SessionRailProps = {
  onNavigate?: () => void
}

const sessionRailUiStateStorageKey = "hopter.sessionRailUiState"

type SessionRailUiState = {
  closedProjectIds: Record<string, boolean>
  collapsedProjectIds: Record<string, boolean>
  projectsCollapsed: boolean
}

function readSessionRailUiState(): SessionRailUiState {
  if (typeof window === "undefined") {
    return {
      closedProjectIds: {},
      collapsedProjectIds: {},
      projectsCollapsed: false,
    }
  }

  try {
    const stored = window.localStorage.getItem(sessionRailUiStateStorageKey)
    if (!stored) {
      return {
        closedProjectIds: {},
        collapsedProjectIds: {},
        projectsCollapsed: false,
      }
    }

    const parsed = JSON.parse(stored) as Partial<SessionRailUiState>
    return {
      closedProjectIds:
        parsed.closedProjectIds &&
        typeof parsed.closedProjectIds === "object" &&
        !Array.isArray(parsed.closedProjectIds)
          ? parsed.closedProjectIds
          : {},
      collapsedProjectIds:
        parsed.collapsedProjectIds &&
        typeof parsed.collapsedProjectIds === "object" &&
        !Array.isArray(parsed.collapsedProjectIds)
          ? parsed.collapsedProjectIds
          : {},
      projectsCollapsed: parsed.projectsCollapsed === true,
    }
  } catch {
    return {
      closedProjectIds: {},
      collapsedProjectIds: {},
      projectsCollapsed: false,
    }
  }
}

type SessionRailConfiguredItem =
  | {
      key: string
      kind: "brand"
      right?: ReactNode
    }
  | {
      key: string
      kind: "row"
      props: RailRowProps
    }
  | {
      key: string
      kind: "spacer"
      className: string
    }

function renderConfiguredRailItem(item: SessionRailConfiguredItem) {
  switch (item.kind) {
    case "brand":
      return (
        <li key={item.key}>
          <RailBrand right={item.right} />
        </li>
      )
    case "row":
      return (
        <li key={item.key}>
          <RailRow {...item.props} />
        </li>
      )
    case "spacer":
      return <li key={item.key} className={item.className} aria-hidden="true" />
  }
}

export function SessionRail({ onNavigate }: SessionRailProps) {
  const { eventStreamState, posture } = useWorkspaceShell()
  const navigate = useNavigate()
  const railScrollRef = useRef<HTMLDivElement | null>(null)
  const railListRef = useRef<HTMLUListElement | null>(null)
  const {
    handleScroll,
    scrollbarScrollable,
    scrollbarVisible,
    thumbHeight,
    thumbOffset,
  } = useAutoHideScrollbar(railScrollRef, {
    contentRef: railListRef,
  })
  const {
    data: sessions,
    isError,
    isLoading,
  } = useSessions(undefined, eventStreamState === "connected" ? 10_000 : 3_000)
  const [railUiState, setRailUiState] = useState<SessionRailUiState>(() =>
    readSessionRailUiState()
  )
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [reloadTargetVersion, setReloadTargetVersion] = useState<string | null>(
    null
  )
  const applyUpdate = useApplyUpdate()
  const { data: updateStatus } = useHostUpdates(
    reloadTargetVersion
      ? 1_000
      : eventStreamState === "connected"
        ? 30_000
        : 10_000
  )

  const groupedSessions = useMemo(() => {
    const sorted = [...(sessions ?? [])]
      .sort((left, right) => {
        const leftDate = timestampToDate(left.updatedAt)
        const rightDate = timestampToDate(right.updatedAt)
        return sessionWeight(rightDate) - sessionWeight(leftDate)
      })
      .slice(0, 30)

    const groups: {
      projectId: string
      projectName: string
      projectRootPath: string
      sessions: typeof sorted
    }[] = []
    const groupMap = new Map<string, (typeof groups)[number]>()

    for (const session of sorted) {
      const pid = session.project?.id || ""
      const pname = session.project?.name || "Unassigned"
      const rootPath = session.project?.rootPath || ""
      let group = groupMap.get(pid)
      if (!group) {
        group = {
          projectId: pid,
          projectName: pname,
          projectRootPath: rootPath,
          sessions: [],
        }
        groupMap.set(pid, group)
        groups.push(group)
      }
      if (!group.projectRootPath && rootPath) {
        group.projectRootPath = rootPath
      }
      group.sessions.push(session)
    }

    return groups
  }, [sessions])

  useEffect(() => {
    if (!reloadTargetVersion || !updateStatus?.currentVersion) {
      return
    }
    if (updateStatus.currentVersion !== reloadTargetVersion) {
      return
    }
    setReloadTargetVersion(null)
    window.location.reload()
  }, [reloadTargetVersion, updateStatus?.currentVersion])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(
      sessionRailUiStateStorageKey,
      JSON.stringify(railUiState)
    )
  }, [railUiState])

  const { closedProjectIds, collapsedProjectIds, projectsCollapsed } =
    railUiState

  const updateControl = getUpdateControl(updateStatus, applyUpdate.isPending)

  async function handleApplyUpdate() {
    try {
      const nextStatus = await applyUpdate.mutateAsync()
      const targetVersion =
        nextStatus?.targetVersion || nextStatus?.availableUpdate?.version || ""
      if (targetVersion) {
        setReloadTargetVersion(targetVersion)
      }
      toast.success("hopter is applying the update")
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to apply update"))
    }
  }

  function handleCopyCommand(command: string) {
    if (!command) {
      return
    }
    navigator.clipboard.writeText(command).then(
      () => toast.success("Upgrade command copied"),
      () => {}
    )
  }

  const configuredRailItems: SessionRailConfiguredItem[] = [
    {
      key: "brand",
      kind: "brand",
      right: updateControl.visible ? (
        <UpdateRailAction
          commandHint={updateStatus?.upgradeCommandHint ?? ""}
          onApply={handleApplyUpdate}
          onOpenDialog={() => setUpdateDialogOpen(true)}
          status={updateStatus}
        />
      ) : null,
    },
    {
      key: "new-chat",
      kind: "row",
      props: {
        asDivInteractive: true,
        icon: <SquarePen className="size-3.5" />,
        label: "New chat",
        onClick: () => {
          onNavigate?.()
          navigate("/?compose=1")
        },
        className:
          "text-muted-foreground hover:bg-accent hover:text-foreground",
      },
    },
    {
      key: "tasks",
      kind: "row",
      props: {
        icon: <ListChecks className="size-3.5" />,
        label: "Tasks",
        onClick: onNavigate,
        to: "/tasks",
        className:
          "text-muted-foreground hover:bg-accent hover:text-foreground",
        activeClassName: "bg-accent text-foreground",
        nav: true,
      },
    },
    {
      key: "settings",
      kind: "row",
      props: {
        icon: <Settings className="size-3.5" />,
        label: "Settings",
        onClick: onNavigate,
        to: "/settings",
        className:
          "text-muted-foreground hover:bg-accent hover:text-foreground",
        activeClassName: "bg-accent text-foreground",
        nav: true,
      },
    },
    {
      key: "section-gap",
      kind: "spacer",
      className: "h-3",
    },
    {
      key: "projects-toggle",
      kind: "row",
      props: {
        icon: null,
        label: "Projects",
        onClick: () =>
          setRailUiState((current) => ({
            ...current,
            projectsCollapsed: !current.projectsCollapsed,
          })),
        asDivInteractive: true,
        reserveIconSpace: false,
        labelFill: false,
        labelClassName: "select-none tracking-tight text-muted-foreground",
        className: "text-muted-foreground",
        right: (
          <ChevronDown
            className={cn(
              "size-3 transition-transform",
              projectsCollapsed ? "-rotate-90" : "rotate-0"
            )}
          />
        ),
      },
    },
  ]

  return (
    <div
      className={cn(
        "flex h-full flex-col text-base text-foreground",
        posture === "phone" ? "bg-background" : "bg-sidebar"
      )}
      data-testid="session-rail"
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={railScrollRef}
          className="scrollbar-native-hidden h-full overflow-y-auto px-2 py-1.5 font-medium"
          onScroll={handleScroll}
        >
          <ul
            ref={railListRef}
            data-rail-list="true"
            className="flex min-h-full flex-col gap-1"
          >
            {configuredRailItems.map(renderConfiguredRailItem)}

            {isLoading ? (
              <li>
                <RailRow
                  icon={null}
                  label="Loading threads..."
                  labelClassName="text-muted-foreground"
                />
              </li>
            ) : null}

            {isError ? (
              <li>
                <RailRow
                  icon={null}
                  label="The shell is ready. Session data will appear when the backend responds."
                  labelClassName="text-muted-foreground"
                />
              </li>
            ) : null}

            {!isLoading && !isError && groupedSessions.length === 0 ? (
              <li>
                <RailRow
                  icon={null}
                  label="No threads yet. Open a repo and continue from the same workspace."
                  labelClassName="text-muted-foreground"
                />
              </li>
            ) : null}

            {projectsCollapsed
              ? null
              : groupedSessions.map((group) => {
                  const groupKey = group.projectId || group.projectName
                  const folderClosed = closedProjectIds[groupKey] ?? false
                  const sessionsCollapsed =
                    collapsedProjectIds[groupKey] ?? false
                  const visibleSessions = sessionsCollapsed
                    ? group.sessions.slice(0, 5)
                    : group.sessions

                  return (
                    <Fragment key={groupKey}>
                      <li>
                        <RailRow
                          icon={
                            folderClosed ? (
                              <Folder className="size-3.5" />
                            ) : (
                              <FolderOpen className="size-3.5" />
                            )
                          }
                          label={group.projectName}
                          title={group.projectRootPath || group.projectName}
                          onClick={() =>
                            setRailUiState((current) => ({
                              ...current,
                              closedProjectIds: {
                                ...current.closedProjectIds,
                                [groupKey]: !current.closedProjectIds[groupKey],
                              },
                            }))
                          }
                          right={
                            <button
                              type="button"
                              title={`New thread in ${group.projectName}`}
                              className="flex size-5 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                              onClick={(event) => {
                                event.stopPropagation()
                                onNavigate?.()
                                navigate({
                                  pathname: "/",
                                  search: new URLSearchParams(
                                    group.projectId
                                      ? {
                                          compose: "1",
                                          projectId: group.projectId,
                                        }
                                      : { compose: "1" }
                                  ).toString(),
                                })
                              }}
                            >
                              <SquarePen className="size-3" />
                            </button>
                          }
                          rightClassName="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                          labelClassName="truncate whitespace-nowrap tracking-tight text-foreground"
                          className="text-foreground hover:bg-accent/60 hover:text-foreground"
                          ariaExpanded={!folderClosed}
                        />
                      </li>
                      {folderClosed
                        ? null
                        : visibleSessions.map((session) => {
                            const updatedAt = timestampToDate(session.updatedAt)
                            const status = formatSessionStatus(
                              session.status
                            ).toLowerCase()

                            return (
                              <li key={session.id}>
                                <RailRow
                                  icon={
                                    status === "running" ? (
                                      <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                                    ) : (
                                      <span
                                        className={cn(
                                          "size-1.5 rounded-full",
                                          sessionDot(status)
                                        )}
                                      />
                                    )
                                  }
                                  label={session.title || "Untitled thread"}
                                  onClick={onNavigate}
                                  to={`/sessions/${session.id}`}
                                  labelClassName="truncate"
                                  right={
                                    <span className="text-muted-foreground">
                                      {formatRelativeTime(updatedAt)}
                                    </span>
                                  }
                                  className="text-foreground/80 hover:bg-muted hover:text-foreground"
                                  activeClassName="bg-accent text-foreground"
                                  nav
                                />
                              </li>
                            )
                          })}
                      {!folderClosed && group.sessions.length > 5 ? (
                        <li>
                          <RailRow
                            asDivInteractive
                            icon={null}
                            label={
                              sessionsCollapsed
                                ? "Show expanded"
                                : "Show collapsed"
                            }
                            onClick={() =>
                              setRailUiState((current) => ({
                                ...current,
                                collapsedProjectIds: {
                                  ...current.collapsedProjectIds,
                                  [groupKey]: !sessionsCollapsed,
                                },
                              }))
                            }
                            labelClassName="text-muted-foreground"
                            className="hover:bg-accent/60"
                          />
                        </li>
                      ) : null}
                    </Fragment>
                  )
                })}
          </ul>
        </div>
        <ScrollbarIndicator
          scrollable={scrollbarScrollable}
          thumbHeight={thumbHeight}
          thumbOffset={thumbOffset}
          visible={scrollbarVisible}
        />
      </div>
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade on host</DialogTitle>
            <DialogDescription>
              Run this command on the machine that is currently running{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                hopter
              </code>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
            {updateStatus?.upgradeCommandHint ||
              "No package-manager command available."}
          </div>
          <DialogFooter showCloseButton>
            {updateStatus?.upgradeCommandHint ? (
              <Button
                variant="outline"
                onClick={() =>
                  handleCopyCommand(updateStatus.upgradeCommandHint)
                }
              >
                <Copy className="size-3.5" />
                Copy command
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UpdateRailAction({
  commandHint,
  onApply,
  onOpenDialog,
  status,
}: {
  commandHint: string
  onApply: () => void
  onOpenDialog: () => void
  status?: UpdateStatus
}) {
  const busy =
    status?.state === UpdateState.REEXECING ||
    status?.state === UpdateState.DOWNLOADING ||
    status?.state === UpdateState.VERIFYING ||
    status?.state === UpdateState.PREFLIGHT_RUNNING

  if (!status) {
    return null
  }

  if (busy) {
    return (
      <Button disabled size="sm">
        Upgrading
      </Button>
    )
  }

  if (status.updatePolicy === UpdatePolicy.SELF_MANAGED) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onApply()
        }}
        title={
          status.availableUpdate?.version
            ? `Upgrade to ${status.availableUpdate.version}`
            : "Upgrade hopter"
        }
      >
        Upgrade
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenDialog()
      }}
      title={commandHint || "Show upgrade command"}
    >
      Upgrade
    </Button>
  )
}

function getUpdateControl(status: UpdateStatus | undefined, applying: boolean) {
  if (!status) {
    return { visible: false }
  }

  const visible =
    status.updateAvailable || applying || status.state === UpdateState.REEXECING
  return { visible }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}
