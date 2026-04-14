import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AuthMe } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export function AppShell({ auth, children }: { auth: AuthMe; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-border/70 bg-slate-950/70 p-6 backdrop-blur lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col gap-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">orchd</p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Remote control plane</h1>
              <p className="text-sm text-muted-foreground">Status first. Summary second. Attention before terminal.</p>
            </div>
          </div>
          <Separator />
          <nav className="grid gap-2">
            {[
              ["/", "Dashboard"],
              ["/bindings/new", "Create binding"],
              ["/settings", "Settings"],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-2xl px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground",
                    isActive && "bg-primary/12 text-foreground",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto space-y-4">
            <Separator />
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{auth.user?.id ?? "guest"}</p>
              {auth.required ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: { "content-type": "application/json" } });
                    window.location.assign("/login");
                  }}
                >
                  Sign out
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
      <main className="p-4 md:p-6 lg:p-8">{children}</main>
    </div>
  );
}
