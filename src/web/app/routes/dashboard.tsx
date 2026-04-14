import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { EmptyState } from "@/components/orchd/empty-state";
import { PageHero } from "@/components/orchd/page-hero";
import { SelectableSurface } from "@/components/orchd/selectable-surface";
import { StatusBadge } from "@/components/orchd/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import type { BackendSessionView, HostStatus, ProjectBindingView } from "@/lib/contracts";
import { usePolling, useRealtimeVersion } from "@/lib/hooks";
import { toUserFacingError } from "@/lib/utils";

export function DashboardRoute() {
  const navigate = useNavigate();
  const realtime = useRealtimeVersion();
  const { data: host } = usePolling(() => api.get<HostStatus>("/api/host/status"), [realtime.version]);
  const { data: bindings } = usePolling(() => api.get<{ items: ProjectBindingView[] }>("/api/bindings"), [realtime.version]);
  const [sessionGroups, setSessionGroups] = useState<Array<{ binding: ProjectBindingView; sessions: BackendSessionView[] }>>([]);
  const [partialFetchError, setPartialFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!bindings?.items) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      bindings.items.map(async (binding) => {
        try {
          const response = await api.get<{ items: BackendSessionView[] }>(`/api/bindings/${binding.id}/backend-sessions`);
          return { binding, sessions: response.items, failed: false };
        } catch (error) {
          return { binding, sessions: [], failed: true, error };
        }
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }

      const failedCount = results.filter((result) => result.failed).length;
      setSessionGroups(results.map(({ binding, sessions }) => ({ binding, sessions })));
      setPartialFetchError(
        failedCount > 0
          ? toUserFacingError("Some binding activity could not be refreshed", results.find((result) => result.failed)?.error)
          : null,
      );
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

      {partialFetchError ? (
        <div className="xl:col-span-2">
          <Alert variant="warning">
            <AlertTitle>Partial dashboard refresh</AlertTitle>
            <AlertDescription>{partialFetchError}</AlertDescription>
          </Alert>
        </div>
      ) : null}

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
                  <SelectableSurface
                    title={session.title ?? session.bindingName}
                    description={session.attentionReason ?? "Needs your input."}
                    meta={<span>{session.bindingName}</span>}
                    aside={<StatusBadge status={session.status} />}
                    onSelect={() => navigate(`/backend-sessions/${session.id}`)}
                  />
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
                  <SelectableSurface
                    title={session.title ?? session.bindingName}
                    description={session.lastSummary ?? session.status}
                    meta={<span>{session.bindingName}</span>}
                    aside={<StatusBadge status={session.status} />}
                    onSelect={() => navigate(`/backend-sessions/${session.id}`)}
                  />
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
                <SelectableSurface
                  key={binding.id}
                  title={binding.name}
                  description={binding.repoPath}
                  onSelect={() => navigate(`/bindings/${binding.id}`)}
                  className="px-5 py-5"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
