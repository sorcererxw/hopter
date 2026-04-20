import { useEffect, useMemo, useState } from "react"

import { useQuery } from "@tanstack/react-query"
import {
  ExternalLink,
  FileImage,
  FileSearch,
  FileText,
  ListTree,
  LoaderCircle,
  TestTube2,
} from "lucide-react"

import { CodeContainer } from "@/components/app/code-container"
import { SessionRichText } from "@/components/app/session-rich-text"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ArtifactRef } from "@/gen/proto/hopter/v1/common_pb"
import { ArtifactKind } from "@/gen/proto/hopter/v1/common_pb"
import { useSessionArtifacts } from "@/features/sessions/use-sessions"
import { formatArtifactKind, formatUpdatedAt } from "@/lib/format/proto"
import { cn } from "@/lib/utils"

type SessionArtifactWorkspaceProps = {
  artifacts: ArtifactRef[]
  onOpenReview?: () => void
  sessionId: string
}

export function SessionArtifactWorkspace({
  artifacts,
  onOpenReview,
  sessionId,
}: SessionArtifactWorkspaceProps) {
  const artifactsQuery = useSessionArtifacts(sessionId, true)
  const artifactList = useMemo(() => {
    return artifactsQuery.data && artifactsQuery.data.length > 0
      ? artifactsQuery.data
      : artifacts
  }, [artifacts, artifactsQuery.data])
  const [selectedArtifactId, setSelectedArtifactId] = useState("")

  useEffect(() => {
    if (
      selectedArtifactId &&
      artifactList.some((artifact) => artifact.id === selectedArtifactId)
    ) {
      return
    }

    setSelectedArtifactId(artifactList[0]?.id ?? "")
  }, [artifactList, selectedArtifactId])

  if (artifactsQuery.isLoading && artifactList.length === 0) {
    return <ArtifactWorkspaceLoading />
  }

  if (artifactList.length === 0) {
    return null
  }

  const selectedArtifact =
    artifactList.find((artifact) => artifact.id === selectedArtifactId) ??
    artifactList[0]

  return (
    <section
      className="space-y-3"
      data-testid="session-artifact-workspace"
      aria-label="Session artifacts"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Artifacts</div>
          <div className="text-sm text-muted-foreground">
            Review summaries, screenshots, logs, tests, and changed files without
            leaving the thread.
          </div>
        </div>
        {artifactsQuery.isFetching ? (
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Refreshing
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {artifactList.map((artifact) => {
          const active = artifact.id === selectedArtifact.id
          const Icon = artifactKindIcon(artifact.kind)

          return (
            <button
              key={artifact.id}
              type="button"
              className={cn(
                "inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition",
                active
                  ? "border-border bg-card text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              onClick={() => setSelectedArtifactId(artifact.id)}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{artifact.label}</span>
              <Badge
                variant="outline"
                className="shrink-0 border-border text-[11px] text-muted-foreground"
              >
                {formatArtifactKind(artifact.kind)}
              </Badge>
            </button>
          )
        })}
      </div>

      <ArtifactPreviewPanel
        artifact={selectedArtifact}
        onOpenReview={onOpenReview}
      />
    </section>
  )
}

function ArtifactPreviewPanel({
  artifact,
  onOpenReview,
}: {
  artifact: ArtifactRef
  onOpenReview?: () => void
}) {
  const supportsTextPreview = shouldFetchArtifactText(artifact)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [artifact.id])

  const textPreviewQuery = useQuery({
    enabled: supportsTextPreview && artifact.downloadUrl.trim().length > 0,
    queryKey: ["artifact-preview", artifact.id, artifact.downloadUrl],
    queryFn: async () => {
      const response = await fetch(artifact.downloadUrl, {
        credentials: "same-origin",
      })
      if (!response.ok) {
        throw new Error(`Artifact request failed with status ${response.status}`)
      }
      return {
        contentType:
          response.headers.get("content-type") || artifact.contentType,
        text: await response.text(),
      }
    },
    staleTime: 30_000,
  })

  const textPreview = textPreviewQuery.data?.text ?? ""
  const parsedChangedFiles = useMemo(
    () => parseChangedFilesArtifact(textPreview),
    [textPreview]
  )

  return (
    <div className="rounded-lg border border-border bg-card" data-testid="session-artifact-preview">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-base font-medium text-foreground">
            {artifact.label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{formatArtifactKind(artifact.kind)}</span>
            {artifact.createdAt ? (
              <>
                <span className="text-muted-foreground/60">•</span>
                <span>{formatUpdatedAt(artifact.createdAt)}</span>
              </>
            ) : null}
            {artifact.contentType ? (
              <>
                <span className="text-muted-foreground/60">•</span>
                <span>{artifact.contentType}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {artifact.kind === ArtifactKind.CHANGED_FILES && onOpenReview ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenReview}
            >
              Open review
            </Button>
          ) : null}
          {artifact.downloadUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={artifact.downloadUrl} target="_blank" rel="noreferrer">
                Open original
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-[220px] px-4 py-4">
        {artifact.kind === ArtifactKind.SCREENSHOT ? (
          artifact.downloadUrl && !imageFailed ? (
            <img
              src={artifact.downloadUrl}
              alt={artifact.label}
              className="max-h-[480px] w-full rounded-md border border-border object-contain"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ArtifactPreviewEmpty
              title="Screenshot preview unavailable"
              body="Open the original artifact to inspect the image."
            />
          )
        ) : supportsTextPreview ? (
          textPreviewQuery.isLoading ? (
            <ArtifactPreviewLoading label="Loading artifact preview..." />
          ) : textPreviewQuery.isError ? (
            <ArtifactPreviewEmpty
              title="Artifact preview unavailable"
              body={
                textPreviewQuery.error instanceof Error
                  ? textPreviewQuery.error.message
                  : "The artifact could not be loaded."
              }
            />
          ) : renderTextArtifactPreview(
              artifact,
              textPreview,
              parsedChangedFiles,
              onOpenReview
            )
        ) : (
          <ArtifactPreviewEmpty
            title="Binary artifact"
            body="This artifact does not expose an inline preview yet. Open the original file."
          />
        )}
      </div>
    </div>
  )
}

function renderTextArtifactPreview(
  artifact: ArtifactRef,
  text: string,
  changedFiles: ChangedFileArtifactEntry[],
  onOpenReview?: () => void
) {
  switch (artifact.kind) {
    case ArtifactKind.SUMMARY:
      return (
        <SessionRichText
          text={text.trim() || "No summary content available."}
          className="text-base"
        />
      )
    case ArtifactKind.CHANGED_FILES:
      return changedFiles.length > 0 ? (
        <div className="space-y-3">
          <div className="space-y-2">
            {changedFiles.map((change) => (
              <div
                key={`${change.path}-${change.kindLabel}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-foreground">
                    {change.path}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {change.kindLabel}
                  </div>
                </div>
                {(change.additions || change.deletions) && (
                  <div className="shrink-0 font-mono text-sm">
                    <span className="text-emerald-600">+{change.additions}</span>
                    <span className="px-1 text-muted-foreground">/</span>
                    <span className="text-destructive">-{change.deletions}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {onOpenReview ? (
            <div className="text-sm text-muted-foreground">
              Need file-level diff detail? Use <span className="font-medium text-foreground">Open review</span>.
            </div>
          ) : null}
        </div>
      ) : (
        <CodeContainer as="pre" className="whitespace-pre-wrap">
          {text.trim() || "No changed files artifact content available."}
        </CodeContainer>
      )
    case ArtifactKind.TEST_RESULT:
    case ArtifactKind.LOG:
      return (
        <CodeContainer as="pre" className="whitespace-pre-wrap">
          {text.trim() || "No artifact content available."}
        </CodeContainer>
      )
    case ArtifactKind.OTHER:
    case ArtifactKind.UNSPECIFIED:
    default:
      return looksLikeMarkdown(text) ? (
        <SessionRichText text={text.trim() || "No artifact content available."} />
      ) : (
        <CodeContainer as="pre" className="whitespace-pre-wrap">
          {text.trim() || "No artifact content available."}
        </CodeContainer>
      )
  }
}

function ArtifactWorkspaceLoading() {
  return (
    <div
      className="rounded-lg border border-border bg-card px-4 py-6"
      data-testid="session-artifact-workspace-loading"
    >
      <ArtifactPreviewLoading label="Loading artifacts..." />
    </div>
  )
}

function ArtifactPreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      <span>{label}</span>
    </div>
  )
}

function ArtifactPreviewEmpty({
  body,
  title,
}: {
  body: string
  title: string
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
      <div className="text-base font-medium text-foreground">{title}</div>
      <div className="mt-2 max-w-[480px] text-sm text-muted-foreground">
        {body}
      </div>
    </div>
  )
}

function artifactKindIcon(kind: ArtifactKind) {
  switch (kind) {
    case ArtifactKind.SUMMARY:
      return FileText
    case ArtifactKind.CHANGED_FILES:
      return ListTree
    case ArtifactKind.TEST_RESULT:
      return TestTube2
    case ArtifactKind.SCREENSHOT:
      return FileImage
    case ArtifactKind.LOG:
    case ArtifactKind.OTHER:
    case ArtifactKind.UNSPECIFIED:
    default:
      return FileSearch
  }
}

function shouldFetchArtifactText(artifact: ArtifactRef) {
  switch (artifact.kind) {
    case ArtifactKind.SUMMARY:
    case ArtifactKind.CHANGED_FILES:
    case ArtifactKind.TEST_RESULT:
    case ArtifactKind.LOG:
      return artifact.downloadUrl.trim().length > 0
    case ArtifactKind.OTHER:
    case ArtifactKind.UNSPECIFIED:
      return (
        artifact.downloadUrl.trim().length > 0 &&
        isProbablyTextContentType(artifact.contentType)
      )
    case ArtifactKind.SCREENSHOT:
      return false
    default:
      return false
  }
}

function isProbablyTextContentType(contentType: string) {
  const normalized = contentType.trim().toLowerCase()
  if (!normalized) {
    return true
  }

  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("markdown")
  )
}

type ChangedFileArtifactEntry = {
  additions: number
  deletions: number
  kindLabel: string
  path: string
}

function parseChangedFilesArtifact(text: string): ChangedFileArtifactEntry[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      changes?: Array<{
        additions?: number
        deletions?: number
        kind?: string
        path?: string
      }>
    }

    return (parsed.changes ?? [])
      .filter(
        (change) =>
          typeof change.path === "string" && change.path.trim().length > 0
      )
      .map((change) => ({
        additions: change.additions ?? 0,
        deletions: change.deletions ?? 0,
        kindLabel: describeFileChangeKind(change.kind),
        path: change.path!.trim(),
      }))
  } catch {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        additions: 0,
        deletions: 0,
        kindLabel: "Edited",
        path: line,
      }))
  }
}

function describeFileChangeKind(kind: string | undefined) {
  switch ((kind || "").toLowerCase()) {
    case "add":
    case "added":
    case "create":
    case "created":
      return "Added"
    case "delete":
    case "deleted":
      return "Deleted"
    case "move":
    case "rename":
    case "renamed":
      return "Moved"
    case "update":
    case "updated":
    case "edit":
    case "edited":
    case "modify":
    case "modified":
      return "Edited"
    default:
      return "Edited"
  }
}

function looksLikeMarkdown(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }

  return /(^#\s)|(\n#\s)|(```)|(^[-*]\s)|(\n[-*]\s)/m.test(trimmed)
}
