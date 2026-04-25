import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { GitBranch, LoaderCircle, RotateCcw, X } from "lucide-react"
import { toast } from "sonner"
import { Button, Chip, Description, Modal } from "@heroui/react"

import {
  GitActionOutcome,
  GitCommitMode,
  GitFileStatus,
  type ProjectGitStatus,
} from "@/gen/proto/hopter/v1/git_pb"
import {
  useCommitProjectChanges,
  useProjectGitStatus,
  usePushProjectBranch,
} from "@/features/git/use-project-git"
import { cn } from "@/lib/utils"

type ProjectGitActionDialogProps = {
  initialMode: GitCommitMode
  onOpenChange: (open: boolean) => void
  open: boolean
  projectId?: string
}

// Git dialog is a guarded commit/push surface. The backend supplies a status
// token so actions only apply to the exact repo snapshot the user reviewed.
export function ProjectGitActionDialog({
  initialMode,
  onOpenChange,
  open,
  projectId,
}: ProjectGitActionDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState(initialMode)
  const [message, setMessage] = useState("")
  const statusQuery = useProjectGitStatus(projectId, open && Boolean(projectId))
  const commit = useCommitProjectChanges()
  const push = usePushProjectBranch()
  const status = statusQuery.data
  const latestResult = push.data ?? commit.data
  const latestCommitResult = commit.data
  const latestStatus = latestResult?.statusAfter ?? status
  const diagnostics = latestResult?.diagnostics ?? []
  const pending = commit.isPending || push.isPending

  const partialStaging = useMemo(
    () => status?.files.some((file) => file.partiallyStaged) ?? false,
    [status?.files]
  )
  const commitMessage = message.trim()
    ? message
    : status?.defaultCommitMessage || ""
  const canCommit = Boolean(
    status?.canCommit &&
    commitMessage.trim() &&
    !pending &&
    status.isGitRepository
  )
  const canCommitAndPush = canCommit && Boolean(status?.canPush)
  const showPushRetry =
    latestCommitResult?.outcome === GitActionOutcome.COMMITTED_PUSH_FAILED &&
    Boolean(latestCommitResult.commitSha || latestStatus?.headSha)

  async function runCommit(nextMode: GitCommitMode) {
    if (!projectId || !status || !commitMessage.trim()) {
      return
    }
    const response = await commit.mutateAsync({
      expectedStatusToken: status.statusToken,
      message: commitMessage.trim(),
      mode: nextMode,
      projectId,
    })
    // Outcome-specific toasts mirror the backend's guarded git semantics:
    // commit may succeed even when push fails, and retry then becomes explicit.
    if (response.outcome === GitActionOutcome.COMMITTED_AND_PUSHED) {
      toast.success(t("git.committedAndPushed"))
      onOpenChange(false)
    } else if (response.outcome === GitActionOutcome.COMMITTED) {
      toast.success(t("git.committed"))
      onOpenChange(false)
    } else if (response.outcome === GitActionOutcome.COMMITTED_PUSH_FAILED) {
      toast.error(t("git.committedPushFailed"))
    } else if (response.outcome === GitActionOutcome.NO_CHANGES) {
      toast.message(t("git.noChanges"))
    } else {
      toast.error(response.summary || t("git.actionIncomplete"))
    }
  }

  async function retryPush() {
    if (!projectId || !status) {
      return
    }
    const expectedHeadSha =
      latestCommitResult?.commitSha ||
      latestResult?.statusAfter?.headSha ||
      status.headSha
    const expectedStatusToken =
      latestResult?.statusAfter?.statusToken || status.statusToken
    const response = await push.mutateAsync({
      expectedHeadSha,
      expectedStatusToken,
      projectId,
    })
    if (response.outcome === GitActionOutcome.PUSHED) {
      toast.success(t("git.pushed"))
      onOpenChange(false)
    } else {
      toast.error(t("git.pushFailed"))
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop variant="opaque">
        <Modal.Container size="cover">
          <Modal.Dialog
            className="relative grid max-h-[min(720px,calc(100vh-2rem))] w-full max-w-[calc(100%-2rem)] gap-4 overflow-hidden rounded-3xl bg-overlay p-6 text-sm text-overlay-foreground ring-1 ring-foreground/5 outline-none sm:max-w-2xl"
            data-testid="project-git-action-dialog"
          >
            <Modal.Header className="flex flex-col gap-2">
              <Modal.Heading className="font-heading text-base leading-none font-medium">
                {t("git.commitRepositoryChanges")}
              </Modal.Heading>
              <Description className="text-sm text-muted">
                {t("git.description")}
              </Description>
            </Modal.Header>
            <Modal.CloseTrigger
              aria-label="Close"
              className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-tertiary hover:text-foreground"
            >
              <X className="size-4" />
            </Modal.CloseTrigger>

            {statusQuery.isLoading ? (
              <div className="flex min-h-48 items-center justify-center text-muted">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t("git.loadingStatus")}
              </div>
            ) : !status ? (
              <PanelMessage
                title={t("git.unavailable")}
                body={t("git.loadStatusFailed")}
              />
            ) : (
              <div className="min-h-0 overflow-auto pr-1">
                <RepositorySummary status={status} />

                {partialStaging ? (
                  <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                    {t("git.partialStaging")}
                  </div>
                ) : null}

                <Diagnostics
                  diagnostics={[
                    ...status.blockers,
                    ...status.warnings,
                    ...diagnostics,
                  ]}
                />

                <label className="mt-4 block text-sm font-medium text-foreground">
                  {t("git.commitMessage")}
                  <input
                    className="mt-2 h-9 w-full rounded-lg border border-field-border bg-transparent px-3 text-sm outline-none focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/50"
                    disabled={pending}
                    onChange={(event) => setMessage(event.target.value)}
                    value={commitMessage}
                  />
                </label>

                <div className="mt-4">
                  <div className="mb-2 text-sm font-medium text-foreground">
                    {t("git.filesToCommit")}
                  </div>
                  <FileList files={status.files} />
                </div>
              </div>
            )}

            <Modal.Footer className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onPress={() => statusQuery.refetch()}
                isDisabled={statusQuery.isFetching || pending}
                className="mr-auto"
              >
                <RotateCcw className="size-3.5" />
                {t("git.refresh")}
              </Button>
              {showPushRetry ? (
                <Button type="button" onPress={retryPush} isDisabled={pending}>
                  {t("git.retryPush")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant={
                  mode === GitCommitMode.COMMIT_ONLY ? "primary" : "secondary"
                }
                isDisabled={!canCommit}
                onPress={() => {
                  setMode(GitCommitMode.COMMIT_ONLY)
                  void runCommit(GitCommitMode.COMMIT_ONLY)
                }}
              >
                {pending && mode === GitCommitMode.COMMIT_ONLY ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                {t("git.commitAll")}
              </Button>
              <Button
                type="button"
                isDisabled={!canCommitAndPush}
                onPress={() => {
                  setMode(GitCommitMode.COMMIT_AND_PUSH)
                  void runCommit(GitCommitMode.COMMIT_AND_PUSH)
                }}
              >
                {pending && mode === GitCommitMode.COMMIT_AND_PUSH ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                {t("git.commitAllPush")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function RepositorySummary({ status }: { status: ProjectGitStatus }) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          color={status.isGitRepository ? "default" : "danger"}
          size="sm"
          variant="soft"
        >
          {status.isGitRepository ? t("git.gitRepo") : t("git.noGit")}
        </Chip>
        {status.branch ? (
          <span className="inline-flex items-center gap-1 text-sm text-foreground">
            <GitBranch className="size-3.5 text-muted" />
            {status.branch}
          </span>
        ) : null}
        {status.headShortSha ? (
          <span className="font-mono text-xs text-muted">
            {status.headShortSha}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-xs text-muted">{status.rootPath}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        <span>{t("git.dirtyFiles", { count: status.files.length })}</span>
        {status.upstream ? (
          <span>{t("git.upstream", { name: status.upstream })}</span>
        ) : (
          <span>{t("git.noUpstream")}</span>
        )}
        {status.ahead || status.behind ? (
          <span>
            {t("git.upstreamDiverged", {
              ahead: status.ahead,
              behind: status.behind,
            })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function Diagnostics({ diagnostics }: { diagnostics: { message: string }[] }) {
  const visible = diagnostics.filter((diagnostic) => diagnostic.message)
  if (visible.length === 0) {
    return null
  }
  return (
    <div className="mt-3 space-y-2">
      {visible.map((diagnostic, index) => (
        <div
          key={`${diagnostic.message}-${index}`}
          className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-muted"
        >
          {diagnostic.message}
        </div>
      ))}
    </div>
  )
}

function FileList({ files }: { files: ProjectGitStatus["files"] }) {
  const { t } = useTranslation()

  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-sm text-muted">
        {t("git.noChangesToCommit")}
      </div>
    )
  }
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border bg-surface">
      {files.map((file) => (
        <div
          key={`${file.oldPath || ""}:${file.path}`}
          className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
        >
          <span
            className={cn(
              "w-20 shrink-0 text-xs font-medium",
              file.status === GitFileStatus.CONFLICTED
                ? "text-danger"
                : "text-muted"
            )}
          >
            {formatFileStatus(file.status, t)}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
            {file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
          </span>
          {file.partiallyStaged ? (
            <Chip size="sm" variant="secondary">
              {t("git.partial")}
            </Chip>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PanelMessage({ body, title }: { body: string; title: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 text-sm text-muted">{body}</div>
    </div>
  )
}

function formatFileStatus(
  status: GitFileStatus,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (status) {
    case GitFileStatus.ADDED:
      return t("git.status.added")
    case GitFileStatus.MODIFIED:
      return t("git.status.modified")
    case GitFileStatus.DELETED:
      return t("git.status.deleted")
    case GitFileStatus.RENAMED:
      return t("git.status.renamed")
    case GitFileStatus.UNTRACKED:
      return t("git.status.untracked")
    case GitFileStatus.CONFLICTED:
      return t("git.status.conflict")
    default:
      return t("git.status.changed")
  }
}
