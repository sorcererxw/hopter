import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { ArtifactList } from "@/components/orchd/artifact-list";
import { ArtifactViewer } from "@/components/orchd/artifact-viewer";
import { AttentionPanel } from "@/components/orchd/attention-panel";
import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { SessionActionBar } from "@/components/orchd/session-action-bar";
import { SessionHero } from "@/components/orchd/session-hero";
import { SessionStatusSummaryRow } from "@/components/orchd/session-status-summary-row";
import { TerminalDrawer } from "@/components/orchd/terminal-drawer";
import { TimelinePanel } from "@/components/orchd/timeline-panel";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { ArtifactDetail, SessionDetail } from "@/lib/contracts";
import { usePolling, useRealtimeVersion } from "@/lib/hooks";

export function BackendSessionDetailRoute() {
  const { handleId = "" } = useParams();
  const realtime = useRealtimeVersion();
  const { data: detail, error, loading } = usePolling(
    () => api.get<SessionDetail>(`/api/backend-sessions/${handleId}`),
    [handleId, realtime.version],
    4_000,
  );
  const [artifactDetail, setArtifactDetail] = useState<ArtifactDetail | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail?.artifacts?.length) {
      setArtifactDetail(null);
      setSelectedArtifactId(null);
      return;
    }

    const firstId = detail.artifacts[0]?.id ?? null;
    setSelectedArtifactId((current) => current ?? firstId);
  }, [detail?.artifacts?.map((artifact) => artifact.id).join(",")]);

  useEffect(() => {
    if (!selectedArtifactId) {
      return;
    }

    void api.get<ArtifactDetail>(`/api/artifacts/${selectedArtifactId}`).then(setArtifactDetail).catch(() => setArtifactDetail(null));
  }, [selectedArtifactId]);

  if (loading && !detail) {
    return (
      <Card className="mx-auto w-full max-w-3xl">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Loading backend session…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mx-auto w-full max-w-3xl">
        <CardContent className="p-6">
          <p className="text-sm text-red-200">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return null;
  }

  return (
    <section className="grid gap-4">
      <ConnectionBanner state={realtime.connectionState} messageWhenDegraded="Visible state may be stale until HTTP refetch succeeds. orchd keeps the degraded state honest instead of hiding it." />
      <SessionHero title={detail.handle.title ?? detail.handle.id} backendSessionId={detail.handle.backendSessionId} status={detail.handle.status} />
      <SessionStatusSummaryRow degraded={detail.handle.degraded} latestSummary={detail.latestSummary} />
      <AttentionPanel
        attention={detail.attention}
        error={actionError}
        onApprove={async () => {
          setActionError(null);
          try {
            await api.post(`/api/backend-sessions/${handleId}/approve`, { decision: "approve", note: null });
          } catch (approveError) {
            setActionError(approveError instanceof Error ? approveError.message : String(approveError));
          }
        }}
        onReject={async () => {
          setActionError(null);
          try {
            await api.post(`/api/backend-sessions/${handleId}/approve`, { decision: "reject", note: null });
          } catch (rejectError) {
            setActionError(rejectError instanceof Error ? rejectError.message : String(rejectError));
          }
        }}
      />
      <SessionActionBar
        input={input}
        onInputChange={setInput}
        error={actionError}
        onSubmit={async () => {
          setActionError(null);
          try {
            await api.post(`/api/backend-sessions/${handleId}/input`, { text: input });
            setInput("");
          } catch (inputError) {
            setActionError(inputError instanceof Error ? inputError.message : String(inputError));
          }
        }}
        onInterrupt={async () => {
          setActionError(null);
          try {
            await api.post(`/api/backend-sessions/${handleId}/interrupt`, { mode: "interrupt" });
          } catch (interruptError) {
            setActionError(interruptError instanceof Error ? interruptError.message : String(interruptError));
          }
        }}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ArtifactList
          artifacts={detail.artifacts}
          selectedArtifactId={selectedArtifactId}
          onSelect={async (artifactId) => {
            setSelectedArtifactId(artifactId);
            setArtifactDetail(await api.get<ArtifactDetail>(`/api/artifacts/${artifactId}`));
          }}
        />
        <ArtifactViewer artifactDetail={artifactDetail} />
      </div>
      <TimelinePanel />
      <TerminalDrawer />
    </section>
  );
}
