import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowLeft,
  ChevronDown,
  MoreHorizontal,
  SidebarLeftIcon,
  PanelRight,
  Terminal,
} from "@/components/icons/hugeicons"
import { toast } from "sonner"
import { Button } from "@heroui/react"

import { cn } from "@/lib/utils"

import type { WorkspaceToolbarMode } from "./posture"

export type WorkspaceTopbarProps = {
  leadingAction?: "back" | "toggle-rail"
  inspectorOpen?: boolean
  onCommit?: () => void
  onCommitAndPush?: () => void
  onLeadingAction?: () => void
  onOpenReview?: () => void
  onOpenTerminal?: () => void
  onToggleInspector?: () => void
  projectName?: string
  resumeCommand?: string
  sessionId?: string
  showInspectorToggle?: boolean
  showCommit?: boolean
  showReview?: boolean
  showOverflowMenu?: boolean
  showTerminal?: boolean
  terminalButtonTestId?: string
  terminalActive?: boolean
  title: string
  toolbarMode?: WorkspaceToolbarMode
}

export function WorkspaceTopbar({
  leadingAction,
  inspectorOpen = false,
  onCommit,
  onCommitAndPush,
  onLeadingAction,
  onOpenReview,
  onOpenTerminal,
  onToggleInspector,
  projectName,
  resumeCommand,
  showInspectorToggle = false,
  showCommit = false,
  showOverflowMenu = true,
  showReview = false,
  showTerminal = false,
  terminalButtonTestId,
  terminalActive = false,
  title,
  toolbarMode = "desktop",
}: WorkspaceTopbarProps) {
  const { t } = useTranslation()
  const [commitOpen, setCommitOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [copiedItem, setCopiedItem] = useState<
    "resume-command" | null
  >(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!overflowOpen && !commitOpen) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverflowOpen(false)
        setCommitOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [overflowOpen, commitOpen])

  const handleCopy = useCallback(
    async (text: string, item: "resume-command") => {
      if (!text) {
        return
      }

      setOverflowOpen(false)
      const copied = await writeClipboardText(text)
      if (!copied) {
        toast.error(t("topbar.copyFailed"))
        return
      }

      setCopiedItem(item)
      toast.success(t("topbar.codexCommandCopied"))
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
      }
      copiedTimerRef.current = setTimeout(() => setCopiedItem(null), 1500)
    },
    [t]
  )
  const sidebarLabel = inspectorOpen
    ? t("topbar.closeSidebar")
    : t("topbar.openSidebar")

  const leadingButton =
    leadingAction === "back" ? (
      <TopbarLeadingButton
        icon={<ArrowLeft className="size-4" />}
        label={t("nav.back")}
        onClick={onLeadingAction}
        testId="workspace-topbar-back"
      />
    ) : leadingAction === "toggle-rail" ? (
      <TopbarLeadingButton
        icon={<SidebarLeftIcon className="size-4" />}
        label={t("nav.toggleNavigation")}
        onClick={onLeadingAction}
        testId="workspace-topbar-rail-toggle"
      />
    ) : null

  return (
    <div
      className="flex items-center justify-between gap-3 bg-background px-4 py-1.5 font-medium text-foreground"
      data-testid="workspace-topbar"
      data-toolbar-mode={toolbarMode}
    >
      {toolbarMode === "mobile" ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {leadingButton}
            <div className="min-w-0">
              <p className="truncate text-base text-foreground">{title}</p>
              {projectName ? (
                <p className="truncate text-muted">{projectName}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {showOverflowMenu ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOverflowOpen((prev) => !prev)}
                  className="flex size-9 items-center justify-center rounded-lg text-foreground transition hover:bg-surface-tertiary"
                >
                  <MoreHorizontal className="size-4.5" />
                </button>
                {overflowOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40"
                      onClick={() => setOverflowOpen(false)}
                    />
                    <div className="absolute top-full right-0 z-50 mt-1 w-52 rounded-lg border border-border bg-overlay py-1 shadow-lg">
                      {showCommit || showReview ? (
                        <>
                          {showCommit ? (
                            <OverflowMenuItem
                              onClick={() => {
                                setOverflowOpen(false)
                                onCommit?.()
                              }}
                            >
                              {t("topbar.commitAll")}
                            </OverflowMenuItem>
                          ) : null}
                          <OverflowMenuItem
                            onClick={() => {
                              setOverflowOpen(false)
                              onOpenReview?.()
                            }}
                          >
                            {t("topbar.review")}
                          </OverflowMenuItem>
                          {showCommit ? (
                            <OverflowMenuItem
                              onClick={() => {
                                setOverflowOpen(false)
                                onCommitAndPush?.()
                              }}
                            >
                              {t("topbar.commitAllPush")}
                            </OverflowMenuItem>
                          ) : null}
                          {showTerminal ? (
                            <OverflowMenuItem
                              icon={<Terminal className="size-3.5" />}
                              onClick={() => {
                                setOverflowOpen(false)
                                onOpenTerminal?.()
                              }}
                            >
                              {t("topbar.terminal")}
                            </OverflowMenuItem>
                          ) : null}
                        </>
                      ) : null}
                      {showInspectorToggle ? (
                        <OverflowMenuItem
                          icon={<PanelRight className="size-3.5" />}
                          onClick={() => {
                            setOverflowOpen(false)
                            onToggleInspector?.()
                          }}
                        >
                          {sidebarLabel}
                        </OverflowMenuItem>
                      ) : null}
                      {resumeCommand ? (
                        <OverflowMenuItem
                          icon={<Terminal className="size-3.5" />}
                          onClick={() =>
                            handleCopy(resumeCommand, "resume-command")
                          }
                        >
                          {copiedItem === "resume-command"
                            ? t("topbar.codexCommandCopied")
                            : t("topbar.resumeInCodex")}
                        </OverflowMenuItem>
                      ) : null}

                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {leadingButton}
            <h1 className="truncate text-base text-foreground">{title}</h1>
            {projectName ? (
              <span className="truncate text-muted">{projectName}</span>
            ) : null}
            {showOverflowMenu ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOverflowOpen((prev) => !prev)}
                  className="flex size-6 items-center justify-center rounded text-muted transition hover:bg-surface-tertiary hover:text-foreground"
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {overflowOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40"
                      onClick={() => setOverflowOpen(false)}
                    />
                    <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-lg border border-border bg-overlay py-1 shadow-lg">
                      {resumeCommand ? (
                        <OverflowMenuItem
                          icon={<Terminal className="size-3.5" />}
                          onClick={() =>
                            handleCopy(resumeCommand, "resume-command")
                          }
                        >
                          {copiedItem === "resume-command"
                            ? t("topbar.codexCommandCopied")
                            : t("topbar.resumeInCodex")}
                        </OverflowMenuItem>
                      ) : null}

                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {showCommit ? (
              <div className="relative">
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => setCommitOpen((prev) => !prev)}
                  className="gap-1.5 text-foreground"
                >
                  <span>{t("topbar.commit")}</span>
                  <ChevronDown className="size-3 text-muted" />
                </Button>
                {commitOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40"
                      onClick={() => setCommitOpen(false)}
                    />
                    <div className="absolute top-full right-0 z-50 mt-1 w-44 rounded-lg border border-border bg-overlay py-1 shadow-lg">
                      <CommitMenuItem
                        onClick={() => {
                          setCommitOpen(false)
                          onCommit?.()
                        }}
                      >
                        {t("topbar.commitAll")}
                      </CommitMenuItem>
                      <CommitMenuItem
                        onClick={() => {
                          setCommitOpen(false)
                          onCommitAndPush?.()
                        }}
                      >
                        {t("topbar.commitAllPush")}
                      </CommitMenuItem>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {showReview ? (
              <Button
                type="button"
                variant={showCommit ? "ghost" : "secondary"}
                onPress={onOpenReview}
                className={cn(showCommit ? "text-muted" : "text-foreground")}
              >
                {t("topbar.review")}
              </Button>
            ) : null}

            {showTerminal ? (
              <TopbarIconButton
                active={terminalActive}
                label={t("topbar.terminal")}
                onClick={onOpenTerminal}
                testId={terminalButtonTestId}
              >
                <Terminal className="size-3.5" />
              </TopbarIconButton>
            ) : null}

            {showInspectorToggle ? (
              <Button
                type="button"
                variant={inspectorOpen ? "secondary" : "ghost"}
                isIconOnly
                onPress={onToggleInspector}
                aria-label={sidebarLabel}
                className={cn(inspectorOpen ? "text-foreground" : "text-muted")}
              >
                <PanelRight className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

async function writeClipboardText(text: string) {
  if (!navigator.clipboard?.writeText) {
    return copyTextWithSelectionFallback(text)
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyTextWithSelectionFallback(text)
  }
}

function copyTextWithSelectionFallback(text: string) {
  const textArea = document.createElement("textarea")
  const activeElement = document.activeElement

  textArea.value = text
  textArea.setAttribute("readonly", "")
  textArea.style.position = "fixed"
  textArea.style.top = "0"
  textArea.style.left = "0"
  textArea.style.opacity = "0"

  document.body.appendChild(textArea)
  textArea.select()
  textArea.setSelectionRange(0, text.length)

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textArea)
    if (activeElement instanceof HTMLElement) {
      activeElement.focus()
    }
  }
}

function TopbarLeadingButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  testId: string
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      data-testid={testId}
      onPress={onClick}
      variant="ghost"
      size="sm"
      isIconOnly
      className="text-foreground"
    >
      {icon}
    </Button>
  )
}

function OverflowMenuItem({
  children,
  icon,
  onClick,
}: {
  children: ReactNode
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onPress={onClick}
      variant="ghost"
      className="flex h-auto w-full items-center justify-start gap-2.5 rounded-none px-3 py-2.5 text-foreground"
    >
      {icon ?? <span className="size-3.5" />}
      <span>{children}</span>
    </Button>
  )
}

function CommitMenuItem({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onPress={onClick}
      variant="ghost"
      className="flex h-auto w-full items-center justify-start rounded-none px-3 py-2 text-foreground"
    >
      {children}
    </Button>
  )
}

function TopbarIconButton({
  active = false,
  children,
  label,
  onClick,
  testId,
}: {
  active?: boolean
  children: ReactNode
  label: string
  onClick?: () => void
  testId?: string
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      data-testid={testId}
      onPress={onClick}
      variant={active ? "secondary" : "ghost"}
      isIconOnly
      className={cn(active ? "text-foreground" : "text-muted")}
    >
      {children}
    </Button>
  )
}
