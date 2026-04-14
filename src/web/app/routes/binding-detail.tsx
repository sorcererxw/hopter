import { useNavigate, useParams } from "react-router-dom";

import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { PageHero } from "@/components/orchd/page-hero";
import { SessionList } from "@/components/orchd/session-list";
import { StartSessionForm } from "@/components/orchd/start-session-form";
import { StatusBadge } from "@/components/orchd/status-badge";
import { api } from "@/lib/api";
import type { BackendSessionView, ProjectDetail } from "@/lib/contracts";
import { usePolling, useRealtimeVersion } from "@/lib/hooks";

export function BindingDetailRoute() {
  const { bindingId = "" } = useParams();
  const navigate = useNavigate();
  const realtime = useRealtimeVersion();
  const { data: project } = usePolling(() => api.get<ProjectDetail>(`/api/bindings/${bindingId}`), [bindingId, realtime.version]);
  const { data: sessions } = usePolling(
    () => api.get<{ items: BackendSessionView[] }>(`/api/bindings/${bindingId}/backend-sessions`),
    [bindingId, realtime.version],
  );

  return (
    <section className="grid gap-4">
      <ConnectionBanner state={realtime.connectionState} messageWhenDegraded="Realtime connection is degraded. HTTP refetch is still active for this binding." />
      <PageHero
        eyebrow="Binding"
        title={project?.binding.name ?? "Loading…"}
        description={project?.binding.repoPath}
        status={project?.health.status ? <StatusBadge status={project.health.status} /> : null}
      />
      <StartSessionForm bindingId={bindingId} navigate={navigate} />
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
