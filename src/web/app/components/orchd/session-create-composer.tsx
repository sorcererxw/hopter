import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageSquarePlus, FolderPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { BackendSessionView, ProjectBindingView } from "@/lib/contracts";
import { toUserFacingError } from "@/lib/utils";

export function SessionCreateComposer({
  contexts,
  defaultContextId,
  compact = false,
  className,
  onCreated,
}: {
  contexts: ProjectBindingView[];
  defaultContextId?: string | null;
  compact?: boolean;
  className?: string;
  onCreated?: (session: BackendSessionView) => void;
}) {
  const navigate = useNavigate();
  const initialContextId = useMemo(() => defaultContextId ?? contexts[0]?.id ?? "", [contexts, defaultContextId]);
  const [contextId, setContextId] = useState(initialContextId);

  useEffect(() => {
    if (!contextId && initialContextId) {
      setContextId(initialContextId);
    }
  }, [contextId, initialContextId]);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (contexts.length === 0) {
    return (
      <div className={cn("rounded-[24px] border border-dashed border-border bg-muted/30 p-5 text-sm text-muted-foreground", className)}>
        <p className="font-medium text-foreground">Add a repo before you start a session.</p>
        <p className="mt-1">Sessions are now the main product object, but they still need a real local repo context underneath.</p>
        <div className="mt-4">
          <Button asChild size={compact ? "sm" : "default"}>
            <Link to="/bindings/new">
              <FolderPlus className="size-4" />
              Add repo context
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={cn(
        "rounded-[24px] border border-border bg-card/95 p-4 shadow-sm backdrop-blur",
        compact ? "grid gap-3" : "grid gap-4 p-5",
        className,
      )}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!contextId || !prompt.trim()) {
          setError("Pick a repo context and enter a prompt.");
          return;
        }

        setSubmitting(true);
        setError(null);
        try {
          const result = await api.post<{ handle: BackendSessionView }>(`/api/bindings/${contextId}/backend-sessions`, {
            title: title.trim() || null,
            prompt,
          });
          setPrompt("");
          setTitle("");
          onCreated?.(result.handle);
          navigate(`/backend-sessions/${result.handle.id}`);
        } catch (submissionError) {
          setError(toUserFacingError("Could not start a new session", submissionError));
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className={cn("grid gap-3", compact ? "md:grid-cols-[180px_minmax(0,1fr)]" : "md:grid-cols-[220px_minmax(0,1fr)]") }>
        <label className="grid gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Repo context
          <select
            value={contextId}
            onChange={(event) => setContextId(event.target.value)}
            className="h-11 rounded-2xl border border-input bg-background px-3 text-sm text-foreground outline-none ring-0 transition focus:border-primary/60"
          >
            {contexts.map((context) => (
              <option key={context.id} value={context.id}>
                {context.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Session title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Investigate reconnect behavior"
            className="h-11 rounded-2xl border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/60"
          />
        </label>
      </div>
      <label className="grid gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Prompt
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={compact ? 3 : 5}
          placeholder="Trace the reconnect path and harden degraded-state handling."
          className="min-h-[108px] rounded-[20px] border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={submitting} size={compact ? "sm" : "default"}>
          <MessageSquarePlus className="size-4" />
          {submitting ? "Starting…" : "New session"}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </form>
  );
}
