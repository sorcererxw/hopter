import { useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutPanelLeft, MessageSquarePlus, FolderPlus, Search, Settings, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/orchd/status-badge";
import { SessionCreateComposer } from "@/components/orchd/session-create-composer";
import { ThemeControls } from "@/components/orchd/theme-controls";
import type { AuthMe, HostStatus, ProjectBindingView, ShellSessionItem } from "@/lib/contracts";
import { cn } from "@/lib/utils";

function titleForSession(session: ShellSessionItem) {
  return session.title ?? session.lastSummary ?? session.context.name;
}

function subtitleForSession(session: ShellSessionItem) {
  return session.lastSummary ?? session.context.name;
}

export function SidebarShell({
  auth,
  host,
  contexts,
  sessions,
  attentionSessions,
  collapsed,
  currentSessionId,
  onToggleCollapsed,
  compact = false,
}: {
  auth: AuthMe;
  host: HostStatus | null;
  contexts: ProjectBindingView[];
  sessions: ShellSessionItem[];
  attentionSessions: ShellSessionItem[];
  collapsed: boolean;
  currentSessionId?: string | null;
  onToggleCollapsed: () => void;
  compact?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return sessions;
    }
    return sessions.filter((session) => {
      const haystack = [titleForSession(session), subtitleForSession(session), session.context.name, session.context.repoPath]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sessions, search]);

  const visibleAttention = useMemo(() => {
    const ids = new Set(filteredSessions.map((session) => session.id));
    return attentionSessions.filter((session) => ids.has(session.id)).slice(0, 6);
  }, [attentionSessions, filteredSessions]);

  return (
    <div className={cn("flex h-full flex-col gap-4", collapsed && !compact && "items-center") }>
      <div className={cn("space-y-3", collapsed && !compact && "w-full") }>
        <div className={cn("flex items-center gap-2", collapsed && !compact ? "justify-center" : "justify-between")}>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="size-4" />
            </div>
            {(!collapsed || compact) ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/90">orchd</p>
                <p className="text-sm text-muted-foreground">Session-first remote Codex UI</p>
              </div>
            ) : null}
          </div>
          {!compact ? (
            <Button variant="ghost" size="icon" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </Button>
          ) : null}
        </div>

        {(!collapsed || compact) ? (
          <>
            <div className="flex flex-col gap-2">
              <Button onClick={() => setComposerOpen((current) => !current)} className="justify-start rounded-2xl">
                <MessageSquarePlus className="size-4" />
                New session
              </Button>
              <Button asChild variant="ghost" className="justify-start rounded-2xl">
                <Link to="/bindings/new">
                  <FolderPlus className="size-4" />
                  Add repo
                </Link>
              </Button>
            </div>
            {composerOpen ? <SessionCreateComposer compact className="bg-background/70" contexts={contexts} /> : null}
            <label className="flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
              <Search className="size-4" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search sessions"
                className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </>
        ) : (
          <div className="flex w-full flex-col items-center gap-2">
            <Button size="icon" onClick={() => setComposerOpen((current) => !current)}>
              <MessageSquarePlus className="size-4" />
            </Button>
            <Button asChild size="icon" variant="ghost">
              <Link to="/bindings/new">
                <FolderPlus className="size-4" />
              </Link>
            </Button>
            <Button asChild size="icon" variant="ghost">
              <Link to="/settings">
                <Settings className="size-4" />
              </Link>
            </Button>
            {composerOpen ? <SessionCreateComposer compact className="w-[280px] self-start" contexts={contexts} /> : null}
          </div>
        )}
      </div>

      {(!collapsed || compact) ? (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Needs you</p>
              {attentionSessions.length > 0 ? <Badge variant="warning">{attentionSessions.length}</Badge> : null}
            </div>
            {visibleAttention.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                Nothing is blocked right now.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleAttention.map((session) => (
                  <button
                    key={`attention-${session.id}`}
                    type="button"
                    onClick={() => navigate(`/backend-sessions/${session.id}`)}
                    className={cn(
                      "flex w-full flex-col gap-2 rounded-2xl border px-3 py-3 text-left transition",
                      currentSessionId === session.id ? "border-primary/60 bg-primary/10" : "border-border bg-card/70 hover:border-primary/30 hover:bg-accent/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-sm font-medium text-foreground">{titleForSession(session)}</p>
                      <StatusBadge status={session.status} />
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{session.attentionReason ?? (session.degraded ? "Degraded session state" : subtitleForSession(session))}</p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="min-h-0 flex-1 space-y-2 overflow-hidden">
            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sessions</p>
              <Badge variant="secondary">{filteredSessions.length}</Badge>
            </div>
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
              {filteredSessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                  No sessions match this search.
                </div>
              ) : (
                filteredSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => navigate(`/backend-sessions/${session.id}`)}
                    className={cn(
                      "flex w-full flex-col gap-2 rounded-2xl border px-3 py-3 text-left transition",
                      currentSessionId === session.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-transparent bg-transparent hover:border-border hover:bg-accent/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-sm font-medium text-foreground">{titleForSession(session)}</p>
                      <StatusBadge status={session.status} />
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{subtitleForSession(session)}</p>
                    <p className="truncate text-[11px] text-muted-foreground/90">{session.context.name} · {session.context.repoPath}</p>
                  </button>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}

      <div className={cn("mt-auto space-y-3 rounded-[24px] border border-border bg-card/70 p-3", collapsed && !compact && "w-full border-none bg-transparent p-0") }>
        {(!collapsed || compact) ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-foreground">{auth.user?.id ?? "guest"}</p>
                <p className="text-[11px] text-muted-foreground">{host ? `Host ${host.status}` : "Checking host"}</p>
              </div>
              {host ? <StatusBadge status={host.status} /> : null}
            </div>
            <nav className="grid gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) => cn("rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground", isActive && "bg-accent text-foreground")}
              >
                Sessions home
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) => cn("rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground", isActive && "bg-accent text-foreground")}
              >
                Settings
              </NavLink>
            </nav>
            <ThemeControls compact />
            {auth.required ? (
              <Button
                variant="secondary"
                className="w-full rounded-2xl"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: { "content-type": "application/json" } });
                  window.location.assign("/login");
                }}
              >
                Sign out
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
