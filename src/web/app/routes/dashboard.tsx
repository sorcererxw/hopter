import { useNavigate } from "react-router-dom";

import { ConnectionBanner } from "@/components/orchd/connection-banner";
import { ContentHeader } from "@/components/orchd/content-header";
import { EmptyState } from "@/components/orchd/empty-state";
import { SessionCreateComposer } from "@/components/orchd/session-create-composer";
import { StatusBadge } from "@/components/orchd/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRealtimeVersion } from "@/lib/hooks";
import { useShellNavigationData } from "@/lib/use-shell-navigation-data";

export function DashboardRoute() {
  const navigate = useNavigate();
  const realtime = useRealtimeVersion();
  const shell = useShellNavigationData();

  return (
    <section className="grid gap-4 lg:gap-5">
      <ConnectionBanner state={realtime.connectionState} messageWhenDegraded="Realtime connection is degraded. Sessions keep polling, but the live shell may lag for a few seconds." />

      <ContentHeader
        eyebrow="Session home"
        title={shell.attentionSessions.length > 0 ? "Something needs you" : "Pick up the next session"}
        description={
          shell.host
            ? `Codex ${shell.host.codex.detected ? shell.host.codex.version : "missing"} · ${shell.activeSessions.length} active session${shell.activeSessions.length === 1 ? "" : "s"}`
            : "Loading host truth and recent sessions."
        }
        status={shell.host ? <StatusBadge status={shell.host.status} /> : null}
        actions={<Button variant="secondary" onClick={() => navigate("/bindings/new")}>Add repo</Button>}
      />

      {shell.error ? (
        <Alert variant="warning">
          <AlertTitle>Navigation state is partial</AlertTitle>
          <AlertDescription>{shell.error}</AlertDescription>
        </Alert>
      ) : null}

      {shell.sessions.length === 0 ? (
        <div className="grid min-h-[65vh] place-items-center">
          <div className="w-full max-w-3xl space-y-6">
            <div className="space-y-2 text-center">
              <h2 className="text-4xl font-semibold tracking-tight text-foreground md:text-6xl">Let&apos;s build</h2>
              <p className="text-lg text-muted-foreground">Start a session. The repo context stays underneath, but the session is now the thing you come back to.</p>
            </div>
            <SessionCreateComposer contexts={shell.contexts} />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:items-start">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Needs you now</CardTitle>
              </CardHeader>
              <CardContent>
                {shell.attentionSessions.length === 0 ? (
                  <EmptyState title="No blocked sessions" description="Approvals, degraded sessions, and explicit input requests land here first." />
                ) : (
                  <div className="space-y-3">
                    {shell.attentionSessions.slice(0, 8).map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => navigate(`/backend-sessions/${session.id}`)}
                        className="flex w-full flex-col gap-2 rounded-[24px] border border-border bg-background/60 px-4 py-4 text-left transition hover:border-primary/40 hover:bg-accent/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{session.title ?? session.context.name}</p>
                            <p className="text-xs text-muted-foreground">{session.context.name}</p>
                          </div>
                          <StatusBadge status={session.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">{session.attentionReason ?? (session.degraded ? "Live truth is degraded. Open the session and decide what to do next." : session.lastSummary ?? "Open session")}</p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent sessions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {shell.recentSessions.slice(0, 10).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => navigate(`/backend-sessions/${session.id}`)}
                      className="flex w-full flex-col gap-2 rounded-[24px] border border-transparent bg-card/70 px-4 py-4 text-left transition hover:border-border hover:bg-accent/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{session.title ?? session.context.name}</p>
                          <p className="text-xs text-muted-foreground">{session.context.name} · {session.backendSessionId ?? "pending session id"}</p>
                        </div>
                        <StatusBadge status={session.status} />
                      </div>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{session.lastSummary ?? "No summary yet."}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 xl:sticky xl:top-6">
            <SessionCreateComposer contexts={shell.contexts} compact />
            <Card>
              <CardHeader>
                <CardTitle>Live shell truth</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>Host status: {shell.host?.status ?? "loading"}</p>
                <p>Repo contexts: {shell.contexts.length}</p>
                <p>Recent sessions: {shell.sessions.length}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}
