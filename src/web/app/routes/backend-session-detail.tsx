import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ArtifactList } from "@/components/orchd/artifact-list";
import { ArtifactViewer } from "@/components/orchd/artifact-viewer";
import { AttentionPanel } from "@/components/orchd/attention-panel";
import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { ContentHeader } from "@/components/orchd/content-header";
import { SessionActionBar } from "@/components/orchd/session-action-bar";
import { StatusBadge } from "@/components/orchd/status-badge";
import { TerminalDrawer } from "@/components/orchd/terminal-drawer";
import { TimelinePanel } from "@/components/orchd/timeline-panel";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { ArtifactDetail, SessionDetail } from "@/lib/contracts";
import { usePolling, useRealtimeVersion } from "@/lib/hooks";
import { useShellNavigationData } from "@/lib/use-shell-navigation-data";
import { toUserFacingError } from "@/lib/utils";
import { resolveSelectedArtifactId } from "@/lib/view-state";

export function BackendSessionDetailRoute() {
  const { handleId = "" } = useParams();
  const realtime = useRealtimeVersion();
  const shell = useShellNavigationData();
  const { data: detail, error, loading } = usePolling(
    () => api.get<SessionDetail>(`/api/backend-sessions/${handleId}`),
    [handleId, realtime.version],
    4_000,
  );
  const [artifactDetail, setArtifactDetail] = useState<ArtifactDetail | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const artifactRequestVersion = useRef(0);

  const context = useMemo(
    () => shell.contexts.find((item) => item.id === detail?.handle.projectId),
    [shell.contexts, detail?.handle.projectId],
  );

  useEffect(() => {
    if (!detail?.artifacts?.length) {
      setArtifactDetail(null);
      setSelectedArtifactId(null);
      setArtifactError(null);
      setArtifactLoading(false);
      return;
    }

    setSelectedArtifactId((current) => resolveSelectedArtifactId(detail.artifacts.map((artifact) => artifact.id), current));
  }, [detail?.artifacts?.map((artifact) => artifact.id).join(",")]);

  useEffect(() => {
    if (!selectedArtifactId) {
      setArtifactLoading(false);
      setArtifactError(null);
      return;
    }

    const requestVersion = artifactRequestVersion.current + 1;
    artifactRequestVersion.current = requestVersion;
    setArtifactLoading(true);
    setArtifactError(null);
    setArtifactDetail(null);

    void api
      .get<ArtifactDetail>(`/api/artifacts/${selectedArtifactId}`)
      .then((nextDetail) => {
        if (artifactRequestVersion.current !== requestVersion) {
          return;
        }
        setArtifactDetail(nextDetail);
        setArtifactLoading(false);
      })
      .catch((nextError) => {
        if (artifactRequestVersion.current !== requestVersion) {
          return;
        }
        setArtifactDetail(null);
        setArtifactError(toUserFacingError("Could not load the selected artifact", nextError));
        setArtifactLoading(false);
      });
  }, [selectedArtifactId]);

  if (loading && !detail) {
    return (
      <Card className="mx-auto w-full max-w-3xl">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Loading session…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mx-auto w-full max-w-3xl">
        <CardContent className="p-6">
          <p className="text-sm text-foreground">{toUserFacingError("Could not load this session", new Error(error))}</p>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return null;
  }

  return (
    <section className="grid gap-4 lg:gap-5">
      <ConnectionBanner state={realtime.connectionState} messageWhenDegraded="Realtime connection is degraded. The conversation shell may be a few seconds behind until HTTP catches up." />
      <ContentHeader
        eyebrow="Session"
        title={detail.handle.title ?? context?.name ?? detail.handle.id}
        description={`${context?.name ?? "Repo context"} · ${detail.handle.backendSessionId ?? "pending session id"}`}
        status={<StatusBadge status={detail.handle.status} />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="space-y-4">
          <section className="space-y-4 rounded-[28px] border border-border bg-card/90 p-4 shadow-sm backdrop-blur md:p-5">
            <div className="space-y-3">
              <div className="max-w-[85%] rounded-[24px] bg-background/80 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/90">Latest update</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{detail.latestSummary ?? "No summary yet. Open the artifact rail or send the next steer."}</p>
              </div>

              <div className="ml-auto max-w-[88%] rounded-[24px] border border-border bg-muted/35 px-4 py-4 text-sm text-muted-foreground">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Session truth</p>
                <p className="mt-2">{detail.handle.degraded ? "Live attachment truth is degraded. Treat this thread like a stale shell until the session reconnects." : "Live session state is current."}</p>
              </div>
            </div>

            <AttentionPanel
              attention={detail.attention}
              error={actionError}
              onApprove={async () => {
                setActionError(null);
                try {
                  await api.post(`/api/backend-sessions/${handleId}/approve`, { decision: "approve", note: null });
                } catch (approveError) {
                  setActionError(toUserFacingError("Could not approve this request", approveError));
                }
              }}
              onReject={async () => {
                setActionError(null);
                try {
                  await api.post(`/api/backend-sessions/${handleId}/approve`, { decision: "reject", note: null });
                } catch (rejectError) {
                  setActionError(toUserFacingError("Could not reject this request", rejectError));
                }
              }}
            />

            <ArtifactViewer artifactDetail={artifactDetail} loading={artifactLoading} error={artifactError} />
            <TimelinePanel />
            <TerminalDrawer />
          </section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-6">
          <ArtifactList
            artifacts={detail.artifacts}
            selectedArtifactId={selectedArtifactId}
            onSelect={(artifactId) => {
              setSelectedArtifactId(artifactId);
            }}
          />
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Repo context</p>
              <p className="mt-1">{context?.name ?? "Loading context"}</p>
              <p className="mt-1 truncate">{context?.repoPath ?? "No repo path loaded"}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <SessionActionBar
        input={input}
        onInputChange={setInput}
        error={actionError}
        stickyOnMobile={Boolean(detail.attention)}
        onSubmit={async () => {
          setActionError(null);
          try {
            await api.post(`/api/backend-sessions/${handleId}/input`, { text: input });
            setInput("");
          } catch (inputError) {
            setActionError(toUserFacingError("Could not send your input", inputError));
          }
        }}
        onInterrupt={async () => {
          setActionError(null);
          try {
            await api.post(`/api/backend-sessions/${handleId}/interrupt`, { mode: "interrupt" });
          } catch (interruptError) {
            setActionError(toUserFacingError("Could not interrupt the session", interruptError));
          }
        }}
      />
    </section>
  );
}
