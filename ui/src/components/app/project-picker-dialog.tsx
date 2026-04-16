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
import { useNavigate } from "react-router-dom"

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
          icon: <HardDrive className="size-3.5 text-zinc-400" />,
          label: "Macintosh HD",
          path: systemRoot.path,
        }
      : null,
    homeRoot
      ? {
          icon: <Cloud className="size-3.5 text-zinc-400" />,
          label: "iCloud Drive",
          path: joinPath(homeRoot.path, "Documents"),
        }
      : null,
  ].filter(Boolean) as SidebarItemDef[]
}

export function ProjectPickerDialog() {
  const navigate = useNavigate()
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

  const navigateBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    navigate("/")
  }, [navigate])

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
      navigate("/")
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }, [canOpenFolder, createProject, navigate, previewMetadata, selectedRepoPath])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        navigateBack()
      }
      if (event.key === "Enter" && canOpenFolder) {
        void handleOpen()
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [canOpenFolder, handleOpen, navigateBack])

  const footerText = selectedPath
    ? previewMetadata?.basename || selectedPath
    : `${entries.length} item${entries.length === 1 ? "" : "s"}`

  const activeError = formError || rootsQuery.error || listingQuery.error || previewQuery.error

  return (
    <Dialog open onOpenChange={(open) => !open && navigateBack()}>
      <DialogContent
        showCloseButton={false}
        data-testid="project-picker-dialog"
        className="h-[min(960px,calc(100vh-48px))] !w-[min(1412px,calc(100vw-72px))] !max-w-[calc(100vw-72px)] gap-0 overflow-hidden rounded-[18px] border-0 bg-popover p-0 text-zinc-100 shadow-[0_32px_80px_rgba(0,0,0,0.8)] ring-0 sm:!max-w-[calc(100vw-72px)]"
      >
        <div className="flex h-full min-h-0 flex-col bg-popover">
          <div className="flex h-13 items-center gap-2 border-b border-border bg-card px-3">
            <button
              type="button"
              onClick={navigateBack}
              className="flex size-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-secondary hover:text-zinc-200"
              title="Close"
            >
              <X className="size-3.5" />
            </button>

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
                  <button
                    type="button"
                    onClick={() => openDirectory(crumb.path)}
                    className={cn(
                      "max-w-30 truncate rounded px-1 py-0.5 text-xs transition hover:bg-accent",
                      index === breadcrumbs.length - 1
                        ? "font-semibold text-zinc-100"
                        : "text-zinc-400"
                    )}
                  >
                    {crumb.label}
                  </button>
                  {index < breadcrumbs.length - 1 ? (
                    <ChevronRight className="size-3 shrink-0 text-zinc-500" />
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
              <Search className="size-3.5 shrink-0 text-zinc-500" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
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
            <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-100">
              {typeof activeError === "string" ? activeError : errorMessage(activeError)}
            </div>
          ) : null}

          <div className="flex h-13 items-center justify-between border-t border-border bg-card px-5">
            <div className="min-w-0 flex-1 overflow-hidden text-xs text-muted-foreground">
              <span className="truncate">{footerText}</span>
            </div>

            <div className="ml-4 flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={navigateBack}
                className="rounded-md bg-secondary px-4 py-1.5 text-sm text-foreground transition hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleOpen()}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium text-white transition",
                  createProject.isPending
                    ? "cursor-wait bg-picker/70"
                    : "bg-picker hover:bg-picker-hover"
                )}
                data-testid="project-create-submit"
              >
                Open
              </button>
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
      <div className="px-6 pb-2 pt-2 text-base font-semibold uppercase tracking-wider text-muted-foreground">
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
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 px-6 py-3 text-left text-2xl transition",
        active
          ? "bg-picker/25 text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
      style={{ borderRadius: 0 }}
    >
      {icon}
      <span
        className={cn(
          "truncate",
          active ? "font-semibold text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </button>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "flex size-10 items-center justify-center rounded-lg text-muted-foreground transition",
        disabled
          ? "cursor-not-allowed opacity-30"
          : active
            ? "bg-accent text-foreground"
            : "hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
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
    <table className="w-full border-collapse text-sm">
      <colgroup>
        <col className="w-[52%]" />
        <col className="w-[30%]" />
        <col className="w-[18%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-border">
          <th className="sticky top-0 bg-popover px-6 py-4 text-left text-base font-medium text-muted-foreground">
            Name
          </th>
          <th className="sticky top-0 bg-popover px-6 py-4 text-left text-base font-medium text-muted-foreground">
            Date Modified
          </th>
          <th className="sticky top-0 bg-popover px-6 py-4 text-left text-base font-medium text-muted-foreground">
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
                      "text-lg",
                      selected ? "text-white" : "text-foreground"
                    )}
                  >
                    {entry.name}
                  </span>
                </div>
              </td>
              <td
                className={cn(
                  "px-6 py-4 text-lg",
                  selected ? "text-white/75" : "text-muted-foreground"
                )}
              >
                —
              </td>
              <td
                className={cn(
                  "px-6 py-4 text-lg",
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
              "flex flex-col items-center gap-2 px-3 pb-3 pt-3 text-center transition",
              selected
                ? "rounded-lg bg-picker text-white"
                : "text-foreground hover:rounded-lg hover:bg-muted"
            )}
            style={{ width: "104px" }}
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
            <span className="line-clamp-2 text-xs leading-[1.3]">{entry.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-4 text-sm text-muted-foreground">
      <Folder className="size-8 opacity-30" />
      <span>No results</span>
    </div>
  )
}
