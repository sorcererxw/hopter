import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { BackendSessionView } from "@/lib/contracts";
import { toUserFacingError } from "@/lib/utils";

export function StartSessionForm({ bindingId, navigate }: { bindingId: string; navigate: (path: string) => void }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start backend session</CardTitle>
        <CardDescription>Kick off a Codex-backed turn from this binding, then control it from any browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setError(null);
            try {
              const result = await api.post<{ handle: BackendSessionView }>(`/api/bindings/${bindingId}/backend-sessions`, {
                title,
                prompt,
              });
              navigate(`/backend-sessions/${result.handle.id}`);
            } catch (submissionError) {
              setError(toUserFacingError("Could not start the backend session", submissionError));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="session-title">Title</Label>
            <Input id="session-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Investigate reconnect behavior" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="session-prompt">Prompt</Label>
            <Textarea
              id="session-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="Trace the reconnect path and harden degraded-state handling."
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={submitting}>{submitting ? "Starting…" : "Start backend session"}</Button>
            {error ? <p className="text-sm text-foreground">{error}</p> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
