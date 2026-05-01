import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Circle, ListChecks, X } from "@/components/icons/hugeicons"

import { SessionComposer } from "@/components/app/sessions/composer"
import type { SessionComposerSubmissionMode } from "@/components/app/sessions/composer"
import {
  getSessionComposerSelection,
  rememberSessionComposerSelection,
  resolveSessionComposerSelection,
} from "@/components/app/sessions/composer"
import { CenteredTranscriptLoader } from "@/components/app/sessions/transcript"
import { SessionTranscriptSurface } from "@/components/app/sessions/transcript"
import { WorkspacePageToolbar } from "@/components/app/workspace"
import { useWorkspaceShell } from "@/components/app/workspace"
import {
  agentSelectionPreferenceFromConfig,
  buildAgentSelectionConfigPatch,
  useConfig,
  useUpdateConfig,
} from "@/features/config/use-config"
import { useSessionTranscriptFeed } from "@/components/app/sessions/transcript"
import {
  useInterruptSession,
  useRollbackSessionInput,
  useRespondToSessionApproval,
  useSendSessionInput,
  useSessionMeta,
  useSessionQueue,
} from "@/features/sessions/use-sessions"
import { ApprovalDecision } from "@/gen/proto/hopter/v1/common_pb"
import type {
  SessionQueueItem,
  SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"
import { timestampToDate } from "@/lib/format/proto"
import { useLocale } from "@/lib/i18n/provider"
import { useSessionReadTarget } from "@/lib/session-unread"

import { shouldShowThinkingState } from "./model"

// SessionWorkspacePane composes the session header, transcript surface, and
// reply composer around a single session id.
export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const { resolvedLocale } = useLocale()
  const { eventStreamState } = useWorkspaceShell()
  const sessionMetaQuery = useSessionMeta(sessionId)
  const sessionQueueQuery = useSessionQueue(sessionId)
  const configQuery = useConfig()
  const updateConfig = useUpdateConfig()
  const sendInput = useSendSessionInput()
  const rollbackInput = useRollbackSessionInput()
  const interruptSession = useInterruptSession()
  const respondToApproval = useRespondToSessionApproval()
  const [prompt, setPrompt] = useState("")
  const [editingMessage, setEditingMessage] = useState<{
    id: string
    orderKey: string
    text: string
  } | null>(null)
  const [optimisticPendingInput, setOptimisticPendingInput] = useState("")
  const [submissionMode, setSubmissionMode] =
    useState<SessionComposerSubmissionMode>("guide")
  const clearOptimisticPendingInput = useCallback(() => {
    setOptimisticPendingInput("")
  }, [])
  const transcriptFeed = useSessionTranscriptFeed({
    eventStreamState,
    optimisticPendingInput,
    onOptimisticPendingInputSettled: clearOptimisticPendingInput,
    sessionId,
    sessionMeta: sessionMetaQuery.data,
  })
  useSessionReadTarget(
    sessionId,
    transcriptFeed.transcriptVisible && !transcriptFeed.transcriptAwayFromBottom
  )
  const { session } = transcriptFeed
  const initialComposerSelection = useMemo(
    () =>
      // Composer defaults come from three layers: last explicit choice for this
      // session, session-level server preference, then global config defaults.
      resolveSessionComposerSelection(
        getSessionComposerSelection(sessionId),
        sessionMetaQuery.data
          ? {
              codexFastMode: sessionMetaQuery.data.preferredCodexFastMode,
              model: sessionMetaQuery.data.preferredModel,
              reasoningEffort: sessionMetaQuery.data.preferredReasoningEffort,
            }
          : undefined,
        agentSelectionPreferenceFromConfig(configQuery.data)
      ),
    [configQuery.data, sessionId, sessionMetaQuery.data]
  )
  const shouldShowInterruptAction =
    Boolean(session) &&
    !editingMessage &&
    shouldShowThinkingState(session!.status) &&
    prompt.trim().length === 0 &&
    !sendInput.isPending
  const shouldShowSubmissionMode =
    Boolean(session) &&
    !editingMessage &&
    shouldShowThinkingState(session!.status) &&
    prompt.trim().length > 0

  useEffect(() => {
    if (!shouldShowSubmissionMode && submissionMode !== "guide") {
      setSubmissionMode("guide")
    }
  }, [shouldShowSubmissionMode, submissionMode])

  useEffect(() => {
    setEditingMessage(null)
  }, [sessionId])

  const handleEditUserMessage = useCallback((item: SessionTranscriptItem) => {
    const text = item.displayBody.trim() || item.body.trim()
    setEditingMessage({
      id: item.id,
      orderKey: item.orderKey,
      text,
    })
    setPrompt(text)
    setSubmissionMode("guide")
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <WorkspacePageToolbar
        title={session?.title || t("session.fallbackTitle")}
        projectName={session?.project?.name || t("home.localProject")}
        resumeCommand={sessionMetaQuery.data?.resumeCommand}
        sessionId={sessionId}
      />

      {sessionMetaQuery.isLoading ? (
        <CenteredTranscriptLoader />
      ) : sessionMetaQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-2xl border border-border bg-surface px-6 py-4 text-foreground shadow-sm">
            {t("session.unavailable")}
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <SessionTranscriptSurface
              activityItems={transcriptFeed.activityItems}
              eventStreamState={eventStreamState}
              hasUnloadedTranscriptHistory={
                transcriptFeed.hasUnloadedTranscriptHistory
              }
              isFetchingPreviousPage={transcriptFeed.isFetchingPreviousPage}
              isLoadingInitialTranscript={
                transcriptFeed.isLoadingInitialTranscript
              }
              onApprove={() => {
                if (!session.pendingApprovalId) {
                  return
                }
                void respondToApproval.mutateAsync({
                  sessionId,
                  approvalId: session.pendingApprovalId,
                  decision: ApprovalDecision.APPROVE,
                })
              }}
              onReject={() => {
                if (!session.pendingApprovalId) {
                  return
                }
                void respondToApproval.mutateAsync({
                  sessionId,
                  approvalId: session.pendingApprovalId,
                  decision: ApprovalDecision.REJECT,
                })
              }}
              onEditUserMessage={handleEditUserMessage}
              onScrollToBottom={transcriptFeed.scrollTranscriptToBottom}
              onTranscriptScroll={transcriptFeed.handleTranscriptScroll}
              respondingToApproval={respondToApproval.isPending}
              session={session}
              sessionId={sessionId}
              transcriptAwayFromBottom={transcriptFeed.transcriptAwayFromBottom}
              transcriptContentRef={transcriptFeed.transcriptContentRef}
              transcriptScrollRef={transcriptFeed.transcriptScrollRef}
              transcriptVisible={transcriptFeed.transcriptVisible}
              stickyFooter={
                <SessionComposer
                  busy={
                    sendInput.isPending ||
                    rollbackInput.isPending ||
                    interruptSession.isPending
                  }
                  composerTestId="session-composer"
                  contextWindowUsage={sessionMetaQuery.data?.contextWindowUsage}
                  initialSelection={initialComposerSelection}
                  interruptMode={shouldShowInterruptAction}
                  interruptTestId="session-interrupt-submit"
                  inputTestId="session-prompt-input"
                  onInterrupt={async () => {
                    await interruptSession.mutateAsync({ sessionId })
                  }}
                  onSubmissionModeChange={setSubmissionMode}
                  placement="inline"
                  placeholder={t("session.askAnything")}
                  projectLabel={session.project?.name || t("home.localProject")}
                  branchLabel="main"
                  settingsLabel="Custom (config.toml)"
                  selectionKey={sessionId}
                  onSelectionChange={(selection) => {
                    rememberSessionComposerSelection(sessionId, selection)
                    const currentFastMode =
                      configQuery.data?.agent?.defaultCodexFastMode ?? false
                    if (selection.codexFastMode === currentFastMode) {
                      return
                    }
                    updateConfig.mutate({
                      agent: buildAgentSelectionConfigPatch(configQuery.data, {
                        codexFastMode: selection.codexFastMode,
                      }),
                      expectedRevision: configQuery.data?.revision ?? 0n,
                    })
                  }}
                  onValueChange={setPrompt}
                  onSubmit={async ({
                    attachments,
                    codexFastMode,
                    input,
                    model,
                    rawInput,
                    reasoningEffort,
                    submissionMode,
                  }) => {
                    if (!input.trim() && attachments.length === 0) {
                      return
                    }

                    const normalizedPrompt = input.trim()
                    const pendingInput =
                      normalizedPrompt || attachments[0]?.label || "[image]"
                    const nextSubmissionMode = shouldShowSubmissionMode
                      ? submissionMode
                      : "guide"
                    // Clear the input optimistically so the session feels live,
                    // but keep enough local state to restore on submission failure.
                    setPrompt("")
                    if (nextSubmissionMode === "guide") {
                      setOptimisticPendingInput(pendingInput)
                    }
                    rememberSessionComposerSelection(sessionId, {
                      codexFastMode,
                      model,
                      reasoningEffort,
                    })
                    updateConfig.mutate({
                      agent: buildAgentSelectionConfigPatch(configQuery.data, {
                        codexFastMode,
                        model,
                        reasoningEffort,
                      }),
                      expectedRevision: configQuery.data?.revision ?? 0n,
                    })
                    try {
                      if (nextSubmissionMode === "queue") {
                        await sendInput.mutateAsync({
                          attachments,
                          codexFastMode,
                          input: normalizedPrompt,
                          mode: "queue",
                          model,
                          reasoningEffort,
                          sessionId,
                        })
                      } else if (editingMessage) {
                        await rollbackInput.mutateAsync({
                          attachments,
                          codexFastMode,
                          input: normalizedPrompt,
                          model,
                          orderKey: editingMessage.orderKey,
                          reasoningEffort,
                          sessionId,
                          transcriptItemId: editingMessage.id,
                        })
                        setEditingMessage(null)
                      } else {
                        await sendInput.mutateAsync({
                          attachments,
                          codexFastMode,
                          input: normalizedPrompt,
                          model,
                          reasoningEffort,
                          sessionId,
                        })
                      }
                    } catch (error) {
                      setOptimisticPendingInput("")
                      setPrompt(rawInput)
                      throw error
                    }
                  }}
                  showSubmissionMode={shouldShowSubmissionMode}
                  submissionMode={submissionMode}
                  submitTestId="session-followup-submit"
                  topContent={
                    <>
                      {editingMessage ? (
                        <SessionEditingMessageBanner
                          onCancel={() => {
                            setEditingMessage(null)
                            setPrompt("")
                          }}
                          t={t}
                        />
                      ) : null}
                      <SessionTaskQueue
                        isError={sessionQueueQuery.isError}
                        isLoading={sessionQueueQuery.isLoading}
                        items={sessionQueueQuery.data ?? []}
                        locale={resolvedLocale}
                        t={t}
                      />
                    </>
                  }
                  value={prompt}
                />
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SessionTaskQueue({
  isError,
  isLoading,
  items,
  locale,
  t,
}: {
  isError: boolean
  isLoading: boolean
  items: SessionQueueItem[]
  locale: string
  t: ReturnType<typeof useTranslation>["t"]
}) {
  const visibleItems = items.slice(0, 4)
  if (!isLoading && !isError && items.length === 0) {
    return null
  }

  return (
    <section
      aria-label={t("session.taskQueue")}
      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="size-4 shrink-0 text-muted" />
          <span className="truncate">{t("session.taskQueue")}</span>
          <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-xs text-muted">
            {items.length}
          </span>
        </div>
        {isLoading ? (
          <span className="shrink-0 text-xs text-muted">
            {t("tasks.loading")}
          </span>
        ) : null}
      </div>

      {isError ? (
        <p className="mt-2 text-xs text-muted">
          {t("session.taskQueueUnavailable")}
        </p>
      ) : (
        <div className="mt-2 space-y-1">
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-2 rounded-md bg-surface-tertiary/70 px-2 py-1"
            >
              <Circle className="size-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-xs">
                {item.preview || t("session.taskQueueUntitled")}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {t("session.taskQueueWaiting", { position: item.position })}
              </span>
              <span className="hidden shrink-0 text-xs text-muted sm:inline">
                {formatUpdatedAt(item.createdAt, locale)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function SessionEditingMessageBanner({
  onCancel,
  t,
}: {
  onCancel: () => void
  t: ReturnType<typeof useTranslation>["t"]
}) {
  return (
    <section
      aria-label={t("session.editingMessage")}
      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate">{t("session.editingMessage")}</span>
        <button
          type="button"
          aria-label={t("session.cancelEditingMessage")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-tertiary hover:text-foreground"
          onClick={onCancel}
        >
          <X className="size-4" />
        </button>
      </div>
    </section>
  )
}

function formatUpdatedAt(value: SessionQueueItem["createdAt"], locale: string) {
  const date = timestampToDate(value)
  if (!date) {
    return ""
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}
