import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import {
  ChevronDown,
  Copy,
  Folder,
  FolderOpen,
  ListChecks,
  LoaderCircle,
  Settings,
  SquarePen,
  X,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button, Description, Modal, Tooltip } from "@heroui/react"

import { ScrollbarIndicator } from "@/components/app/shared"
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
import { SessionStatus } from "@/gen/proto/hopter/v1/common_pb"
import { timestampToDate } from "@/lib/format/proto"
import { useUnreadSessionIds } from "@/lib/session-unread"
import { cn } from "@/lib/utils"
import {
  hiddenScrollbarClassName,
  useAutoHideScrollbar,
} from "@/components/app/shared"
import { useWorkspaceShell } from "@/components/app/workspace"

import { RailRow, type RailRowProps } from "./row"

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

function isSessionRunning(status: SessionStatus) {
  return status === SessionStatus.RUNNING || status === SessionStatus.PENDING
}

function shouldShowSessionUnreadDot(status: SessionStatus, unread: boolean) {
  return (
    unread ||
    status === SessionStatus.WAITING_APPROVAL ||
    status === SessionStatus.WAITING_INPUT
  )
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

// The rail remembers per-project expansion state locally because it is purely
// navigational UI state and should not round-trip through the backend.
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

// SessionRail is the left-hand navigation owner: session polling, grouping, UI
// persistence, and the host update affordance all live here.
export function SessionRail({ onNavigate }: SessionRailProps) {
  const { t } = useTranslation()
  const { eventStreamState, posture } = useWorkspaceShell()
  const navigate = useNavigate()
  const unreadSessionIds = useUnreadSessionIds()
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
      const pname = session.project?.name || t("rail.unassigned")
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
  }, [sessions, t])

  useEffect(() => {
    if (!reloadTargetVersion || !updateStatus?.currentVersion) {
      return
    }
    if (updateStatus.currentVersion !== reloadTargetVersion) {
      return
    }
    // A successful self-update re-execs the binary. Reload only after the host
    // reports the new version so the browser reconnects to the fresh process.
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
      toast.success(t("rail.upgrading"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("rail.upgradeError")))
    }
  }

  function handleCopyCommand(command: string) {
    if (!command) {
      return
    }
    navigator.clipboard.writeText(command).then(
      () => toast.success(t("rail.upgradeCommandCopied")),
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
        label: t("nav.newChat"),
        onClick: () => {
          onNavigate?.()
          navigate("/?compose=1")
        },
        className: "text-muted hover:bg-surface-tertiary hover:text-foreground",
      },
    },
    {
      key: "tasks",
      kind: "row",
      props: {
        icon: <ListChecks className="size-3.5" />,
        label: t("nav.tasks"),
        onClick: onNavigate,
        to: "/tasks",
        className: "text-muted hover:bg-surface-tertiary hover:text-foreground",
        activeClassName: "bg-surface-tertiary text-foreground",
        nav: true,
      },
    },
    {
      key: "settings",
      kind: "row",
      props: {
        icon: <Settings className="size-3.5" />,
        label: t("nav.settings"),
        onClick: onNavigate,
        to: "/settings",
        className: "text-muted hover:bg-surface-tertiary hover:text-foreground",
        activeClassName: "bg-surface-tertiary text-foreground",
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
        label: t("nav.projects"),
        onClick: () =>
          setRailUiState((current) => ({
            ...current,
            projectsCollapsed: !current.projectsCollapsed,
          })),
        asDivInteractive: true,
        reserveIconSpace: false,
        labelFill: false,
        labelClassName: "select-none tracking-tight text-muted",
        className: "text-muted",
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
        posture === "phone" ? "bg-background" : "bg-surface-secondary"
      )}
      data-testid="session-rail"
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={railScrollRef}
          className={cn(
            hiddenScrollbarClassName,
            "h-full overflow-y-auto px-2 py-1.5 font-medium"
          )}
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
                  label={t("nav.loadingThreads")}
                  labelClassName="text-muted"
                />
              </li>
            ) : null}

            {isError ? (
              <li>
                <RailRow
                  icon={null}
                  label={t("nav.sessionDataPending")}
                  labelClassName="text-muted"
                />
              </li>
            ) : null}

            {!isLoading && !isError && groupedSessions.length === 0 ? (
              <li>
                <RailRow
                  icon={null}
                  label={t("nav.noThreads")}
                  labelClassName="text-muted"
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
                  // Collapsing a long project list still keeps a small preview
                  // set visible so the rail remains scannable at a glance.
                  const visibleSessions = sessionsCollapsed
                    ? group.sessions.slice(0, 5)
                    : group.sessions

                  return (
                    <Fragment key={groupKey}>
                      <li>
                        <div className="group relative">
                          <RailRow
                            icon={
                              folderClosed ? (
                                <Folder className="size-3.5" />
                              ) : (
                                <FolderOpen className="size-3.5" />
                              )
                            }
                            label={
                              group.projectRootPath ? (
                                <Tooltip>
                                  <Tooltip.Trigger className="block truncate">
                                    {group.projectName}
                                  </Tooltip.Trigger>
                                  <Tooltip.Content
                                    placement="top start"
                                    className="max-w-md break-all"
                                    showArrow
                                  >
                                    {group.projectRootPath}
                                  </Tooltip.Content>
                                </Tooltip>
                              ) : (
                                group.projectName
                              )
                            }
                            onClick={() =>
                              setRailUiState((current) => ({
                                ...current,
                                closedProjectIds: {
                                  ...current.closedProjectIds,
                                  [groupKey]:
                                    !current.closedProjectIds[groupKey],
                                },
                              }))
                            }
                            labelClassName="whitespace-nowrap tracking-tight text-foreground"
                            className="pr-10 text-foreground group-hover:bg-surface-tertiary group-hover:text-foreground hover:bg-surface-tertiary hover:text-foreground"
                            ariaExpanded={!folderClosed}
                          />
                          <button
                            type="button"
                            title={t("rail.newThreadInProject", {
                              project: group.projectName,
                            })}
                            className="absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface hover:text-foreground"
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
                        </div>
                      </li>
                      {folderClosed
                        ? null
                        : visibleSessions.map((session) => {
                            const updatedAt = timestampToDate(session.updatedAt)
                            const sessionRunning = isSessionRunning(
                              session.status
                            )
                            const showUnreadDot = shouldShowSessionUnreadDot(
                              session.status,
                              unreadSessionIds.has(session.id)
                            )

                            return (
                              <li key={session.id}>
                                <RailRow
                                  icon={
                                    sessionRunning ? (
                                      <LoaderCircle className="size-3.5 animate-spin text-muted" />
                                    ) : showUnreadDot ? (
                                      <span className="size-1.5 rounded-full bg-sky-400/75" />
                                    ) : null
                                  }
                                  label={
                                    session.title || t("rail.untitledThread")
                                  }
                                  onClick={onNavigate}
                                  to={`/sessions/${session.id}`}
                                  labelClassName="truncate"
                                  right={
                                    <span className="text-muted">
                                      {formatRelativeTime(updatedAt)}
                                    </span>
                                  }
                                  className="text-foreground/80 hover:bg-surface-tertiary hover:text-foreground"
                                  activeClassName="bg-surface-tertiary text-foreground"
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
                                ? t("rail.showMore")
                                : t("rail.showFewer")
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
                            labelClassName="text-muted"
                            className="hover:bg-surface-tertiary"
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
      <Modal isOpen={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <Modal.Backdrop variant="opaque">
          <Modal.Container size="cover">
            <Modal.Dialog className="relative grid w-full max-w-[calc(100%-2rem)] gap-6 rounded-3xl bg-overlay p-6 text-sm text-overlay-foreground ring-1 ring-foreground/5 outline-none sm:max-w-md">
              <Modal.Header className="flex flex-col gap-2">
                <Modal.Heading className="font-heading text-base leading-none font-medium">
                  {t("rail.upgradeDialogTitle")}
                </Modal.Heading>
                <Description className="text-sm text-muted">
                  {t("rail.upgradeDialogDescription", { name: "hopter" })}
                </Description>
              </Modal.Header>
              <Modal.CloseTrigger
                aria-label="Close"
                className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-tertiary hover:text-foreground"
              >
                <X className="size-4" />
              </Modal.CloseTrigger>
              <div className="rounded-lg border border-border bg-surface-tertiary/40 p-3 font-mono text-xs text-foreground">
                {updateStatus?.upgradeCommandHint || t("rail.noUpgradeCommand")}
              </div>
              <Modal.Footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {updateStatus?.upgradeCommandHint ? (
                  <Button
                    variant="outline"
                    onPress={() =>
                      handleCopyCommand(updateStatus.upgradeCommandHint)
                    }
                  >
                    <Copy className="size-3.5" />
                    {t("rail.copyCommand")}
                  </Button>
                ) : null}
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
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
  const { t } = useTranslation()
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
      <Button isDisabled size="sm">
        {t("rail.upgrading")}
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
        aria-label={
          status.availableUpdate?.version
            ? t("rail.upgradeTo", {
                version: status.availableUpdate.version,
              })
            : t("rail.upgradeHopter")
        }
      >
        {t("rail.upgrade")}
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
      aria-label={commandHint || t("rail.showUpgradeCommand")}
    >
      {t("rail.upgrade")}
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
