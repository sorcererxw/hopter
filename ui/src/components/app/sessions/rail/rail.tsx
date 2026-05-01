import {
  Fragment,
  useCallback,
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
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button, Description, Modal, ScrollShadow } from "@heroui/react"

import {
  hiddenScrollbarClassName,
  workspaceScrollbarClassName,
} from "@/components/app/shared"
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

import { RailRow } from "./row"

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

// SessionRail is the left-hand navigation owner: session polling, grouping, UI
// persistence, and the host update affordance all live here.
export function SessionRail({ onNavigate }: SessionRailProps) {
  const { t } = useTranslation()
  const { eventStreamState } = useWorkspaceShell()
  const navigate = useNavigate()
  const unreadSessionIds = useUnreadSessionIds()
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
  const [railScrolling, setRailScrolling] = useState(false)
  const railScrollIdleTimerRef = useRef<number | null>(null)
  const applyUpdate = useApplyUpdate()
  const { data: updateStatus } = useHostUpdates(
    reloadTargetVersion
      ? 1_000
      : eventStreamState === "connected"
        ? 30_000
        : 10_000
  )

  const recentSessions = useMemo(
    () =>
      [...(sessions ?? [])]
        .sort((left, right) => {
          const leftDate = timestampToDate(left.updatedAt)
          const rightDate = timestampToDate(right.updatedAt)
          return sessionWeight(rightDate) - sessionWeight(leftDate)
        })
        .slice(0, 30),
    [sessions]
  )

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

  useEffect(() => {
    return () => {
      if (railScrollIdleTimerRef.current !== null) {
        window.clearTimeout(railScrollIdleTimerRef.current)
      }
    }
  }, [])

  const handleRailScroll = useCallback(() => {
    setRailScrolling(true)

    if (railScrollIdleTimerRef.current !== null) {
      window.clearTimeout(railScrollIdleTimerRef.current)
    }

    railScrollIdleTimerRef.current = window.setTimeout(() => {
      setRailScrolling(false)
      railScrollIdleTimerRef.current = null
    }, 700)
  }, [])

  const { closedProjectIds, collapsedProjectIds } = railUiState

  const updateControl = getUpdateControl(updateStatus, applyUpdate.isPending)
  const railMutedTextClass = "text-muted"
  const railNavRowClass = "text-muted hover:bg-background-tertiary"
  const railActiveNavClass = "bg-background-tertiary text-foreground"
  const railActionCardClass =
    "border border-border bg-surface py-2.5 text-foreground shadow-sm shadow-black/5 hover:bg-background-tertiary"
  const railDirectoryRowClass =
    "pr-10 text-muted group-hover:bg-background-tertiary hover:bg-background-tertiary"
  const railSessionRowClass = "text-muted hover:bg-background-tertiary"
  const railMutedRowHoverClass = "text-muted hover:bg-background-tertiary"
  const railRootClass = "bg-background-secondary text-foreground"

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

  const updateDialog = (
    <Modal isOpen={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
      <Modal.Backdrop variant="opaque">
        <Modal.Container size="cover">
          <Modal.Dialog className="relative grid w-full max-w-[calc(100%-2rem)] gap-6 rounded-3xl bg-surface p-6 text-sm text-foreground ring-1 ring-border/60 outline-none sm:max-w-md">
            <Modal.Header className="flex flex-col gap-2">
              <Modal.Heading className="text-base leading-none font-medium">
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
            <div className="rounded-xl border border-border bg-background p-3 font-mono text-xs text-foreground">
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
  )

  const newSessionRow = (
    <RailRow
      asDivInteractive
      icon={<QuillWrite02Icon className="size-4" />}
      label={t("nav.newSession")}
      onClick={() => {
        onNavigate?.()
        navigate("/?compose=1")
      }}
      className={railActionCardClass}
    />
  )

  const updateAction = updateControl.visible ? (
    <UpdateRailAction
      commandHint={updateStatus?.upgradeCommandHint ?? ""}
      onApply={handleApplyUpdate}
      onOpenDialog={() => setUpdateDialogOpen(true)}
      status={updateStatus}
    />
  ) : null

  const settingsRow = (
    <RailRow
      icon={<Settings className="size-4" />}
      hoverable
      label={t("nav.settings")}
      onClick={onNavigate}
      to="/settings"
      className={railNavRowClass}
      activeClassName={railActiveNavClass}
      right={updateAction}
      rightClassName="opacity-100"
      nav
    />
  )

  return (
    <div
      className={cn("flex h-full flex-col text-base", railRootClass)}
      data-testid="session-rail"
    >
      <div className="shrink-0 px-2 pt-2 font-medium">
        <ul className="flex flex-col gap-2">
          <li>{newSessionRow}</li>
        </ul>
      </div>

      <div className="relative min-h-0 flex-1">
        <ScrollShadow
          onScroll={handleRailScroll}
          className={cn(
            "h-full px-2 py-3 font-medium",
            railScrolling
              ? workspaceScrollbarClassName
              : hiddenScrollbarClassName
          )}
          orientation="vertical"
          size={32}
        >
          <ul
            data-rail-list="true"
            className="flex min-h-full flex-col gap-0.5"
          >
            {isLoading ? (
              <li>
                <RailRow
                  icon={null}
                  label={t("nav.loadingSessions")}
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

            {!isLoading && !isError && recentSessions.length === 0 ? (
              <li>
                <RailRow
                  icon={null}
                  label={t("nav.noSessions")}
                  labelClassName={railMutedTextClass}
                />
              </li>
            ) : null}

            {!isLoading && !isError && recentSessions.length > 0 ? (
              <RecentSessionsDirectory
                closed={closedProjectIds.recentSessions ?? false}
                collapsed={collapsedProjectIds.recentSessions ?? false}
                onNavigate={onNavigate}
                onToggleClosed={() =>
                  setRailUiState((current) => ({
                    ...current,
                    closedProjectIds: {
                      ...current.closedProjectIds,
                      recentSessions: !current.closedProjectIds.recentSessions,
                    },
                  }))
                }
                onToggleCollapsed={() =>
                  setRailUiState((current) => ({
                    ...current,
                    collapsedProjectIds: {
                      ...current.collapsedProjectIds,
                      recentSessions:
                        !current.collapsedProjectIds.recentSessions,
                    },
                  }))
                }
                railActiveNavClass={railActiveNavClass}
                railDirectoryRowClass={railDirectoryRowClass}
                railMutedRowHoverClass={railMutedRowHoverClass}
                railMutedTextClass={railMutedTextClass}
                railSessionRowClass={railSessionRowClass}
                sessions={recentSessions}
                t={t}
                unreadSessionIds={unreadSessionIds}
              />
            ) : null}
          </ul>
        </ScrollShadow>
      </div>

      <div className="shrink-0 px-2 py-2 font-medium">
        <ul>
          <li>{settingsRow}</li>
        </ul>
      </div>

      {updateDialog}
    </div>
  )
}

function RecentSessionsDirectory({
  closed,
  collapsed,
  onNavigate,
  onToggleClosed,
  onToggleCollapsed,
  railActiveNavClass,
  railDirectoryRowClass,
  railMutedRowHoverClass,
  railMutedTextClass,
  railSessionRowClass,
  sessions,
  t,
  unreadSessionIds,
}: {
  closed: boolean
  collapsed: boolean
  onNavigate?: () => void
  onToggleClosed: () => void
  onToggleCollapsed: () => void
  railActiveNavClass: string
  railDirectoryRowClass: string
  railMutedRowHoverClass: string
  railMutedTextClass: string
  railSessionRowClass: string
  sessions: NonNullable<ReturnType<typeof useSessions>["data"]>
  t: ReturnType<typeof useTranslation>["t"]
  unreadSessionIds: Set<string>
}) {
  const visibleSessions = collapsed ? sessions.slice(0, 5) : sessions

  return (
    <Fragment>
      <li>
        <RailRow
          icon={
            closed ? (
              <Folder className="size-4" />
            ) : (
              <FolderOpen className="size-4" />
            )
          }
          label={t("rail.recentSessions")}
          onClick={onToggleClosed}
          labelClassName={cn("whitespace-nowrap", railMutedTextClass)}
          className={railDirectoryRowClass}
          ariaExpanded={!closed}
        />
      </li>
      <RailDisclosureItems expanded={!closed}>
        {visibleSessions.map((session) => {
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
                      className={cn("size-4 animate-spin", railMutedTextClass)}
                    />
                  ) : showUnreadDot ? (
                    <span className="size-1.5 rounded-full bg-accent" />
                  ) : null
                }
                label={
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">
                      {session.title || t("rail.untitledSession")}
                    </span>
                    <span className="truncate text-xs leading-4 text-muted/70">
                      {session.project?.name || t("rail.unassigned")}
                    </span>
                  </span>
                }
                hoverable={true}
                onClick={onNavigate}
                to={`/sessions/${session.id}`}
                labelClassName="min-w-0"
                className={railSessionRowClass}
                activeClassName={railActiveNavClass}
                nav
              />
            </li>
          )
        })}
        {sessions.length > 5 ? (
          <li>
            <RailRow
              asDivInteractive
              icon={null}
              label={collapsed ? t("rail.showMore") : t("rail.showFewer")}
              onClick={onToggleCollapsed}
              labelClassName={railMutedTextClass}
              className={railMutedRowHoverClass}
            />
          </li>
        ) : null}
      </RailDisclosureItems>
    </Fragment>
  )
}

function RailDisclosureItems({
  children,
  expanded,
}: {
  children: React.ReactNode
  expanded: boolean
}) {
  return (
    <li
      aria-hidden={!expanded}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
        expanded
          ? "grid-rows-[1fr] opacity-100"
          : "pointer-events-none grid-rows-[0fr] opacity-0"
      )}
    >
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
        {children}
      </ul>
    </li>
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
