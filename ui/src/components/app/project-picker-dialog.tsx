import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  File,
  FileText,
  Film,
  Folder,
  FolderGit2,
  Grid2x2,
  HardDrive,
  Home,
  Image,
  List,
  Monitor,
  Music,
  RefreshCcw,
  Search,
  X,
} from "lucide-react"

import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import type { DirectoryEntry, DirectoryRoot } from "@/gen/proto/orchd/v1/host_pb"
import {
  useDirectoryListing,
  useDirectoryRoots,
  usePathMetadata,
} from "@/features/host/use-host-browser"
import { useCreateProject } from "@/features/projects/use-projects"
import { queryClient } from "@/lib/query/client"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type Breadcrumb = {
  label: string
  path: string
}

type SidebarItemDef = {
  icon: ReactNode
  label: string
  path: string
}

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

function joinPath(base: string, segment: string) {
  const normalizedBase = normalizePath(base)
  if (!normalizedBase || normalizedBase === "/") {
    return `/${segment}`
  }
  return `${normalizedBase}/${segment}`
}

function buildBreadcrumbs(path: string): Breadcrumb[] {
  const normalized = normalizePath(path)
  const segments = normalized.split("/").filter(Boolean)
  let current = ""

  return segments.map((segment) => {
    current = `${current}/${segment}`
    return { label: segment, path: current }
  })
}

