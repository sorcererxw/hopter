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
  Copy,
  Folder,
  FolderOpen,
  LoaderCircle,
  Settings,
  QuillWrite02Icon,
  X,
} from "@/components/icons/hugeicons"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button, Description, Modal, Tooltip } from "@heroui/react"

import { SimplebarScrollArea } from "@/components/app/shared"
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
import { useWorkspaceShell } from "@/components/app/workspace"

import { RailRow, type RailRowProps } from "./row"
import LogoIcon from "@/components/icons/LogoIcon.tsx"

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

function RailBrand({
  right,
  className,
  iconClassName,
  labelClassName,
}: {
  right?: ReactNode
  className?: string
  iconClassName?: string
  labelClassName?: string
}) {
  return (
    <RailRow
      icon={<LogoIcon className={cn("size-4", iconClassName)} />}
      interactive={false}
      className={cn(className)}
      labelClassName={cn("min-w-0 font-semibold tracking-tight", labelClassName)}
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
}

// The rail remembers per-project expansion state locally because it is purely
// navigational UI state and should not round-trip through the backend.
function readSessionRailUiState(): SessionRailUiState {
  if (typeof window === "undefined") {
    return {
      closedProjectIds: {},
      collapsedProjectIds: {},
    }
  }

  try {
    const stored = window.localStorage.getItem(sessionRailUiStateStorageKey)
    if (!stored) {
      return {
        closedProjectIds: {},
        collapsedProjectIds: {},
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
    }
  } catch {
    return {
      closedProjectIds: {},
      collapsedProjectIds: {},
    }
  }
}

type SessionRailConfiguredItem =
  | {
      key: string
      kind: "brand"
      right?: ReactNode
      brandClassName?: string
      brandIconClassName?: string
      brandLabelClassName?: string
    }
  | {
      key: string
      kind: "row"
      props: RailRowProps
    }
  | {
      key: string
      kind: "divider"
      className: string
    }

function renderConfiguredRailItem(item: SessionRailConfiguredItem) {
  switch (item.kind) {
    case "brand":
      return (
        <li key={item.key}>
          <RailBrand
            right={item.right}
            className={item.brandClassName}
            iconClassName={item.brandIconClassName}
            labelClassName={item.brandLabelClassName}
          />
        </li>
      )
    case "row":
      return (
        <li key={item.key}>
          <RailRow {...item.props} />
        </li>
      )
    case "divider":
      return (
        <li key={item.key} aria-hidden="true">
          <div className={cn("my-1 h-px border-t border-border", item.className)} />
        </li>
      )
  }
}

// SessionRail is the left-hand navigation owner: session polling, grouping, UI
// persistence, and the host update affordance all live here.
export function SessionRail({ onNavigate }: SessionRailProps) {
  const { t } = useTranslation()
  const { eventStreamState } = useWorkspaceShell()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const unreadSessionIds = useUnreadSessionIds()
  const railScrollRef = useRef<HTMLDivElement | null>(null)
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

  const { closedProjectIds, collapsedProjectIds } = railUiState

  const updateControl = getUpdateControl(updateStatus, applyUpdate.isPending)
  const isNewChatActive = pathname === "/" && new URLSearchParams(search).get("compose") === "1"
  const railPrimaryTextClass = "text-foreground"
  const railMutedTextClass = "text-muted"
  const railNavRowClass = "text-muted hover:bg-surface-tertiary"
  const railActiveNavClass = "bg-surface-tertiary text-foreground"
  const railProjectRowClass =
    "pr-10 text-muted group-hover:bg-surface-tertiary hover:bg-surface-tertiary"
  const railSessionRowClass = "text-muted hover:bg-surface-tertiary"
  const railMutedRowHoverClass = "text-muted hover:bg-surface-tertiary"
  const railRootClass = "bg-background text-foreground"

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
      brandClassName: railPrimaryTextClass,
      brandIconClassName: railPrimaryTextClass,
      brandLabelClassName: railPrimaryTextClass,
    },
    {
      key: "new-chat",
      kind: "row",
      props: {
        asDivInteractive: true,
        icon: <QuillWrite02Icon className="size-4" />,
        hoverable: true,
        label: t("nav.newChat"),
        onClick: () => {
          onNavigate?.()
          navigate("/?compose=1")
        },
        className: isNewChatActive
          ? cn(railNavRowClass, railActiveNavClass)
          : railNavRowClass,
      },
    },
    {
      key: "settings",
      kind: "row",
      props: {
        icon: <Settings className="size-4" />,
        hoverable: true,
        label: t("nav.settings"),
        onClick: onNavigate,
        to: "/settings",
        className: railNavRowClass,
        activeClassName: railActiveNavClass,
        nav: true,
      },
    },
    {
      key: "section-divider",
      kind: "divider",
      className: "mx-2",
    },
  ]

  return (
    <div
      className={cn(
        "flex h-full flex-col text-base",
        railRootClass
      )}
      data-testid="session-rail"
    >
      <div className="relative min-h-0 flex-1">
        <SimplebarScrollArea
          scrollableNodeRef={railScrollRef}
          className="h-full"
          contentClassName="px-2 py-1.5 font-medium"
        >
          <ul
            data-rail-list="true"
            className="flex min-h-full flex-col gap-0.5"
          >
            {configuredRailItems.map(renderConfiguredRailItem)}

            {isLoading ? (
              <li>
                <RailRow
                  icon={null}
                  label={t("nav.loadingThreads")}
                  labelClassName={railMutedTextClass}
                />
              </li>
            ) : null}

            {isError ? (
              <li>
                <RailRow
                  icon={null}
                  label={t("nav.sessionDataPending")}
                  labelClassName={railMutedTextClass}
                />
              </li>
            ) : null}

            {!isLoading && !isError && groupedSessions.length === 0 ? (
              <li>
                <RailRow
                  icon={null}
                  label={t("nav.noThreads")}
                  labelClassName={railMutedTextClass}
                />
              </li>
            ) : null}

            {groupedSessions.map((group) => {
              const groupKey = group.projectId || group.projectName
              const folderClosed = closedProjectIds[groupKey] ?? false
              const sessionsCollapsed = collapsedProjectIds[groupKey] ?? false
              const visibleSessions = sessionsCollapsed
                ? group.sessions.slice(0, 5)
                : group.sessions

              return (
                <Fragment key={groupKey}>
                  <li>
                    <RailRow
                      icon={
                        folderClosed ? (
                          <Folder className="size-4" />
                        ) : (
                          <FolderOpen className="size-4" />
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
                            [groupKey]: !current.closedProjectIds[groupKey],
                          },
                        }))
                      }
                      labelClassName={cn(
                        "whitespace-nowrap tracking-tight",
                        railMutedTextClass
                      )}
                      className={railProjectRowClass}
                      ariaExpanded={!folderClosed}
                    />
                  </li>
                  {folderClosed
                    ? null
                    : visibleSessions.map((session) => {
                        const sessionRunning = isSessionRunning(session.status)
                        const showUnreadDot = shouldShowSessionUnreadDot(
                          session.status,
                          unreadSessionIds.has(session.id)
                        )

                        return (
                          <li key={session.id}>
                            <RailRow
                              icon={
                                sessionRunning ? (
                                  <LoaderCircle
                                    className={cn(
                                      "size-4 animate-spin",
                                      railMutedTextClass
                                    )}
                                  />
                                ) : showUnreadDot ? (
                                  <span className="size-1.5 rounded-full bg-sky-400/75" />
                            ) : null
                          }
                          label={session.title || t("rail.untitledThread")}
                          hoverable={true}
                          onClick={onNavigate}
                          to={`/sessions/${session.id}`}
                          labelClassName="truncate"
                          className={railSessionRowClass}
                          activeClassName={railActiveNavClass}
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
                        labelClassName={railMutedTextClass}
                        className={railMutedRowHoverClass}
                      />
                    </li>
                  ) : null}
                </Fragment>
              )
            })}
          </ul>
        </SimplebarScrollArea>
      </div>
      <Modal isOpen={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <Modal.Backdrop variant="opaque">
          <Modal.Container size="cover">
            <Modal.Dialog className="relative grid w-full max-w-[calc(100%-2rem)] gap-6 rounded-3xl bg-overlay p-6 text-sm text-overlay-foreground ring-1 ring-foreground/5 outline-none sm:max-w-md">
              <Modal.Header className="flex flex-col gap-2">
                <Modal.Heading className="font-heading text-base leading-none font-medium">
                  {t("rail.upgradeDialogTitle")}
                </Modal.Heading>
                <Description className={cn("text-sm", railMutedTextClass)}>
                  {t("rail.upgradeDialogDescription", { name: "hopter" })}
                </Description>
              </Modal.Header>
              <Modal.CloseTrigger
                aria-label="Close"
                className={cn(
                  "absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg transition hover:bg-surface-tertiary",
                  railMutedTextClass,
                  "hover:text-foreground"
                )}
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
