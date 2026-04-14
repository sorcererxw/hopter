import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { EmptyState } from "@/components/orchd/empty-state";
import { PageHero } from "@/components/orchd/page-hero";
import { StatusBadge } from "@/components/orchd/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import type { BackendSessionView, HostStatus, ProjectBindingView } from "@/lib/contracts";
import { usePolling, useRealtimeVersion } from "@/lib/hooks";

export function DashboardRoute() {
  const navigate = useNavigate();
  const realtime = useRealtimeVersion();
  const { data: host } = usePolling(() => api.get<HostStatus>("/api/host/status"), [realtime.version]);
  const { data: bindings } = usePolling(() => api.get<{ items: ProjectBindingView[] }>("/api/bindings"), [realtime.version]);
  const [sessionGroups, setSessionGroups] = useState<Array<{ binding: ProjectBindingView; sessions: BackendSessionView[] }>>([]);

  useEffect(() => {
    if (!bindings?.items) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      bindings.items.map(async (binding) => ({
        binding,
        sessions: (await api.get<{ items: BackendSessionView[] }>(`/api/bindings/${binding.id}/backend-sessions`)).items,
      })),
    ).then((groups) => {
      if (!cancelled) {
        setSessionGroups(groups);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bindings?.items?.map((binding) => binding.id).join(","), realtime.version]);

  const runningSessions = useMemo(
    () => sessionGroups.flatMap((group) => group.sessions.filter((session) => session.status === "running").map((session) => ({ ...session, bindingName: group.binding.name }))),
    [sessionGroups],
  );
  const attentionSessions = useMemo(
    () => sessionGroups.flatMap((group) => group.sessions.filter((session) => session.attentionReason).map((session) => ({ ...session, bindingName: group.binding.name }))),
    [sessionGroups],
  );

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="xl:col-span-2">
        <ConnectionBanner state={realtime.connectionState} messageWhenDegraded="Realtime connection is degraded. HTTP refresh continues to keep the control plane honest." />
      </div>

      <div className="xl:col-span-2">
        <PageHero
          eyebrow="Host"
          title={host?.status ?? "Loading host…"}
          description={`Codex ${host?.codex.detected ? host.codex.version : "missing"} · access ${host?.accessMode ?? "—"}`}
          status={host ? <StatusBadge status={host.status} /> : null}
          actions={<Button variant="secondary" onClick={() => navigate("/bindings/new")}>Add binding</Button>}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attention now</CardTitle>
        </CardHeader>
        <CardContent>
          {attentionSessions.length === 0 ? (
            <EmptyState title="No sessions need you right now" description="When a backend session pauses for approval or input, it lands here first." />
          ) : (
            <div className="space-y-4">
              {attentionSessions.map((session, index) => (
                <div key={session.id} className="space-y-4">
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-2xl border border-border/70 bg-background/35 px-4 py-4 text-left hover:bg-accent/40"
                    onClick={() => navigate(`/backend-sessions/${session.id}`)}
                  >
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-semibold text-foreground">{session.title ?? session.bindingName}</span>
                        <StatusBadge status={session.status} />
                      </div>
                      <span className="text-sm text-muted-foreground">{session.attentionReason}</span>
                    </div>
                  </Button>
                  {index < attentionSessions.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Running sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {runningSessions.length === 0 ? (
            <EmptyState title="No active sessions" description="Kick off a backend session from any binding when you want Codex to keep moving while you're away." />
          ) : (
            <div className="space-y-4">
              {runningSessions.map((session, index) => (
                <div key={session.id} className="space-y-4">
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-2xl border border-border/70 bg-background/35 px-4 py-4 text-left hover:bg-accent/40"
                    onClick={() => navigate(`/backend-sessions/${session.id}`)}
                  >
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-semibold text-foreground">{session.title ?? session.bindingName}</span>
                        <StatusBadge status={session.status} />
                      </div>
                      <span className="text-sm text-muted-foreground">{session.lastSummary ?? session.status}</span>
                    </div>
                  </Button>
                  {index < runningSessions.length - 1 ? <Separator /> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>Bindings</CardTitle>
          <Button variant="secondary" onClick={() => navigate("/bindings/new")}>Create binding</Button>
        </CardHeader>
        <CardContent>
          {!bindings?.items?.length ? (
            <EmptyState title="No bindings yet" description="Bind one local repo path to the thin control plane. orchd stores the binding, not the repo contents." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {bindings.items.map((binding) => (
                <Button
                  key={binding.id}
                  variant="ghost"
                  className="h-auto justify-start rounded-3xl border border-border/70 bg-background/35 px-5 py-5 text-left hover:bg-accent/40"
                  onClick={() => navigate(`/bindings/${binding.id}`)}
                >
                  <div className="grid gap-2">
                    <span className="text-base font-semibold text-foreground">{binding.name}</span>
                    <span className="text-sm text-muted-foreground">{binding.repoPath}</span>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
