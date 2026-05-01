import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { File, Folder, FolderGit2 } from "@/components/icons/hugeicons"
import { useNavigate } from "react-router-dom"
import { Button, Modal, Skeleton } from "@heroui/react"

import { useWorkspaceShell } from "@/components/app/workspace"
import type {
  DirectoryEntry,
  DirectoryRoot,
} from "@/gen/proto/hopter/v1/host_pb"
import {
  useDirectoryListing,
  useDirectoryRoots,
  usePathMetadata,
} from "@/features/host/use-host-browser"
import { useCreateProject } from "@/features/projects/use-projects"
import { cn } from "@/lib/utils"

const EMPTY_ROOTS: DirectoryRoot[] = []

function normalizePath(value: string) {
  if (!value) {
    return ""
  }

  if (value.length > 1 && value.endsWith("/")) {
    return value.slice(0, -1)
  }

  return value
}

function inferDefaultPath(roots: DirectoryRoot[]) {
  const homeRoot = roots.find((root) => root.kind === "home")
  if (homeRoot) {
    return homeRoot.path
  }
  return roots[0]?.path || ""
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

function entryIcon(entry: DirectoryEntry) {
  if (entry.isRepo) {
    return FolderGit2
  }
  if (entry.isDirectory) {
    return Folder
  }
  return File
}

// Dialog variant used on compact/wide shells. Phone uses the full-page picker
// route so back navigation matches the shell contract.
export function ProjectPickerDialog({ open }: { open: boolean }) {
  const { closeProjectPicker } = useWorkspaceShell()
  const navigate = useNavigate()
  return (
    <Modal
      isOpen={open}
      onOpenChange={(nextOpen) => !nextOpen && closeProjectPicker()}
    >
      <Modal.Backdrop variant="opaque">
        <Modal.Container size="cover">
          <Modal.Dialog
            data-testid="project-picker-dialog-shell"
            className="inset-0 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 rounded-none border-0 bg-transparent p-4 text-foreground ring-0 sm:max-w-none md:p-6 lg:p-8"
          >
            <ProjectPickerContent
              onProjectOpened={(projectId) => {
                closeProjectPicker()
                navigate(
                  `/?compose=1&projectId=${encodeURIComponent(projectId)}`
                )
              }}
              onRequestClose={closeProjectPicker}
              standalone={false}
            />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

export function ProjectPickerPage() {
  const navigate = useNavigate()

  return (
    <div className="h-full min-h-0 bg-background text-foreground">
      <ProjectPickerContent
        onProjectOpened={(projectId) =>
          navigate(`/?compose=1&projectId=${encodeURIComponent(projectId)}`)
        }
        onRequestClose={() => navigate("/")}
        standalone
      />
    </div>
  )
}

// ProjectPickerContent is shared by both the modal and page variants. It only
// creates projects from visible git repos and leaves non-repo folders as browse
// targets.
function ProjectPickerContent({
  onProjectOpened,
  onRequestClose,
  standalone,
}: {
  onProjectOpened: (projectId: string) => void
  onRequestClose: () => void
  standalone: boolean
}) {
  const { t } = useTranslation()
  const createProject = useCreateProject()
  const rootsQuery = useDirectoryRoots()

  const roots = useMemo(() => rootsQuery.data ?? EMPTY_ROOTS, [rootsQuery.data])
  const defaultPath = useMemo(() => inferDefaultPath(roots), [roots])

  const [currentPath, setCurrentPath] = useState("")
  const [selectedPath, setSelectedPath] = useState("")
  const [formError, setFormError] = useState("")

  const activePath = currentPath || defaultPath
  const listingQuery = useDirectoryListing(activePath, Boolean(activePath))
  const previewPath = selectedPath || activePath
  const previewQuery = usePathMetadata(previewPath, Boolean(previewPath))
  const previewMetadata = previewQuery.data
  const canOpenFolder = Boolean(
    previewMetadata?.isDirectory && previewMetadata?.isAllowed
  )
  const selectedRepoPath =
    previewMetadata?.isDirectory &&
    previewMetadata.isRepo &&
    previewMetadata.isAllowed
      ? previewMetadata.canonicalPath
      : ""
  const entries = useMemo(
    () => listingQuery.data?.entries ?? [],
    [listingQuery.data?.entries]
  )

  const openDirectory = useCallback(
    (path: string, options?: { fromHistory?: boolean }) => {
      const normalized = normalizePath(path)
      setFormError("")
      setCurrentPath(normalized)
      setSelectedPath("")

      if (options?.fromHistory) {
        return
      }
    },
    []
  )

  const handleSelectEntry = useCallback((entry: DirectoryEntry) => {
    setSelectedPath(entry.path)
  }, [])

  const handleOpenEntry = useCallback(
    (entry: DirectoryEntry) => {
      setSelectedPath(entry.path)
      if (entry.isDirectory) {
        openDirectory(entry.path)
      }
    },
    [openDirectory]
  )

  const handleOpen = useCallback(async () => {
    setFormError("")

    if (!canOpenFolder) {
      setFormError(t("projectPicker.pickVisibleFolder"))
      return
    }

    if (!selectedRepoPath) {
      setFormError(t("projectPicker.notGitRepository"))
      return
    }

    try {
      await createProject.mutateAsync({
        defaultBackend: "codex",
        name: previewMetadata?.basename || t("projectPicker.defaultProject"),
        rootPath: selectedRepoPath,
      })
      // The selected repo path also acts as the project id in the current Go
      // backend, so return it to the caller for compose-route navigation.
      onProjectOpened(selectedRepoPath)
    } catch (error) {
      setFormError(errorMessage(error, t("projectPicker.hostError")))
    }
  }, [
    canOpenFolder,
    createProject,
    onProjectOpened,
    previewMetadata,
    selectedRepoPath,
    t,
  ])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onRequestClose()
      }
      if (event.key === "Enter" && canOpenFolder) {
        // Treat Enter like "open selected repo" to keep the picker keyboardable
        // without introducing a separate focus model.
        void handleOpen()
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [canOpenFolder, handleOpen, onRequestClose])

  const footerText = selectedPath
    ? previewMetadata?.basename || selectedPath
    : t("projectPicker.itemCount", { count: entries.length })

  const activeError =
    formError || rootsQuery.error || listingQuery.error || previewQuery.error

  return (
    <div
      data-testid={standalone ? "project-picker-page" : "project-picker-dialog"}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-overlay",
        standalone ? "" : "max-w-7xl rounded-lg border border-border"
      )}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-overlay">
          {listingQuery.isLoading ? (
            <div className="space-y-2 px-4 py-4">
              <Skeleton className="h-10 w-full bg-surface-tertiary" />
              <Skeleton className="h-10 w-full bg-surface-tertiary" />
              <Skeleton className="h-10 w-full bg-surface-tertiary" />
            </div>
          ) : (
            <ListView
              entries={entries}
              onDoubleOpen={handleOpenEntry}
              onSelect={handleSelectEntry}
              selectedPath={selectedPath}
              standalone={standalone}
            />
          )}
        </div>
      </div>

      {activeError ? (
        <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-amber-700 dark:text-amber-100">
          {typeof activeError === "string"
            ? activeError
            : errorMessage(activeError, t("projectPicker.hostError"))}
        </div>
      ) : null}

      <div className="flex h-13 items-center justify-between border-t border-border bg-surface px-5">
        <div className="min-w-0 flex-1 overflow-hidden text-muted">
          <span className="truncate">{footerText}</span>
        </div>

        <div className="ml-4 flex shrink-0 items-center gap-2">
          <Button type="button" onPress={onRequestClose} variant="secondary">
            {t("projectPicker.cancel")}
          </Button>
          <Button
            type="button"
            onPress={() => void handleOpen()}
            className={cn(
              createProject.isPending ? "cursor-wait opacity-70" : ""
            )}
            data-testid="project-create-submit"
          >
            {t("projectPicker.open")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ListView({
  entries,
  onDoubleOpen,
  onSelect,
  selectedPath,
  standalone = false,
}: {
  entries: DirectoryEntry[]
  onDoubleOpen: (entry: DirectoryEntry) => void
  onSelect: (entry: DirectoryEntry) => void
  selectedPath: string
  standalone?: boolean
}) {
  const { t } = useTranslation()
  if (entries.length === 0) {
    return <EmptyState />
  }

  return (
    <table className="w-full border-collapse">
      <colgroup>
        <col className="w-1/2" />
        {!standalone ? <col className="w-1/3" /> : null}
        {!standalone ? <col className="w-1/6" /> : null}
      </colgroup>
      {!standalone ? (
        <thead className="text-sm text-muted">
          <tr className="border-b border-border">
            <th className="sticky top-0 bg-overlay px-6 py-4 text-left">
              {t("projectPicker.name")}
            </th>
            <th className="sticky top-0 bg-overlay px-6 py-4 text-left">
              {t("projectPicker.dateModified")}
            </th>
            <th className="sticky top-0 bg-overlay px-6 py-4 text-left">
              {t("projectPicker.size")}
            </th>
          </tr>
        </thead>
      ) : null}
      <tbody>
        {entries.map((entry) => {
          const Icon = entryIcon(entry)
          const selected =
            normalizePath(selectedPath) === normalizePath(entry.path)

          return (
            <tr
              key={entry.path}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onDoubleOpen(entry)}
              className={cn(
                // Single click previews eligibility in the footer; double click
                // navigates into directories for faster repo discovery.
                "cursor-pointer transition",
                selected
                  ? "bg-surface-tertiary"
                  : "bg-surface-tertiary/0 hover:bg-surface-tertiary"
              )}
            >
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <Icon
                    className={cn(
                      "size-5.5 shrink-0",
                      selected
                        ? "text-foreground"
                        : entry.isDirectory
                          ? "text-sky-400"
                          : "text-muted"
                    )}
                  />
                  <span
                    className={cn(
                      selected ? "text-foreground" : "text-foreground"
                    )}
                  >
                    {entry.name}
                  </span>
                </div>
              </td>
              {!standalone ? (
                <>
                  <td
                    className={cn(
                      "px-6 py-4",
                      selected ? "text-muted" : "text-muted"
                    )}
                  >
                    —
                  </td>
                  <td
                    className={cn(
                      "px-6 py-4",
                      selected ? "text-muted" : "text-muted"
                    )}
                  >
                    —
                  </td>
                </>
              ) : null}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-4 text-muted">
      <Folder className="size-8 opacity-30" />
      <span>{t("projectPicker.noResults")}</span>
    </div>
  )
}
