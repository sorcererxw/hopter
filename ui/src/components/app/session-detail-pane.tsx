import { Link, useNavigate } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useCreateSession, useSendSessionInput, useSession } from "@/features/sessions/use-sessions"

export function HomeWorkspacePane() {
  const navigate = useNavigate()
  const createSession = useCreateSession()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8" data-testid="home-workspace-pane">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Workspace shell
        </p>
        <h2 className="text-3xl font-semibold tracking-tight">Pick up work or start a fresh session</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          The left rail stays mounted for session re-entry. The right pane is reserved for steering the selected
          session or launching a new one against a project.
        </p>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle>New session</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionComposer
            mode="create"
            busy={createSession.isPending}
            onSubmit={async ({ projectId, prompt, title }) => {
              if (!projectId) {
                return
              }

              const session = await createSession.mutateAsync({ projectId, prompt, title })
              if (session?.id) {
                navigate(`/sessions/${session.id}`)
              }
            }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Why this rebuild exists</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Go owns the browser entrypoint in dev and production, while the UI remains a lightweight React control surface.</p>
            <p>Connect handles control-plane requests, and a single SSE stream fans out state refresh hints.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Need a new local project?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Projects replace the older binding concept and define where Codex sessions run.</p>
            <Button asChild variant="outline">
              <Link to="/projects/new">Create project</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const sessionQuery = useSession(sessionId)
  const sendInput = useSendSessionInput()

  if (sessionQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
        <Card>
          <CardHeader>
            <CardTitle>Session unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>The route is mounted and ready, but the backend has not returned the selected session yet.</p>
            <Button asChild variant="outline">
              <Link to="/">Back to workspace</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const selectedSession = sessionQuery.data

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8" data-testid="session-workspace-pane">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3" data-testid="session-header">
          <h2 className="text-3xl font-semibold tracking-tight">{selectedSession.title || "Untitled session"}</h2>
          <Badge data-testid="session-status" variant={selectedSession.attentionRequired ? "destructive" : "secondary"}>
            {selectedSession.status.toString().replaceAll("_", " ").toLowerCase()}
          </Badge>
          <Badge variant="outline">{selectedSession.project?.name || "Project pending"}</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="session-summary">
          {selectedSession.summary ||
            "This session has not emitted a summary yet. Use the composer below to keep steering Codex from the same workspace."}
        </p>
      </div>

      {selectedSession.attentionRequired ? (
        <Card className="border-destructive/25 bg-destructive/5">
          <CardHeader>
            <CardTitle>Attention required</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {selectedSession.attentionReason || "The backend marked this session as requiring user input."}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Continue session</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionComposer
            mode="follow-up"
            busy={sendInput.isPending}
            onSubmit={async ({ prompt }) => {
              await sendInput.mutateAsync({ sessionId, input: prompt })
            }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Latest summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{selectedSession.summary || "No summary has been published yet."}</p>
            <Separator />
            <p>Last input hint: {selectedSession.lastInputHint || "No prior input recorded"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedSession.artifacts.length > 0 ? (
              selectedSession.artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-xl border border-border/70 p-3 text-sm">
                  <p className="font-medium">{artifact.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{artifact.kind.toString().replaceAll("_", " ").toLowerCase()}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Artifact metadata will appear here once the backend starts returning session outputs.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
