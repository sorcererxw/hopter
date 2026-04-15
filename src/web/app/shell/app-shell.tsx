import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SidebarShell } from "@/components/orchd/sidebar-shell";
import { StatusBadge } from "@/components/orchd/status-badge";
import type { AuthMe } from "@/lib/contracts";
import { useShellNavigationData } from "@/lib/use-shell-navigation-data";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_KEY = "orchd.session-shell.sidebar-width.v1";
const SIDEBAR_COLLAPSED_KEY = "orchd.session-shell.sidebar-collapsed.v1";
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 460;
const DEFAULT_SIDEBAR_WIDTH = 340;

function clampWidth(value: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

function loadWidth() {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  const raw = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(raw) ? clampWidth(raw) : DEFAULT_SIDEBAR_WIDTH;
}

function loadCollapsed() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function titleFromPath(pathname: string) {
  if (pathname === "/") return "Sessions";
  if (pathname === "/bindings/new") return "Add repo";
  if (pathname.startsWith("/bindings/")) return "Repo context";
  if (pathname.startsWith("/backend-sessions/")) return "Session";
  if (pathname.startsWith("/settings")) return "Settings";
  return "orchd";
}

function currentSessionIdFromPath(pathname: string) {
  const match = pathname.match(/^\/backend-sessions\/([^/]+)/);
  return match?.[1] ?? null;
}

export function AppShell({ auth, children }: { auth: AuthMe; children: ReactNode }) {
  const location = useLocation();
  const shell = useShellNavigationData();
  const [sidebarWidth, setSidebarWidth] = useState(loadWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location.pathname]);

  const currentSessionId = useMemo(() => currentSessionIdFromPath(location.pathname), [location.pathname]);

  const sidebarStyle = useMemo(
    () => ({ width: sidebarCollapsed ? 88 : sidebarWidth }),
    [sidebarCollapsed, sidebarWidth],
  );

  const onResizeStart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      setSidebarWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="min-h-screen bg-background text-foreground md:h-screen md:overflow-hidden">
      <div className="flex h-full min-h-screen flex-col md:hidden">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setMobileDrawerOpen(true)} aria-label="Open session navigation">
              <Menu className="size-5" />
            </Button>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/90">orchd</p>
              <p className="text-sm font-medium text-foreground">{titleFromPath(location.pathname)}</p>
            </div>
          </div>
          {shell.host ? <StatusBadge status={shell.host.status} /> : null}
        </header>
        {mobileDrawerOpen ? (
          <div className="fixed inset-0 z-50 bg-black/55" onClick={() => setMobileDrawerOpen(false)}>
            <aside className="h-full w-[88vw] max-w-[380px] border-r border-border bg-background p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <SidebarShell
                auth={auth}
                host={shell.host}
                contexts={shell.contexts}
                sessions={shell.recentSessions}
                attentionSessions={shell.attentionSessions}
                collapsed={false}
                compact
                currentSessionId={currentSessionId}
                onToggleCollapsed={() => setMobileDrawerOpen(false)}
              />
            </aside>
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-x-hidden px-3 pb-24 pt-3">{children}</main>
      </div>

      <div className="hidden h-screen md:flex md:overflow-hidden">
        <aside style={sidebarStyle} className="relative shrink-0 border-r border-border bg-background/85 px-4 py-4 backdrop-blur">
          <SidebarShell
            auth={auth}
            host={shell.host}
            contexts={shell.contexts}
            sessions={shell.recentSessions}
            attentionSessions={shell.attentionSessions}
            collapsed={sidebarCollapsed}
            currentSessionId={currentSessionId}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          />
          {!sidebarCollapsed ? (
            <button
              type="button"
              aria-label="Resize sidebar"
              className="absolute -right-[5px] top-0 h-full w-[10px] cursor-col-resize"
              onMouseDown={onResizeStart}
            >
              <span className="mx-auto block h-full w-px bg-border transition hover:bg-primary/60" />
            </button>
          ) : null}
        </aside>
        <main className={cn("min-w-0 flex-1 overflow-y-auto px-6 pb-20 pt-6 lg:px-8", sidebarCollapsed ? "xl:px-10" : "xl:px-8")}>{children}</main>
      </div>
    </div>
  );
}