function inferDefaultPath(roots: DirectoryRoot[]) {
  const homeRoot = roots.find((root) => root.kind === "home")
  if (homeRoot) {
    return joinPath(homeRoot.path, "Downloads")
  }
  return roots[0]?.path || ""
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return "The host could not finish that request."
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

function makeFavorites(roots: DirectoryRoot[]) {
  const homeRoot = roots.find((root) => root.kind === "home")
  if (!homeRoot) {
    return []
  }

  return [
    { icon: <Home className="size-3.5 text-sky-400" />, label: "Home", path: homeRoot.path },
    {
      icon: <Monitor className="size-3.5 text-sky-400" />,
      label: "Desktop",
      path: joinPath(homeRoot.path, "Desktop"),
    },
    {
      icon: <FileText className="size-3.5 text-sky-400" />,
      label: "Documents",
      path: joinPath(homeRoot.path, "Documents"),
    },
    {
      icon: <Download className="size-3.5 text-sky-400" />,
      label: "Downloads",
      path: joinPath(homeRoot.path, "Downloads"),
    },
    {
      icon: <Image className="size-3.5 text-sky-400" />,
      label: "Pictures",
      path: joinPath(homeRoot.path, "Pictures"),
    },
    {
      icon: <Music className="size-3.5 text-sky-400" />,
      label: "Music",
      path: joinPath(homeRoot.path, "Music"),
    },
    {
      icon: <Film className="size-3.5 text-sky-400" />,
      label: "Movies",
      path: joinPath(homeRoot.path, "Movies"),
    },
  ] satisfies SidebarItemDef[]
}

function makeLocations(roots: DirectoryRoot[]) {
  const systemRoot = roots.find((root) => root.kind !== "home") ?? roots[0]
  const homeRoot = roots.find((root) => root.kind === "home")

  return [
    systemRoot
      ? {
          icon: <HardDrive className="size-3.5 text-muted-foreground" />,
          label: "Macintosh HD",
          path: systemRoot.path,
        }
      : null,
    homeRoot
      ? {
          icon: <Cloud className="size-3.5 text-muted-foreground" />,
          label: "iCloud Drive",
          path: joinPath(homeRoot.path, "Documents"),
        }
      : null,
  ].filter(Boolean) as SidebarItemDef[]
}

export function ProjectPickerDialog({ open }: { open: boolean }) {
  const { closeProjectPicker } = useWorkspaceShell()
  const createProject = useCreateProject()
  const rootsQuery = useDirectoryRoots()

  const roots = useMemo(() => rootsQuery.data ?? EMPTY_ROOTS, [rootsQuery.data])
  const defaultPath = useMemo(() => inferDefaultPath(roots), [roots])

  const [currentPath, setCurrentPath] = useState("")
  const [selectedPath, setSelectedPath] = useState("")
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"list" | "grid">("list")
  const [formError, setFormError] = useState("")

  const activePath = currentPath || defaultPath
  const listingQuery = useDirectoryListing(activePath, Boolean(activePath))
  const previewPath = selectedPath || activePath
  const previewQuery = usePathMetadata(previewPath, Boolean(previewPath))
  const previewMetadata = previewQuery.data
  const breadcrumbs = useMemo(() => buildBreadcrumbs(activePath), [activePath])
  const favorites = useMemo(() => makeFavorites(roots), [roots])
  const locations = useMemo(() => makeLocations(roots), [roots])

  const canOpenFolder = Boolean(previewMetadata?.isDirectory && previewMetadata?.isAllowed)
  const selectedRepoPath =
    previewMetadata?.isDirectory && previewMetadata.isRepo && previewMetadata.isAllowed
      ? previewMetadata.canonicalPath
      : ""
  const entries = useMemo(() => {
    const allEntries = listingQuery.data?.entries ?? []
    const query = searchQuery.trim().toLowerCase()
    return query
      ? allEntries.filter((entry) => entry.name.toLowerCase().includes(query))
      : allEntries
  }, [listingQuery.data?.entries, searchQuery])

  const openDirectory = useCallback((path: string, options?: { fromHistory?: boolean }) => {
    const normalized = normalizePath(path)
    setFormError("")
    setCurrentPath(normalized)
    setSelectedPath("")

    if (options?.fromHistory) {
      return
    }

    setHistory((current) => {
      const base = historyIndex >= 0 ? current.slice(0, historyIndex + 1) : []
      const next = [...base, normalized]
      return next
    })
    setHistoryIndex((current) => current + 1)
  }, [historyIndex])

  const goBack = useCallback(() => {
    if (historyIndex <= 0) {
      return
    }

    const nextIndex = historyIndex - 1
    const nextPath = history[nextIndex]
    setHistoryIndex(nextIndex)
    openDirectory(nextPath, { fromHistory: true })
  }, [history, historyIndex, openDirectory])

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) {
      return
    }

    const nextIndex = historyIndex + 1
    const nextPath = history[nextIndex]
    setHistoryIndex(nextIndex)
    openDirectory(nextPath, { fromHistory: true })
  }, [history, historyIndex, openDirectory])

  const handleSelectEntry = useCallback((entry: DirectoryEntry) => {
    setSelectedPath(entry.path)
  }, [])

  const handleOpenEntry = useCallback((entry: DirectoryEntry) => {
    setSelectedPath(entry.path)
    if (entry.isDirectory) {
      openDirectory(entry.path)
    }
  }, [openDirectory])

  const handleRefresh = useCallback(async () => {
    setFormError("")
    await queryClient.invalidateQueries({ queryKey: ["host"] })
  }, [])

  const handleOpen = useCallback(async () => {
    setFormError("")

    if (!canOpenFolder) {
      setFormError("Pick a visible folder before opening the project.")
      return
    }

    if (!selectedRepoPath) {
      setFormError("This folder is visible, but it is not a git repository.")
      return
    }

    try {
      await createProject.mutateAsync({
        defaultBackend: "codex",
        name: previewMetadata?.basename || "Project",
        rootPath: selectedRepoPath,
      })
      closeProjectPicker()
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }, [canOpenFolder, closeProjectPicker, createProject, previewMetadata, selectedRepoPath])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeProjectPicker()
      }
      if (event.key === "Enter" && canOpenFolder) {
        void handleOpen()
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [canOpenFolder, closeProjectPicker, handleOpen])

  const footerText = selectedPath
    ? previewMetadata?.basename || selectedPath
    : `${entries.length} item${entries.length === 1 ? "" : "s"}`

  const activeError = formError || rootsQuery.error || listingQuery.error || previewQuery.error

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeProjectPicker()}>
      <DialogContent
        showCloseButton={false}
        data-testid="project-picker-dialog"
        className="inset-0 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 rounded-none border-0 bg-transparent p-4 text-base text-foreground ring-0 sm:max-w-none md:p-6 lg:p-8"
      >
        <div className="flex h-full min-h-0 w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-border bg-popover">
          <div className="flex h-13 items-center gap-2 border-b border-border bg-card px-3 text-sm font-medium text-foreground">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={closeProjectPicker}
              className="text-muted-foreground"
              title="Close"
            >
              <X className="size-3.5" />
            </Button>

            <div className="flex items-center gap-0.5">
              <ToolbarButton disabled={historyIndex <= 0} onClick={goBack}>
                <ChevronLeft className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton disabled={historyIndex >= history.length - 1} onClick={goForward}>
                <ChevronRight className="size-3.5" />
              </ToolbarButton>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
              {breadcrumbs.map((crumb, index) => (
                <div key={crumb.path} className="flex min-w-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant={index === breadcrumbs.length - 1 ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => openDirectory(crumb.path)}
                    className={cn(
                      "max-w-30 justify-start truncate px-1 py-0.5",
                      index === breadcrumbs.length - 1
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {crumb.label}
                  </Button>
                  {index < breadcrumbs.length - 1 ? (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mr-1 flex items-center gap-0.5">
              <ToolbarButton active={viewMode === "list"} onClick={() => setViewMode("list")}>
                <List className="size-3.5" />
              </ToolbarButton>
              <ToolbarButton active={viewMode === "grid"} onClick={() => setViewMode("grid")}>
                <Grid2x2 className="size-3.5" />
              </ToolbarButton>
            </div>

            <div className="flex w-68 items-center gap-2 rounded-xl bg-accent px-4 py-2.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Search"
              />
            </div>

            <ToolbarButton onClick={() => void handleRefresh()} title="Refresh">
              <RefreshCcw className="size-3.5" />
            </ToolbarButton>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar py-6">
              <SidebarSection label="Favorites">
                {favorites.map((item) => (
                  <SidebarItem
                    key={item.path}
                    active={normalizePath(activePath) === normalizePath(item.path)}
                    icon={item.icon}
                    label={item.label}
                    onClick={() => openDirectory(item.path)}
                  />
                ))}
              </SidebarSection>

              <SidebarSection label="Locations">
                {locations.map((item) => (
                  <SidebarItem
                    key={item.path}
                    active={normalizePath(activePath) === normalizePath(item.path)}
                    icon={item.icon}
                    label={item.label}
                    onClick={() => openDirectory(item.path)}
                  />
                ))}
              </SidebarSection>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-popover">
              {listingQuery.isLoading ? (
                <div className="space-y-2 px-4 py-4">
                  <Skeleton className="h-10 w-full bg-accent" />
                  <Skeleton className="h-10 w-full bg-accent" />
                  <Skeleton className="h-10 w-full bg-accent" />
                </div>
              ) : viewMode === "list" ? (
                <ListView
                  entries={entries}
                  onDoubleOpen={handleOpenEntry}
                  onSelect={handleSelectEntry}
                  selectedPath={selectedPath}
                />
              ) : (
                <GridView
                  entries={entries}
                  onDoubleOpen={handleOpenEntry}
                  onSelect={handleSelectEntry}
                  selectedPath={selectedPath}
                />
              )}
            </div>
          </div>

          {activeError ? (
            <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-amber-700 dark:text-amber-100">
              {typeof activeError === "string" ? activeError : errorMessage(activeError)}
            </div>
          ) : null}

          <div className="flex h-13 items-center justify-between border-t border-border bg-card px-5">
            <div className="min-w-0 flex-1 overflow-hidden text-muted-foreground">
              <span className="truncate">{footerText}</span>
            </div>

            <div className="ml-4 flex shrink-0 items-center gap-2">
              <Button
                type="button"
                onClick={closeProjectPicker}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleOpen()}
                className={cn(
                  "text-white",
                  createProject.isPending
                    ? "cursor-wait bg-picker/70"
                    : "bg-picker hover:bg-picker-hover"
                )}
                data-testid="project-create-submit"
              >
                Open
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SidebarSection({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className="mb-3">
      <div className="px-6 pb-2 pt-2 text-xs font-normal uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  )
}

function SidebarItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      className={cn(
        "h-auto w-full justify-start gap-4 rounded-none px-6 py-3 text-left transition",
        active
          ? "bg-picker/25 text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
    >
      {icon}
        <span className={cn("truncate", active ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
    </Button>
  )
}

function ToolbarButton({
  active = false,
  children,
  disabled = false,
  onClick,
  title,
}: {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  title?: string
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      variant={active ? "secondary" : "ghost"}
      size="icon-lg"
      className={cn(
        "text-muted-foreground",
        disabled
          ? "cursor-not-allowed opacity-30"
          : active
            ? "text-foreground"
            : "hover:text-foreground"
      )}
    >
      {children}
    </Button>
  )
}

function ListView({
  entries,
  onDoubleOpen,
  onSelect,
  selectedPath,
}: {
  entries: DirectoryEntry[]
  onDoubleOpen: (entry: DirectoryEntry) => void
  onSelect: (entry: DirectoryEntry) => void
  selectedPath: string
}) {
  if (entries.length === 0) {
    return <EmptyState />
  }

  return (
    <table className="w-full border-collapse">
      <colgroup>
        <col className="w-1/2" />
        <col className="w-1/3" />
        <col className="w-1/6" />
      </colgroup>
      <thead className="text-sm font-normal text-muted-foreground">
        <tr className="border-b border-border">
          <th className="sticky top-0 bg-popover px-6 py-4 text-left">
            Name
          </th>
          <th className="sticky top-0 bg-popover px-6 py-4 text-left">
            Date Modified
          </th>
          <th className="sticky top-0 bg-popover px-6 py-4 text-left">
            Size
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const Icon = entryIcon(entry)
          const selected = normalizePath(selectedPath) === normalizePath(entry.path)

          return (
            <tr
              key={entry.path}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onDoubleOpen(entry)}
              className={cn("cursor-pointer transition", selected ? "bg-picker" : "hover:bg-muted")}
            >
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <Icon
                    className={cn(
                      "size-5.5 shrink-0",
                      selected
                        ? "text-white"
                        : entry.isDirectory
                          ? "text-sky-400"
                          : "text-muted-foreground"
                    )}
                  />
                  <span
                    className={cn(
                      selected ? "text-white" : "text-foreground"
                    )}
                  >
                    {entry.name}
                  </span>
                </div>
              </td>
              <td
                className={cn(
                  "px-6 py-4",
                  selected ? "text-white/75" : "text-muted-foreground"
                )}
              >
                —
              </td>
              <td
                className={cn(
                  "px-6 py-4",
                  selected ? "text-white/75" : "text-muted-foreground"
                )}
              >
                —
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function GridView({
  entries,
  onDoubleOpen,
  onSelect,
  selectedPath,
}: {
  entries: DirectoryEntry[]
  onDoubleOpen: (entry: DirectoryEntry) => void
  onSelect: (entry: DirectoryEntry) => void
  selectedPath: string
}) {
  if (entries.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="flex flex-wrap gap-2 p-4">
      {entries.map((entry) => {
        const Icon = entryIcon(entry)
        const selected = normalizePath(selectedPath) === normalizePath(entry.path)

        return (
          <button
            key={entry.path}
            type="button"
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onDoubleOpen(entry)}
            className={cn(
              "flex w-26 flex-col items-center gap-2 px-3 pb-3 pt-3 text-center transition",
              selected
                ? "rounded-lg bg-picker text-white"
                : "text-foreground hover:rounded-lg hover:bg-muted"
            )}
          >
            <Icon
              className={cn(
                "size-10",
                selected
                  ? "text-white"
                  : entry.isDirectory
                    ? "text-sky-400"
                    : "text-muted-foreground"
              )}
            />
            <span className="line-clamp-2 leading-tight">{entry.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-4 text-muted-foreground">
      <Folder className="size-8 opacity-30" />
      <span>No results</span>
    </div>
  )
}
