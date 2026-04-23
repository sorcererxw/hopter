import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { GitBranch, LoaderCircle, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(720px,calc(100vh-2rem))] gap-4 overflow-hidden sm:max-w-2xl"
        data-testid="project-git-action-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("git.commitRepositoryChanges")}</DialogTitle>
          <DialogDescription>{t("git.description")}</DialogDescription>
        </DialogHeader>

        {statusQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
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
                className="mt-2 h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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

        <DialogFooter className="border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching || pending}
            className="mr-auto"
          >
            <RotateCcw className="size-3.5" />
            {t("git.refresh")}
          </Button>
          {showPushRetry ? (
            <Button type="button" onClick={retryPush} disabled={pending}>
              {t("git.retryPush")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={
              mode === GitCommitMode.COMMIT_ONLY ? "default" : "secondary"
            }
            disabled={!canCommit}
            onClick={() => {
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
            disabled={!canCommitAndPush}
            onClick={() => {
              setMode(GitCommitMode.COMMIT_AND_PUSH)
              void runCommit(GitCommitMode.COMMIT_AND_PUSH)
            }}
          >
            {pending && mode === GitCommitMode.COMMIT_AND_PUSH ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : null}
            {t("git.commitAllPush")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RepositorySummary({ status }: { status: ProjectGitStatus }) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.isGitRepository ? "secondary" : "destructive"}>
          {status.isGitRepository ? t("git.gitRepo") : t("git.noGit")}
        </Badge>
        {status.branch ? (
          <span className="inline-flex items-center gap-1 text-sm text-foreground">
            <GitBranch className="size-3.5 text-muted-foreground" />
            {status.branch}
          </span>
        ) : null}
        {status.headShortSha ? (
          <span className="font-mono text-xs text-muted-foreground">
            {status.headShortSha}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {status.rootPath}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
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
          className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground"
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
      <div className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
        {t("git.noChangesToCommit")}
      </div>
    )
  }
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border bg-card">
      {files.map((file) => (
        <div
          key={`${file.oldPath || ""}:${file.path}`}
          className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
        >
          <span
            className={cn(
              "w-20 shrink-0 text-xs font-medium",
              file.status === GitFileStatus.CONFLICTED
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {formatFileStatus(file.status, t)}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
            {file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
          </span>
          {file.partiallyStaged ? (
            <Badge variant="outline">{t("git.partial")}</Badge>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PanelMessage({ body, title }: { body: string; title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-6 text-center">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{body}</div>
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
