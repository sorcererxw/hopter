import { LoaderCircle, PanelRightClose, PanelRightOpen, X } from "lucide-react"

import { ShikiCodeFrame } from "@/components/app/shared"
import { Button } from "@/components/ui/button"
import type {
  SessionFile,
  SessionReview,
} from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

export type SessionSidebarMode = "file" | "review"
export type SessionReviewView = "file" | "full"

type SessionInspectorPaneProps = {
  file?: SessionFile
  fileLoading?: boolean
  mobile?: boolean
  mode: SessionSidebarMode
  onClose: () => void
  onModeChange: (mode: SessionSidebarMode) => void
  onReviewFileSelect: (path: string) => void
  onReviewViewChange: (view: SessionReviewView) => void
  review?: SessionReview
  reviewFile: string | null
  reviewLoading?: boolean
  reviewView: SessionReviewView
}

export function SessionInspectorPane({
  file,
  fileLoading = false,
  mobile = false,
  mode,
  onClose,
  onModeChange,
  onReviewFileSelect,
  onReviewViewChange,
  review,
  reviewFile,
  reviewLoading = false,
  reviewView,
}: SessionInspectorPaneProps) {
  const selectedReviewFile =
    review?.files.find((entry) => entry.path === reviewFile) ?? review?.files[0]

  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col bg-card text-sm font-medium text-foreground",
        mobile ? "h-full w-full" : "h-full"
      )}
      data-testid="session-inspector-pane"
    >
      <div className="flex items-center gap-2 border-b border-border bg-popover px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <ModeButton
            active={mode === "file"}
            onClick={() => onModeChange("file")}
          >
            File
          </ModeButton>
          <ModeButton
            active={mode === "review"}
            onClick={() => onModeChange("review")}
          >
            Review
          </ModeButton>
        </div>

        {mode === "review" ? (
          <div className="ml-auto flex items-center gap-1">
            <ViewButton
              active={reviewView === "file"}
              onClick={() => onReviewViewChange("file")}
            >
              {reviewFile ? <PanelRightOpen className="size-3.5" /> : null}
              File
            </ViewButton>
            <ViewButton
              active={reviewView === "full"}
              onClick={() => onReviewViewChange("full")}
            >
              <PanelRightClose className="size-3.5" />
              Full patch
            </ViewButton>
          </div>
        ) : (
          <div className="ml-auto" />
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="text-muted-foreground"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "file" ? (
          <FilePanel file={file} loading={fileLoading} />
        ) : (
          <ReviewPanel
            review={review}
            reviewFile={selectedReviewFile?.path ?? null}
            reviewLoading={reviewLoading}
            reviewView={reviewView}
            onReviewFileSelect={onReviewFileSelect}
          />
        )}
      </div>
    </aside>
  )
}

function FilePanel({
  file,
  loading,
}: {
  file?: SessionFile
  loading: boolean
}) {
  if (loading) {
    return <PanelLoading label="Loading file…" />
  }

  if (!file) {
    return <PanelEmpty label="Select a file from the thread to open it here." />
  }

  if (!file.available) {
    return (
      <PanelMessage
        title="File unavailable"
        body={file.reason || "The requested file could not be opened."}
        meta={[
          file.requestedPath ? `Requested: ${file.requestedPath}` : null,
          file.canonicalPath ? `Resolved: ${file.canonicalPath}` : null,
        ]}
      />
    )
  }

  if (file.isBinary) {
    return (
      <PanelMessage
        title="Binary file not previewable"
        body={
          file.reason ||
          "This file exists, but the sidebar only previews text files."
        }
        meta={[
          file.displayPath || file.requestedPath || null,
          file.canonicalPath || null,
        ]}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="truncate font-mono text-foreground">
          {file.displayPath || file.requestedPath}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {file.canonicalPath}
        </div>
        {file.truncated ? (
          <div className="mt-2 text-xs text-amber-200/80">
            Preview truncated for large file size.
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-2">
        <ShikiCodeFrame
          code={file.content}
          filePath={file.displayPath || file.requestedPath}
          targetLine={file.initialLine}
        />
      </div>
    </div>
  )
}

function ReviewPanel({
  review,
  reviewFile,
  reviewLoading,
  reviewView,
  onReviewFileSelect,
}: {
  review?: SessionReview
  reviewFile: string | null
  reviewLoading: boolean
  reviewView: SessionReviewView
  onReviewFileSelect: (path: string) => void
}) {
  if (reviewLoading) {
    return <PanelLoading label="Loading review…" />
  }

  if (!review || !review.available) {
    return (
      <PanelMessage
        title="Review unavailable"
        body={review?.reason || "No completed turn is available to review yet."}
        meta={
          review?.pendingTurnInProgress
            ? ["A newer turn is still running."]
            : undefined
        }
      />
    )
  }

  const selectedFile =
    review.files.find((entry) => entry.path === reviewFile) ?? review.files[0]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {review.pendingTurnInProgress ? (
        <div className="border-b border-border bg-secondary px-4 py-2 text-xs text-muted-foreground">
          A newer turn is still running. Review is showing the latest completed
          turn.
        </div>
      ) : null}

      {reviewView === "full" ? (
        <div className="min-h-0 flex-1 overflow-auto py-2">
          <ShikiCodeFrame
            code={
              review.fullPatch.trim() ||
              "This turn does not currently expose a full patch."
            }
            language="diff"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-56 shrink-0 flex-col border-r border-border bg-popover">
            <div className="border-b border-border px-3 py-2 text-xs tracking-wide text-muted-foreground uppercase">
              Changed files
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <div className="space-y-1">
                {review.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => onReviewFileSelect(file.path)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition",
                      selectedFile?.path === file.path
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <span className="shrink-0 text-xs tracking-wide text-muted-foreground uppercase">
                      {file.kind}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-foreground">
                        {file.path}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        +{file.additions} -{file.deletions}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {selectedFile ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-border px-4 py-3">
                  <div className="truncate font-mono text-foreground">
                    {selectedFile.path}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedFile.kind} · +{selectedFile.additions} -
                    {selectedFile.deletions}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto py-2">
                  <ShikiCodeFrame
                    code={
                      selectedFile.diff.trim() ||
                      "This file change does not currently expose inline diff content."
                    }
                    filePath={selectedFile.path}
                    language="diff"
                  />
                </div>
              </div>
            ) : (
              <PanelEmpty label="Select a changed file to inspect its diff." />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  )
}

function PanelEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm rounded-lg border border-dashed border-border bg-muted px-5 py-4 text-center leading-6 font-normal text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

function PanelMessage({
  title,
  body,
  meta,
}: {
  title: string
  body: string
  meta?: Array<string | null | undefined>
}) {
  const visibleMeta = (meta ?? []).filter(Boolean)

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md rounded-lg border border-border bg-card px-5 py-4">
        <div className="text-base text-foreground">{title}</div>
        <div className="mt-2 leading-6 font-normal text-muted-foreground">
          {body}
        </div>
        {visibleMeta.length > 0 ? (
          <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
            {visibleMeta.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className={cn(active ? "text-foreground" : "text-muted-foreground")}
    >
      {children}
    </Button>
  )
}

function ViewButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant={active ? "secondary" : "ghost"}
      size="xs"
      className={cn(
        "gap-1",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {children}
    </Button>
  )
}
