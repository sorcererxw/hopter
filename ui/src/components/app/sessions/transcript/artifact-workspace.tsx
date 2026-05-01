import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { useQuery } from "@tanstack/react-query"
import {
  ExternalLink,
  FileImage,
  FileSearch,
  FileText,
  ListTree,
  LoaderCircle,
  TestTube2,
} from "@/components/icons/hugeicons"
import { Button, Chip, Link } from "@heroui/react"

import { CodeContainer, SessionImage } from "@/components/app/shared"
import type { ArtifactRef } from "@/gen/proto/hopter/v1/common_pb"
import { ArtifactKind } from "@/gen/proto/hopter/v1/common_pb"
import { useSessionArtifacts } from "@/features/sessions/use-sessions"
import { formatUpdatedAt } from "@/lib/format/proto"
import { cn, resolveImageSource } from "@/lib/utils"

import { SessionRichText } from "./rich-text"

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
  const { t } = useTranslation()
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
      aria-label={t("artifact.artifacts")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            {t("artifact.artifacts")}
          </div>
          <div className="text-sm text-muted">{t("artifact.description")}</div>
        </div>
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
                  ? "border-border bg-surface text-foreground"
                  : "border-border bg-background text-muted hover:bg-surface-tertiary hover:text-foreground"
              )}
              onClick={() => setSelectedArtifactId(artifact.id)}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{artifact.label}</span>
              <Chip
                size="sm"
                variant="secondary"
                className="shrink-0 border-border text-[11px] text-muted"
              >
                {formatArtifactKind(artifact.kind, t)}
              </Chip>
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
  const { t } = useTranslation()
  const downloadUrl = artifact.downloadUrl?.trim() ?? ""
  const supportsTextPreview = shouldFetchArtifactText(artifact)
  const resolvedDownloadImage = resolveImageSource(downloadUrl)
  const canUseDownloadUrl = Boolean(resolvedDownloadImage.isUsable)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [artifact.id])

  const textPreviewQuery = useQuery({
    enabled: supportsTextPreview && canUseDownloadUrl,
    queryKey: ["artifact-preview", artifact.id, resolvedDownloadImage.src],
    queryFn: async () => {
      const response = await fetch(resolvedDownloadImage.src, {
        credentials: "same-origin",
      })
      if (!response.ok) {
        throw new Error(
          `Artifact request failed with status ${response.status}`
        )
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
    () => parseChangedFilesArtifact(textPreview, t),
    [textPreview, t]
  )

  return (
    <div
      className="rounded-lg border border-border bg-surface"
      data-testid="session-artifact-preview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-base font-medium text-foreground">
            {artifact.label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{formatArtifactKind(artifact.kind, t)}</span>
            {artifact.createdAt ? (
              <>
                <span className="text-muted/60">•</span>
                <span>{formatUpdatedAt(artifact.createdAt)}</span>
              </>
            ) : null}
            {artifact.contentType ? (
              <>
                <span className="text-muted/60">•</span>
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
              onPress={onOpenReview}
            >
              {t("artifact.openReview")}
            </Button>
          ) : null}
          {resolvedDownloadImage.isUsable ? (
            <Link
              href={resolvedDownloadImage.src}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-border bg-field/30 px-3 text-sm text-foreground transition hover:bg-field/50"
            >
              {t("artifact.openOriginal")}
              <ExternalLink className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="min-h-[220px] px-4 py-4">
        {artifact.kind === ArtifactKind.SCREENSHOT ? (
          canUseDownloadUrl && !imageFailed ? (
            <SessionImage
              src={resolvedDownloadImage.src}
              alt={artifact.label}
              className="max-h-[480px] w-full rounded-md border border-border object-contain"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ArtifactPreviewEmpty
              title={t("artifact.screenshotUnavailable")}
              body={t("artifact.screenshotBody")}
            />
          )
        ) : supportsTextPreview ? (
          textPreviewQuery.isLoading ? (
            <ArtifactPreviewLoading label={t("artifact.loadingPreview")} />
          ) : textPreviewQuery.isError ? (
            <ArtifactPreviewEmpty
              title={t("artifact.previewUnavailable")}
              body={
                textPreviewQuery.error instanceof Error
                  ? textPreviewQuery.error.message
                  : t("artifact.couldNotLoad")
              }
            />
          ) : (
            renderTextArtifactPreview(
              artifact,
              textPreview,
              parsedChangedFiles,
              onOpenReview,
              t
            )
          )
        ) : (
          <ArtifactPreviewEmpty
            title={t("artifact.binary")}
            body={t("artifact.binaryBody")}
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
  onOpenReview: (() => void) | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (artifact.kind) {
    case ArtifactKind.SUMMARY:
      return (
        <SessionRichText
          text={text.trim() || t("artifact.summaryFallback")}
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
                  <div className="mt-1 text-sm text-muted">
                    {change.kindLabel}
                  </div>
                </div>
                {(change.additions || change.deletions) && (
                  <div className="shrink-0 font-mono text-sm">
                    <span className="text-emerald-600">
                      +{change.additions}
                    </span>
                    <span className="px-1 text-muted">/</span>
                    <span className="text-danger">-{change.deletions}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {onOpenReview ? (
            <div className="text-sm text-muted">
              {t("artifact.needDiffDetail")}{" "}
              <span className="font-medium text-foreground">
                {t("artifact.openReview")}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <CodeContainer>
          <pre className="whitespace-pre-wrap">
            {text.trim() || t("artifact.changedFilesFallback")}
          </pre>
        </CodeContainer>
      )
    case ArtifactKind.TEST_RESULT:
    case ArtifactKind.LOG:
      return (
        <CodeContainer>
          <pre className="whitespace-pre-wrap">
            {text.trim() || t("artifact.contentFallback")}
          </pre>
        </CodeContainer>
      )
    case ArtifactKind.OTHER:
    case ArtifactKind.UNSPECIFIED:
    default:
      return looksLikeMarkdown(text) ? (
        <SessionRichText text={text.trim() || t("artifact.contentFallback")} />
      ) : (
        <CodeContainer>
          <pre className="whitespace-pre-wrap">
            {text.trim() || t("artifact.contentFallback")}
          </pre>
        </CodeContainer>
      )
  }
}

function ArtifactPreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted">
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
      <div className="mt-2 max-w-[480px] text-sm text-muted">{body}</div>
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

function formatArtifactKind(
  kind: ArtifactKind,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (kind) {
    case ArtifactKind.SUMMARY:
      return t("artifact.kind.summary")
    case ArtifactKind.CHANGED_FILES:
      return t("artifact.kind.changedFiles")
    case ArtifactKind.TEST_RESULT:
      return t("artifact.kind.testResult")
    case ArtifactKind.SCREENSHOT:
      return t("artifact.kind.screenshot")
    case ArtifactKind.LOG:
      return t("artifact.kind.log")
    case ArtifactKind.OTHER:
      return t("artifact.kind.other")
    case ArtifactKind.UNSPECIFIED:
    default:
      return t("artifact.kind.artifact")
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

function parseChangedFilesArtifact(
  text: string,
  t: ReturnType<typeof useTranslation>["t"]
): ChangedFileArtifactEntry[] {
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
        kindLabel: describeFileChangeKind(change.kind, t),
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
        kindLabel: t("artifact.status.edited"),
        path: line,
      }))
  }
}

function describeFileChangeKind(
  kind: string | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch ((kind || "").toLowerCase()) {
    case "add":
    case "added":
    case "create":
    case "created":
      return t("artifact.status.added")
    case "delete":
    case "deleted":
      return t("artifact.status.deleted")
    case "move":
    case "rename":
    case "renamed":
      return t("artifact.status.moved")
    case "update":
    case "updated":
    case "edit":
    case "edited":
    case "modify":
    case "modified":
      return t("artifact.status.edited")
    default:
      return t("artifact.status.edited")
  }
}

function looksLikeMarkdown(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }

  return /(^#\s)|(\n#\s)|(```)|(^[-*]\s)|(\n[-*]\s)/m.test(trimmed)
}
