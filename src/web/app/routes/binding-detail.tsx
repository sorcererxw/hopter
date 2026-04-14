import { useNavigate, useParams } from "react-router-dom";

import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { PageHero } from "@/components/orchd/page-hero";
import { SessionList } from "@/components/orchd/session-list";
import { StartSessionForm } from "@/components/orchd/start-session-form";
import { StatusBadge } from "@/components/orchd/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
    <section className="grid gap-4">
      <ConnectionBanner state={realtime.connectionState} messageWhenDegraded="Realtime connection is degraded. HTTP refetch is still active for this binding." />
      {projectError ? (
        <Alert variant="destructive">
          <AlertTitle>Binding details unavailable</AlertTitle>
          <AlertDescription>{toUserFacingError("Could not refresh this binding", new Error(projectError))}</AlertDescription>
        </Alert>
      ) : null}
      <PageHero
        eyebrow="Binding"
        title={project?.binding.name ?? "Loading…"}
        description={project?.binding.repoPath}
        status={project?.health.status ? <StatusBadge status={project.health.status} /> : null}
      />
      <StartSessionForm bindingId={bindingId} navigate={navigate} />
      {sessionsError ? (
        <Alert variant="warning">
          <AlertTitle>Session list is stale</AlertTitle>
          <AlertDescription>{toUserFacingError("Could not refresh backend sessions for this binding", new Error(sessionsError))}</AlertDescription>
        </Alert>
      ) : null}
      <SessionList
        title="Backend sessions"
        sessions={sessions?.items ?? []}
        emptyTitle="No backend sessions yet"
        emptyDescription="Start one above, then keep the same local repo moving from any browser."
        onSelect={(sessionId) => navigate(`/backend-sessions/${sessionId}`)}
      />
    </section>
  );
}
