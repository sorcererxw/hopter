import { useEffect, useMemo, useState } from "react";
import { Folder, FolderOpen, GitBranch, RefreshCcw, Search, ChevronRight } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { HostFsList, HostFsRecentRepo, HostFsRoots, ProjectBindingView } from "@/lib/contracts";
import { cn, toUserFacingError } from "@/lib/utils";

type ColumnModel = {
  path: string;
  listing: HostFsList;
};

export function AddRepoDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (binding: ProjectBindingView) => void;
}) {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [roots, setRoots] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnModel[]>([]);
  const [recentRepos, setRecentRepos] = useState<HostFsRecentRepo[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selectedEntry = useMemo(() => {
    for (const column of columns) {
      const match = column.listing.entries.find((entry) => entry.path === selectedPath);
      if (match) {
        return match;
      }
    }
    return null;
  }, [columns, selectedPath]);

  const breadcrumb = useMemo(() => {
    if (!selectedPath) {
      return [] as string[];
    }
    const parts = selectedPath.split("/").filter(Boolean);
    const items: string[] = selectedPath.startsWith("/") ? ["/"] : [];
    let acc = selectedPath.startsWith("/") ? "" : "";
    for (const part of parts) {
      acc = `${acc}/${part}`;
      items.push(acc);
    }
    return items;
  }, [selectedPath]);

  const filteredRecentRepos = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return recentRepos;
    }
    return recentRepos.filter((repo) => `${repo.name} ${repo.path}`.toLowerCase().includes(query));
  }, [recentRepos, search]);

  const loadRoots = async () => {
    const [rootsPayload, recentPayload] = await Promise.all([
      api.get<HostFsRoots>("/api/host/fs/roots"),
      api.get<{ items: HostFsRecentRepo[] }>("/api/host/fs/recent-repos"),
    ]);
    setRoots(rootsPayload.items);
    setRecentRepos(recentPayload.items);
    return rootsPayload.items;
  };

  const loadColumn = async (path: string) => {
    return api.get<HostFsList>(`/api/host/fs/list?path=${encodeURIComponent(path)}`);
  };

  const openPathAsColumn = async (path: string, columnIndex: number) => {
    const listing = await loadColumn(path);
    setColumns((current) => {
      const next = current.slice(0, columnIndex);
      next.push({ path: listing.currentPath, listing });
      return next;
    });
    setSelectedPath(listing.currentPath);
    setRepoPath(listing.currentPath);
    if (!name.trim()) {
      setName(listing.currentPath.split("/").filter(Boolean).at(-1) ?? "repo");
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const nextRoots = await loadRoots();
        const firstRoot = nextRoots[0];
        if (!firstRoot) {
          setColumns([]);
          setSelectedPath(null);
          setRepoPath("");
          return;
        }
        const firstListing = await loadColumn(firstRoot);
        if (cancelled) return;
        setColumns([{ path: firstListing.currentPath, listing: firstListing }]);
        setSelectedPath(firstListing.currentPath);
        setRepoPath(firstListing.currentPath);
        if (!name.trim()) {
          setName(firstListing.currentPath.split("/").filter(Boolean).at(-1) ?? "repo");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(toUserFacingError("Could not read host directories", nextError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,1320px)] gap-0 p-0">
        <DialogHeader className="space-y-2 p-6 pb-4">
          <DialogTitle>Add repo</DialogTitle>
          <DialogDescription>
            Finder-style host browser. Every directory you see comes from the server, so the selected path is always a real host path.
          </DialogDescription>
        </DialogHeader>

        <div className="border-y border-border px-6 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {breadcrumb.length === 0 ? <span>/</span> : breadcrumb.map((crumb, index) => (
                <div key={`${crumb}-${index}`} className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md px-1 py-0.5 hover:bg-accent hover:text-foreground"
                    onClick={() => void openPathAsColumn(crumb, index + 1)}
                  >
                    {crumb === "/" ? "/" : crumb.split("/").filter(Boolean).at(-1)}
                  </button>
                  {index < breadcrumb.length - 1 ? <ChevronRight className="size-3" /> : null}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-full min-w-[240px] lg:w-[320px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recent repos" className="pl-9" />
              </div>
              <Button type="button" variant="secondary" onClick={() => void openPathAsColumn(columns[0]?.listing.currentPath ?? roots[0] ?? "/", 1)}>
                <RefreshCcw className="size-4" />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-6 lg:grid-cols-[280px_minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repo-context-name">Context name</Label>
              <Input id="repo-context-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="orchd" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repo-context-path">Selected path</Label>
              <Input id="repo-context-path" value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="/Users/me/src/orchd" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Roots</p>
              <div className="flex flex-wrap gap-2">
                {roots.map((root) => (
                  <Button key={root} type="button" variant="outline" size="sm" onClick={() => void openPathAsColumn(root, 1)}>
                    {root}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recent repos</p>
              <div className="space-y-2">
                {filteredRecentRepos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent repos match.</p>
                ) : filteredRecentRepos.map((repo) => (
                  <button
                    key={repo.path}
                    type="button"
                    onClick={() => {
                      setName((current) => current || repo.name);
                      setSelectedPath(repo.path);
                      setRepoPath(repo.path);
                    }}
                    className="flex w-full flex-col rounded-2xl border border-border bg-muted/25 px-3 py-3 text-left transition hover:border-primary/40 hover:bg-accent/40"
                  >
                    <span className="text-sm font-medium text-foreground">{repo.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{repo.path}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[24px] border border-border bg-card/70">
            <div className="flex h-[54vh] overflow-x-auto overflow-y-hidden">
              {loading ? (
                <div className="flex w-full items-center justify-center text-sm text-muted-foreground">Reading host directories…</div>
              ) : columns.map((column, columnIndex) => (
                <div key={column.path} className="min-w-[260px] border-r border-border last:border-r-0">
                  <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {column.path === "/" ? "Root" : column.path.split("/").filter(Boolean).at(-1)}
                  </div>
                  <div className="space-y-1 p-2">
                    {column.listing.entries.map((entry) => {
                      const isActive = selectedPath === entry.path;
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={async () => {
                            setSelectedPath(entry.path);
                            setRepoPath(entry.path);
                            if (!name.trim()) {
                              setName(entry.name);
                            }
                            if (entry.hasChildren) {
                              await openPathAsColumn(entry.path, columnIndex + 2);
                            } else {
                              setColumns((current) => current.slice(0, columnIndex + 1));
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition",
                            isActive ? "bg-primary/10 text-foreground" : "hover:bg-accent/40 text-foreground",
                          )}
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            {entry.hasChildren ? <FolderOpen className="size-4 text-primary/90" /> : <Folder className="size-4 text-muted-foreground" />}
                            <span className="truncate text-sm">{entry.name}</span>
                            {entry.isRepo ? <Badge variant="secondary">Repo</Badge> : null}
                          </div>
                          {entry.hasChildren ? <ChevronRight className="size-4 text-muted-foreground" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-[24px] border border-border bg-card/70 p-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Preview</p>
              <p className="text-sm font-medium text-foreground">{selectedPath ? selectedPath.split("/").filter(Boolean).at(-1) ?? "/" : "Nothing selected"}</p>
              <p className="break-all text-xs text-muted-foreground">{selectedPath ?? "Pick a folder from the columns."}</p>
            </div>

            {selectedEntry ? (
              <div className="space-y-2 rounded-2xl border border-border bg-background/60 p-3 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <GitBranch className="size-4" />
                  <span>{selectedEntry.isRepo ? "Git repo detected" : "Not a git repo yet"}</span>
                </div>
                <p className="text-muted-foreground">{selectedEntry.hasChildren ? "You can keep drilling right like Finder column view." : "Leaf folder. You can still connect it if it is the repo you want."}</p>
              </div>
            ) : null}

            <div className="rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground">
              Finder-style rule: earlier columns stay visible so you never lose where you came from.
            </div>
          </div>
        </div>

        <div className="px-6 pb-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Directory browser failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                const result = await api.post<{ binding: ProjectBindingView }>("/api/bindings", {
                  name,
                  repoPath,
                  defaultBackend: "codex",
                });
                onCreated(result.binding);
              } catch (submissionError) {
                setError(toUserFacingError("Could not connect this repo context", submissionError));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Connecting…" : "Connect repo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
