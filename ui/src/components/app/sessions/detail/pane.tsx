import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { SessionComposer } from "@/components/app/sessions/composer"
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
  useRespondToSessionApproval,
  useSendSessionInput,
  useSessionMeta,
} from "@/features/sessions/use-sessions"
import { ApprovalDecision } from "@/gen/proto/hopter/v1/common_pb"
import { useSessionReadTarget } from "@/lib/session-unread"

import { shouldShowThinkingState } from "./model"

// SessionWorkspacePane composes the session header, transcript surface, and
// reply composer around a single session id.
export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const { eventStreamState } = useWorkspaceShell()
  const sessionMetaQuery = useSessionMeta(sessionId)
  const configQuery = useConfig()
  const updateConfig = useUpdateConfig()
  const sendInput = useSendSessionInput()
  const interruptSession = useInterruptSession()
  const respondToApproval = useRespondToSessionApproval()
  const [prompt, setPrompt] = useState("")
  const [optimisticPendingInput, setOptimisticPendingInput] = useState("")
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
    shouldShowThinkingState(session!.status) &&
    prompt.trim().length === 0 &&
    !sendInput.isPending

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspacePageToolbar
        title={session?.title || t("session.thread")}
        projectName={session?.project?.name || t("home.localProject")}
        resumeCommand={sessionMetaQuery.data?.resumeCommand}
        sessionId={sessionId}
      />

      {sessionMetaQuery.isLoading ? (
        <CenteredTranscriptLoader />
      ) : sessionMetaQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-lg border border-border bg-surface-tertiary px-6 py-4 text-foreground">
            {t("session.unavailable")}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
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
              onScrollToBottom={transcriptFeed.scrollTranscriptToBottom}
              onTranscriptScroll={transcriptFeed.handleTranscriptScroll}
              respondingToApproval={respondToApproval.isPending}
              scrollbarScrollable={transcriptFeed.scrollbarScrollable}
              scrollbarVisible={transcriptFeed.scrollbarVisible}
              session={session}
              sessionId={sessionId}
              thumbHeight={transcriptFeed.thumbHeight}
              thumbOffset={transcriptFeed.thumbOffset}
              transcriptAwayFromBottom={transcriptFeed.transcriptAwayFromBottom}
              transcriptContentRef={transcriptFeed.transcriptContentRef}
              transcriptScrollRef={transcriptFeed.transcriptScrollRef}
              transcriptVisible={transcriptFeed.transcriptVisible}
            />

            <SessionComposer
              busy={sendInput.isPending || interruptSession.isPending}
              composerTestId="session-composer"
              contextWindowUsage={sessionMetaQuery.data?.contextWindowUsage}
              initialSelection={initialComposerSelection}
              interruptMode={shouldShowInterruptAction}
              interruptTestId="session-interrupt-submit"
              inputTestId="session-prompt-input"
              onInterrupt={async () => {
                await interruptSession.mutateAsync({ sessionId })
              }}
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
              }) => {
                if (!input.trim() && attachments.length === 0) {
                  return
                }

                const normalizedPrompt = input.trim()
                const pendingInput =
                  normalizedPrompt || attachments[0]?.label || "[image]"
                // Clear the input optimistically so the UI behaves like chat,
                // but keep enough local state to restore on submission failure.
                setPrompt("")
                setOptimisticPendingInput(pendingInput)
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
                  await sendInput.mutateAsync({
                    attachments,
                    codexFastMode,
                    input: normalizedPrompt,
                    model,
                    reasoningEffort,
                    sessionId,
                  })
                } catch (error) {
                  setOptimisticPendingInput("")
                  setPrompt(rawInput)
                  throw error
                }
              }}
              submitTestId="session-followup-submit"
              value={prompt}
            />
          </div>
        </div>
      )}
    </div>
  )
}
