import { useCallback, useState } from "react"

import { SessionComposer } from "@/components/app/session-composer"
import {
  getSessionComposerSelection,
  rememberSessionComposerSelection,
} from "@/components/app/session-composer-selection"
import { CenteredTranscriptLoader } from "@/components/app/session-transcript-timeline"
import { SessionTranscriptSurface } from "@/components/app/session-transcript-surface"
import { WorkspacePageToolbar } from "@/components/app/workspace-page-toolbar"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { useSessionTranscriptFeed } from "@/components/app/use-session-transcript-feed"
import {
  useInterruptSession,
  useRespondToSessionApproval,
  useSendSessionInput,
  useSessionMeta,
} from "@/features/sessions/use-sessions"
import { ApprovalDecision } from "@/gen/proto/hopter/v1/common_pb"
import { useSessionReadTarget } from "@/lib/session-unread"

import { shouldShowThinkingState } from "./session-detail-model"

export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const { eventStreamState } = useWorkspaceShell()
  const sessionMetaQuery = useSessionMeta(sessionId)
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
  const initialComposerSelection = getSessionComposerSelection(sessionId)
  const shouldShowInterruptAction =
    Boolean(session) &&
    shouldShowThinkingState(session!.status) &&
    prompt.trim().length === 0 &&
    !sendInput.isPending

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspacePageToolbar
        title={session?.title || "Thread"}
        projectName={session?.project?.name || "Local"}
        resumeCommand={sessionMetaQuery.data?.resumeCommand}
        sessionId={sessionId}
      />

      {sessionMetaQuery.isLoading ? (
        <CenteredTranscriptLoader />
      ) : sessionMetaQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-lg border border-border bg-muted px-6 py-4 text-foreground">
            This thread is temporarily unavailable.
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
              initialSelection={initialComposerSelection}
              interruptMode={shouldShowInterruptAction}
              interruptTestId="session-interrupt-submit"
              inputTestId="session-prompt-input"
              onInterrupt={async () => {
                await interruptSession.mutateAsync({ sessionId })
              }}
              placeholder="Ask anything"
              projectLabel={session.project?.name || "Local"}
              branchLabel="main"
              settingsLabel="Custom (config.toml)"
              selectionKey={sessionId}
              onSelectionChange={(selection) => {
                rememberSessionComposerSelection(sessionId, selection)
              }}
              onValueChange={setPrompt}
              onSubmit={async ({ model, reasoningEffort }) => {
                if (!prompt.trim()) {
                  return
                }

                const normalizedPrompt = prompt.trim()
                setPrompt("")
                setOptimisticPendingInput(normalizedPrompt)
                rememberSessionComposerSelection(sessionId, {
                  model,
                  reasoningEffort,
                })
                try {
                  await sendInput.mutateAsync({
                    input: normalizedPrompt,
                    model,
                    reasoningEffort,
                    sessionId,
                  })
                } catch (error) {
                  setOptimisticPendingInput("")
                  setPrompt(normalizedPrompt)
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
