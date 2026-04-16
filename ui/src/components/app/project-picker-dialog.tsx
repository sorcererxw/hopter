import { useMemo, useState, type FormEvent } from "react"
import { useQueries, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  File,
  Folder,
  FolderGit2,
  HardDrive,
  Home,
  RefreshCcw,
  Search,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import type { DirectoryEntry, DirectoryListing, DirectoryRoot, PathMetadata } from "@/gen/proto/orchd/v1/host_pb"
import { useDirectoryRoots, usePathMetadata, useRecentRepos } from "@/features/host/use-host-browser"
import { useCreateProject } from "@/features/projects/use-projects"
import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type Breadcrumb = {
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

function parentPath(value: string) {
  const normalized = normalizePath(value)
  if (!normalized || normalized === "/") {
    return ""
  }

  const lastSlashIndex = normalized.lastIndexOf("/")
  if (lastSlashIndex <= 0) {
    return "/"
  }

  return normalized.slice(0, lastSlashIndex)
}

function isWithinRoot(rootPath: string, targetPath: string) {
  const normalizedRoot = normalizePath(rootPath)
  const normalizedTarget = normalizePath(targetPath)

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

function findContainingRoot(roots: DirectoryRoot[], targetPath: string) {
  const normalizedTarget = normalizePath(targetPath)

  return [...roots]
    .sort((left, right) => right.path.length - left.path.length)
    .find((root) => isWithinRoot(root.path, normalizedTarget))
}

function buildColumnPaths(roots: DirectoryRoot[], targetPath: string, isDirectory: boolean) {
  const normalizedTarget = normalizePath(targetPath)
  const root = findContainingRoot(roots, normalizedTarget)
  if (!root) {
    return []
  }

  const browsingPath = isDirectory ? normalizedTarget : parentPath(normalizedTarget)
  if (!browsingPath) {
    return [root.path]
  }

  if (normalizePath(root.path) === browsingPath) {
    return [root.path]
  }

  const relativePath = browsingPath.slice(normalizePath(root.path).length).replace(/^\/+/, "")
  if (!relativePath) {
    return [root.path]
  }

  const segments = relativePath.split("/").filter(Boolean)
  const columnPaths = [root.path]
  let currentPath = normalizePath(root.path)

  for (const segment of segments) {
    currentPath = currentPath === "/" ? `/${segment}` : `${currentPath}/${segment}`
    columnPaths.push(currentPath)
  }

  return columnPaths
}

function buildBreadcrumbs(roots: DirectoryRoot[], metadata?: PathMetadata): Breadcrumb[] {
  if (!metadata?.canonicalPath) {
    return []
  }

  const root = findContainingRoot(roots, metadata.canonicalPath)
  if (!root) {
    return []
  }

  const browsingPath = metadata.isDirectory ? metadata.canonicalPath : parentPath(metadata.canonicalPath)
  const breadcrumbs: Breadcrumb[] = [{ label: root.label, path: root.path }]

  if (!browsingPath || normalizePath(browsingPath) === normalizePath(root.path)) {
    return breadcrumbs
  }

  const relativePath = browsingPath.slice(normalizePath(root.path).length).replace(/^\/+/, "")
  const segments = relativePath.split("/").filter(Boolean)
  let currentPath = normalizePath(root.path)

  for (const segment of segments) {
    currentPath = currentPath === "/" ? `/${segment}` : `${currentPath}/${segment}`
    breadcrumbs.push({ label: segment, path: currentPath })
  }

  return breadcrumbs
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return "The host could not finish that request."
}

function formatCounts(metadata?: PathMetadata) {
  if (!metadata?.isDirectory) {
    return ""
  }

  const directoryCount = metadata.childDirectoryCount
  const fileCount = metadata.childFileCount

  if (!directoryCount && !fileCount) {
    return "Empty folder"
  }

  const parts = []
  if (directoryCount) {
    parts.push(`${directoryCount} folder${directoryCount === 1 ? "" : "s"}`)
  }
  if (fileCount) {
    parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`)
  }

  return parts.join(" · ")
}

function rootIcon(root: DirectoryRoot) {
  if (root.kind === "home") {
    return Home
  }
  return HardDrive
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

export function ProjectPickerDialog() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createProject = useCreateProject()
  const rootsQuery = useDirectoryRoots()
  const recentReposQuery = useRecentRepos()

  const [columnPaths, setColumnPaths] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState("")
  const [pathInput, setPathInput] = useState("")
  const [name, setName] = useState("")
  const [nameDirty, setNameDirty] = useState(false)
  const [search, setSearch] = useState("")
  const [formError, setFormError] = useState("")

  const roots = useMemo(() => rootsQuery.data ?? EMPTY_ROOTS, [rootsQuery.data])
  const activeSelectedPath = selectedPath || roots[0]?.path || ""
  const activeColumnPaths = columnPaths.length > 0 ? columnPaths : activeSelectedPath ? [activeSelectedPath] : []

  const columnQueries = useQueries({
    queries: activeColumnPaths.map((path) => ({
      queryKey: queryKeys.hostDirectory(path),
      enabled: path.trim().length > 0,
      queryFn: async () => {
        const response = await hostClient.listDirectory({ path })
        return response.listing as DirectoryListing | undefined
      },
    })),
  })

  const previewQuery = usePathMetadata(activeSelectedPath, Boolean(activeSelectedPath))
  const previewMetadata = previewQuery.data
  const breadcrumbs = useMemo(() => buildBreadcrumbs(roots, previewMetadata), [previewMetadata, roots])
  const selectedRepoPath =
    previewMetadata?.isDirectory && previewMetadata.isRepo && previewMetadata.isAllowed
      ? previewMetadata.canonicalPath
      : ""
  const displayedPathInput = pathInput || activeSelectedPath
  const displayedName = !nameDirty && previewMetadata?.isRepo ? previewMetadata.basename : name

  const activeBrowserError = formError || rootsQuery.error || previewQuery.error || columnQueries.find((query) => query.error)?.error
  const filteredSearch = search.trim().toLowerCase()
  const isBusy = createProject.isPending

  function navigateBack() {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    navigate("/")
  }

  function selectRoot(rootPath: string) {
    setFormError("")
    setSelectedPath(rootPath)
    setColumnPaths([rootPath])
    setPathInput(rootPath)
  }

  function selectEntry(columnIndex: number, entry: DirectoryEntry) {
    setFormError("")
    setSelectedPath(entry.path)
    setColumnPaths((current) => {
      const next = current.slice(0, columnIndex + 1)
      if (entry.isDirectory) {
        next.push(entry.path)
      }
      return next
    })
    setPathInput(entry.path)
  }

  async function selectPathFromInput(path: string) {
    if (!path.trim()) {
      return
    }

    try {
      const response = await hostClient.getPathMetadata({ path: path.trim() })
      const metadata = response.metadata
      if (!metadata?.canonicalPath) {
        return
      }

      const nextColumnPaths = buildColumnPaths(roots, metadata.canonicalPath, metadata.isDirectory)
      if (!nextColumnPaths.length) {
        setFormError("That path is outside the locations this host exposes to the browser.")
        return
      }

      setFormError("")
      setSelectedPath(metadata.canonicalPath)
      setColumnPaths(nextColumnPaths)
      setPathInput(metadata.canonicalPath)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  async function handleRefresh() {
    setFormError("")
    await queryClient.invalidateQueries({ queryKey: ["host"] })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    if (!selectedRepoPath) {
      setFormError("Pick a git repository before opening the project.")
      return
    }

    try {
      await createProject.mutateAsync({
        name: name.trim() || previewMetadata?.basename || "Project",
        rootPath: selectedRepoPath,
        defaultBackend: "codex",
      })
      navigate("/")
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && navigateBack()}>
      <DialogContent
        showCloseButton={false}
        data-testid="project-picker-dialog"
        className="h-[min(760px,calc(100vh-2rem))] w-[min(1120px,calc(100vw-2rem))] max-w-[min(1120px,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg border border-white/8 bg-[#1f1f1f] p-0 text-zinc-100 shadow-2xl ring-0 sm:max-w-[min(1120px,calc(100vw-2rem))]"
      >
        <DialogHeader className="border-b border-white/8 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold text-white">Add repo</DialogTitle>
              <DialogDescription className="text-sm text-zinc-400">
                Pick a git repository from the host machine, then open new Codex work from the same folder.
              </DialogDescription>
            </div>
            <div className="hidden items-center gap-2 rounded-md border border-white/8 bg-white/4 px-3 py-2 text-xs text-zinc-400 md:flex">
              <Search className="size-3.5" />
              Host-backed browser
            </div>
          </div>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="border-b border-white/8 px-6 py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/8 bg-white/4 px-3 py-2">
                {breadcrumbs.length > 0 ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
                    {breadcrumbs.map((crumb, index) => (
                      <div key={crumb.path} className="flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded px-1.5 py-0.5 text-zinc-300 transition hover:bg-white/8 hover:text-white"
                          onClick={() => {
                            setSelectedPath(crumb.path)
                            setColumnPaths(buildColumnPaths(roots, crumb.path, true))
                          }}
                        >
                          {crumb.label}
                        </button>
                        {index < breadcrumbs.length - 1 ? <ChevronRight className="size-3 text-zinc-500" /> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">Browse the host machine</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={displayedPathInput}
                  onChange={(event) => setPathInput(event.target.value)}
                  onKeyDown={async (event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      await selectPathFromInput(displayedPathInput)
                    }
                  }}
                  className="h-10 min-w-0 border-white/10 bg-black/20 text-zinc-100 placeholder:text-zinc-500 md:w-[26rem]"
                  placeholder="/Users/me/repo/orchd"
                  data-testid="project-picker-path-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/10 bg-white/4 text-zinc-100 hover:bg-white/10 hover:text-white"
                  onClick={() => void selectPathFromInput(displayedPathInput)}
                >
                  Go
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="border-white/10 bg-white/4 text-zinc-100 hover:bg-white/10 hover:text-white"
                  onClick={() => void handleRefresh()}
                >
                  <RefreshCcw className="size-4" />
                  <span className="sr-only">Refresh</span>
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {recentReposQuery.data?.map((repo) => (
                  <button
                    key={repo.canonicalPath}
                    type="button"
                    className="inline-flex max-w-full items-center gap-2 rounded-md border border-white/8 bg-white/4 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
                    onClick={() => void selectPathFromInput(repo.canonicalPath)}
                  >
                    <FolderGit2 className="size-3.5 shrink-0" />
                    <span className="truncate">{repo.basename}</span>
                  </button>
                ))}
              </div>

              <div className="flex w-full items-center gap-2 rounded-md border border-white/8 bg-white/4 px-3 py-2 xl:max-w-xs">
                <Search className="size-4 text-zinc-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                  placeholder="Search visible items"
                />
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-h-0 overflow-hidden border-b border-white/8 xl:border-r xl:border-b-0">
              <div className="h-full overflow-x-auto overflow-y-hidden">
                <div className="flex h-full min-w-max gap-0">
                  <div className="flex h-full w-64 shrink-0 flex-col border-r border-white/8">
                    <div className="border-b border-white/8 px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                      Favorites
                    </div>
                    <div className="flex-1 overflow-y-auto px-2 py-2" data-testid="project-picker-roots-column">
                      {rootsQuery.isLoading ? (
                        <div className="space-y-2 px-2 pt-2">
                          <Skeleton className="h-8 w-full bg-white/8" />
                          <Skeleton className="h-8 w-full bg-white/8" />
                          <Skeleton className="h-8 w-full bg-white/8" />
                        </div>
                      ) : (
                        roots.map((root) => {
                          const Icon = rootIcon(root)
                          const selected = activeColumnPaths[0] === root.path
                          return (
                            <button
                              key={root.path}
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-zinc-300 transition hover:bg-white/8 hover:text-white",
                                selected && "bg-[#0a61d0] text-white hover:bg-[#0a61d0]"
                              )}
                              onClick={() => selectRoot(root.path)}
                            >
                              <Icon className="size-4 shrink-0" />
                              <span className="truncate">{root.label}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>

                  {activeColumnPaths.map((path, columnIndex) => {
                    const query = columnQueries[columnIndex]
                    const listing = query?.data
                    const entries =
                      listing?.entries.filter((entry) =>
                        filteredSearch ? entry.name.toLowerCase().includes(filteredSearch) : true
                      ) ?? []

                    return (
                      <div
                        key={path}
                        className="flex h-full w-72 shrink-0 flex-col border-r border-white/8"
                        data-testid={`project-picker-column-${columnIndex}`}
                      >
                        <div className="border-b border-white/8 px-4 py-3 text-sm font-medium text-zinc-300">
                          {listing?.currentPath || path}
                        </div>
                        <div className="flex-1 overflow-y-auto px-2 py-2">
                          {query?.isLoading ? (
                            <div className="space-y-2 px-2 pt-2">
                              <Skeleton className="h-8 w-full bg-white/8" />
                              <Skeleton className="h-8 w-full bg-white/8" />
                              <Skeleton className="h-8 w-full bg-white/8" />
                            </div>
                          ) : entries.length > 0 ? (
                            entries.map((entry) => {
                              const Icon = entryIcon(entry)
                              const selected = activeSelectedPath === entry.path || activeColumnPaths[columnIndex + 1] === entry.path

                              return (
                                <button
                                  key={entry.path}
                                  type="button"
                                  className={cn(
                                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-zinc-300 transition hover:bg-white/8 hover:text-white",
                                    selected && "bg-[#0a61d0] text-white hover:bg-[#0a61d0]"
                                  )}
                                  onClick={() => selectEntry(columnIndex, entry)}
                                >
                                  <Icon className="size-4 shrink-0" />
                                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                                  {entry.isRepo ? (
                                    <Badge className="border-0 bg-emerald-500/20 text-emerald-200">Repo</Badge>
                                  ) : null}
                                  {entry.isDirectory ? <ChevronRight className="size-3.5 shrink-0 text-current/70" /> : null}
                                </button>
                              )
                            })
                          ) : (
                            <div className="px-3 py-4 text-sm text-zinc-500">
                              {filteredSearch ? "No visible items match this search." : "Nothing to show here."}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <aside className="flex min-h-0 flex-col bg-black/12">
              <div className="border-b border-white/8 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Preview</p>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" data-testid="project-picker-preview">
                {previewQuery.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-32 bg-white/8" />
                    <Skeleton className="h-20 w-full bg-white/8" />
                    <Skeleton className="h-24 w-full bg-white/8" />
                  </div>
                ) : previewMetadata ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        {previewMetadata.isRepo ? (
                          <FolderGit2 className="size-5 text-emerald-300" />
                        ) : previewMetadata.isDirectory ? (
                          <Folder className="size-5 text-sky-300" />
                        ) : (
                          <File className="size-5 text-zinc-400" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-white">{previewMetadata.basename}</p>
                          <p className="truncate text-xs text-zinc-500">{previewMetadata.canonicalPath}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge className={cn("border-0", previewMetadata.isAllowed ? "bg-sky-500/20 text-sky-100" : "bg-amber-500/20 text-amber-100")}>
                        {previewMetadata.isAllowed ? "Visible to browser" : "Outside allowed roots"}
                      </Badge>
                      {previewMetadata.isRepo ? (
                        <Badge className="border-0 bg-emerald-500/20 text-emerald-100">Git repository</Badge>
                      ) : previewMetadata.isDirectory ? (
                        <Badge className="border-0 bg-white/8 text-zinc-200">Folder only</Badge>
                      ) : (
                        <Badge className="border-0 bg-white/8 text-zinc-200">File</Badge>
                      )}
                    </div>

                    <div className="rounded-md border border-white/8 bg-white/4 p-4">
                      <p className="text-sm font-medium text-white">
                        {selectedRepoPath
                          ? "Ready to open as a project."
                          : previewMetadata.isDirectory
                            ? "This folder is visible, but it is not a git repository yet."
                            : "Pick a folder to open a project."}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">{formatCounts(previewMetadata) || "No folder details yet."}</p>
                    </div>

                    <div className="space-y-2 rounded-md border border-white/8 bg-white/4 p-4 text-sm text-zinc-300">
                      <p className="font-medium text-white">Project name</p>
                      <Input
                        value={displayedName}
                        onChange={(event) => {
                          setNameDirty(true)
                          setName(event.target.value)
                        }}
                        className="border-white/10 bg-black/20 text-zinc-100 placeholder:text-zinc-500"
                        placeholder="Use the repo folder name"
                        data-testid="project-name-input"
                      />
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-dashed border-white/10 bg-white/3 p-4 text-sm leading-6 text-zinc-500">
                    Pick a folder in the browser to inspect it here.
                  </div>
                )}
              </div>
            </aside>
          </div>

          {activeBrowserError ? (
            <div className="border-t border-amber-500/20 bg-amber-500/8 px-6 py-3 text-sm text-amber-100">
              {typeof activeBrowserError === "string" ? activeBrowserError : errorMessage(activeBrowserError)}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-white/8 bg-[#181818] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm text-zinc-400">
              <p className="truncate">{selectedRepoPath || previewMetadata?.canonicalPath || "No folder selected"}</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="border-white/10 bg-white/4 text-zinc-100 hover:bg-white/10 hover:text-white"
                  onClick={() => navigateBack()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isBusy || !selectedRepoPath}
                className="bg-[#0a61d0] text-white hover:bg-[#0a61d0]/90"
                data-testid="project-create-submit"
              >
                Open project
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
