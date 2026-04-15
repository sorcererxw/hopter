import { useNavigate, useParams } from "react-router-dom";

import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { ContentHeader } from "@/components/orchd/content-header";
import { EmptyState } from "@/components/orchd/empty-state";
import { SessionCreateComposer } from "@/components/orchd/session-create-composer";
import { StatusBadge } from "@/components/orchd/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { BackendSessionView, ProjectDetail } from "@/lib/contracts";
import { usePolling, useRealtimeVersion } from "@/lib/hooks";
import { toUserFacingError } from "@/lib/utils";

export function BindingDetailRoute() {
  const { bindingId = "" } = useParams();
  const navigate = useNavigate();
  const realtime = useRealtimeVersion();
  const { data: project, error: projectError } = usePolling(() => api.get<ProjectDetail>(`/api/bindings/${bindingId}`), [bindingId, realtime.version]);
  const { data: sessions, error: sessionsError } = usePolling(
    () => api.get<{ items: BackendSessionView[] }>(`/api/bindings/${bindingId}/backend-sessions`),
    [bindingId, realtime.version],
  );

  return (
    <section className="grid gap-4 lg:gap-5">
      <ConnectionBanner state={realtime.connectionState} messageWhenDegraded="Realtime connection is degraded. Context details still refresh over HTTP." />
      <ContentHeader
        eyebrow="Repo context"
        title={project?.binding.name ?? "Repo context"}
        description={project?.binding.repoPath ?? "A stored local repo path underneath your sessions."}
        status={project?.health.status ? <StatusBadge status={project.health.status} /> : null}
      />

      {projectError ? (
        <Alert variant="destructive">
          <AlertTitle>Repo context unavailable</AlertTitle>
          <AlertDescription>{toUserFacingError("Could not refresh this repo context", new Error(projectError))}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Sessions from this repo</CardTitle>
          </CardHeader>
          <CardContent>
            {!sessions?.items?.length ? (
              <EmptyState title="No sessions yet" description="This route is now secondary. It exists so you can inspect one stored repo context and start a session from it." />
            ) : (
              <div className="space-y-3">
                {sessions.items.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => navigate(`/backend-sessions/${session.id}`)}
                    className="w-full rounded-[24px] border border-border bg-background/60 px-4 py-4 text-left transition hover:border-primary/40 hover:bg-accent/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{session.title ?? project?.binding.name ?? session.id}</p>
                        <p className="text-xs text-muted-foreground">{session.backendSessionId ?? "pending session id"}</p>
                      </div>
                      <StatusBadge status={session.status} />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{session.lastSummary ?? "No summary yet."}</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6">
          <SessionCreateComposer contexts={project ? [project.binding] : []} defaultContextId={project?.binding.id} compact />
          {sessionsError ? (
            <Alert variant="warning">
              <AlertTitle>Session list is stale</AlertTitle>
              <AlertDescription>{toUserFacingError("Could not refresh sessions for this repo context", new Error(sessionsError))}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </section>
  );
}
