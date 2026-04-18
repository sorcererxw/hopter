import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2x2,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
  Wrench,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { RailRow } from "@/components/app/rail-row"
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
} from "@/gen/proto/orchd/v1/host_pb"
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

type SessionRailProps = {
  onNavigate?: () => void
  onOpenSearch: () => void
}

export function SessionRail({ onNavigate, onOpenSearch }: SessionRailProps) {
  const { eventStreamState, openProjectPicker, posture } = useWorkspaceShell()
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
  const [closedProjectIds, setClosedProjectIds] = useState<
    Record<string, boolean>
  >({})
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<
    Record<string, boolean>
  >({})
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
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

  const updateControl = getUpdateControl(updateStatus, applyUpdate.isPending)

  async function handleApplyUpdate() {
    try {
      const nextStatus = await applyUpdate.mutateAsync()
      const targetVersion =
        nextStatus?.targetVersion || nextStatus?.availableUpdate?.version || ""
      if (targetVersion) {
        setReloadTargetVersion(targetVersion)
      }
      toast.success("orchd is applying the update")
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
            <li>
              <RailRow
                asDivInteractive
                icon={<SquarePen className="size-3.5" />}
                label="New chat"
                onClick={() => {
                  onNavigate?.()
                  navigate("/?compose=1")
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
                right={
                  updateControl.visible ? (
                    <UpdateRailAction
                      commandHint={updateStatus?.upgradeCommandHint ?? ""}
                      onApply={handleApplyUpdate}
                      onOpenDialog={() => setUpdateDialogOpen(true)}
                      status={updateStatus}
                    />
                  ) : null
                }
                rightClassName="opacity-100"
              />
            </li>
            <li>
              <RailRow
                icon={<Search className="size-3.5" />}
                label="Search"
                onClick={onOpenSearch}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
                right={
                  <span className="workspace-kbd text-base opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                    ⌘K
                  </span>
                }
              />
            </li>
            <li>
              <RailRow
                icon={<Grid2x2 className="size-3.5" />}
                label="Skills & Apps"
                onClick={onNavigate}
                to="/settings/plugins#skills"
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
              />
            </li>
            <li>
              <RailRow
                icon={<FolderPlus className="size-3.5" />}
                label="New project"
                onClick={() => {
                  onNavigate?.()
                  openProjectPicker()
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
              />
            </li>
            <li>
              <RailRow
                icon={<Settings className="size-3.5" />}
                label="Settings"
                onClick={onNavigate}
                to="/settings"
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
              />
            </li>

            <li className="h-3" aria-hidden="true" />

            <li>
              <RailRow
                icon={null}
                label="Projects"
                onClick={() => setProjectsCollapsed((current) => !current)}
                asDivInteractive
                reserveIconSpace={false}
                labelFill={false}
                labelClassName="select-none tracking-tight text-muted-foreground"
                className="text-muted-foreground"
                right={
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      projectsCollapsed ? "-rotate-90" : "rotate-0"
                    )}
                  />
                }
              />
            </li>

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
                            setClosedProjectIds((current) => ({
                              ...current,
                              [groupKey]: !current[groupKey],
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
                            label={sessionsCollapsed ? "展开显示" : "折叠显示"}
                            onClick={() =>
                              setCollapsedProjectIds((current) => ({
                                ...current,
                                [groupKey]: !sessionsCollapsed,
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
                orchd
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
      <span className="inline-flex items-center gap-1 text-xs text-foreground/70">
        <LoaderCircle className="size-3 animate-spin" />
        Updating
      </span>
    )
  }

  if (status.updatePolicy === UpdatePolicy.SELF_MANAGED) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onApply()
        }}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground/80 transition hover:bg-accent hover:text-foreground"
        title={
          status.availableUpdate?.version
            ? `Update to ${status.availableUpdate.version}`
            : "Update orchd"
        }
      >
        <RefreshCw className="size-3" />
        Update
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenDialog()
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground/80 transition hover:bg-accent hover:text-foreground"
      title={commandHint || "Show update command"}
    >
      <Wrench className="size-3" />
      Update
    </button>
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
