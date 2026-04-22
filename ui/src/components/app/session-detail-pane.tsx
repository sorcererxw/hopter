import { useCallback, useState } from "react"

import { SessionComposer } from "@/components/app/session-composer"
import { CenteredTranscriptLoader } from "@/components/app/session-transcript-timeline"
import { SessionTranscriptSurface } from "@/components/app/session-transcript-surface"
import { ProjectGitActionDialog } from "@/components/app/project-git-action-dialog"
import { WorkspacePageToolbar } from "@/components/app/workspace-page-toolbar"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { useSessionTranscriptFeed } from "@/components/app/use-session-transcript-feed"
import { SessionTerminalDrawer } from "@/features/terminal/terminal-drawer"
import { useTerminalSession } from "@/features/terminal/use-terminal-session"
import { useTerminalUIState } from "@/features/terminal/use-terminal-ui-state"
import {
  useInterruptSession,
  useRespondToSessionApproval,
  useSendSessionInput,
  useSessionMeta,
} from "@/features/sessions/use-sessions"
import { ApprovalDecision } from "@/gen/proto/hopter/v1/common_pb"
import { GitCommitMode } from "@/gen/proto/hopter/v1/git_pb"
import { useProjectGitStatus } from "@/features/git/use-project-git"
import { useSessionReadTarget } from "@/lib/session-unread"

import { shouldShowThinkingState } from "./session-detail-model"

export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const { eventStreamState, posture } = useWorkspaceShell()
  const sessionMetaQuery = useSessionMeta(sessionId)
  const sendInput = useSendSessionInput()
  const interruptSession = useInterruptSession()
  const respondToApproval = useRespondToSessionApproval()
  const [prompt, setPrompt] = useState("")
  const [optimisticPendingInput, setOptimisticPendingInput] = useState("")
  const [gitDialogOpen, setGitDialogOpen] = useState(false)
  const [gitDialogMode, setGitDialogMode] = useState(GitCommitMode.COMMIT_ONLY)
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
  const projectId = sessionMetaQuery.data?.project?.id
  const projectGitStatusQuery = useProjectGitStatus(
    projectId,
    Boolean(projectId)
  )
  const terminalEnabled = posture !== "phone"
  const terminalUIState = useTerminalUIState(sessionId)
  const terminalState = useTerminalSession(sessionId, terminalEnabled)
  const shouldShowInterruptAction =
    Boolean(session) &&
    shouldShowThinkingState(session!.status) &&
    prompt.trim().length === 0 &&
    !sendInput.isPending

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ProjectGitActionDialog
        initialMode={gitDialogMode}
        onOpenChange={setGitDialogOpen}
        open={gitDialogOpen}
        projectId={projectId}
      />
      <WorkspacePageToolbar
        title={session?.title || "Thread"}
        projectName={session?.project?.name || "Local"}
        resumeCommand={sessionMetaQuery.data?.resumeCommand}
        sessionId={sessionId}
        onCommit={() => {
          setGitDialogMode(GitCommitMode.COMMIT_ONLY)
          setGitDialogOpen(true)
        }}
        onCommitAndPush={() => {
          setGitDialogMode(GitCommitMode.COMMIT_AND_PUSH)
          setGitDialogOpen(true)
        }}
        onOpenTerminal={() => {
          if (!terminalEnabled) {
            return
          }
          terminalUIState.setOpen(!terminalUIState.open)
        }}
        showCommit={Boolean(projectGitStatusQuery.data?.isGitRepository)}
        showTerminal={terminalEnabled}
        terminalButtonTestId="workspace-topbar-terminal"
        terminalActive={Boolean(
          terminalState.terminal && !terminalUIState.open
        )}
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
              onValueChange={setPrompt}
              onSubmit={async ({ model, reasoningEffort }) => {
                if (!prompt.trim()) {
                  return
                }

                const normalizedPrompt = prompt.trim()
                setPrompt("")
                setOptimisticPendingInput(normalizedPrompt)
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

            <SessionTerminalDrawer
              enabled={terminalEnabled}
              terminal={terminalState}
              uiState={terminalUIState}
            />
          </div>
        </div>
      )}
    </div>
  )
}
