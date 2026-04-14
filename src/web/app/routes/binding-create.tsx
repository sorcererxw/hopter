import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { ProjectBindingView } from "@/lib/contracts";

export function BindingCreateRoute() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardDescription>Binding</CardDescription>
        <CardTitle>Create binding</CardTitle>
        <p className="text-sm text-muted-foreground">Bind one local repo path to the thin control plane. <code>orchd</code> stores the binding, not the repo contents.</p>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setError(null);
            try {
              const result = await api.post<{ binding: ProjectBindingView }>("/api/bindings", {
                name,
                repoPath,
                defaultBackend: "codex",
              });
              navigate(`/bindings/${result.binding.id}`);
            } catch (submissionError) {
              setError(submissionError instanceof Error ? submissionError.message : String(submissionError));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="binding-name">Name</Label>
            <Input id="binding-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="orchd" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="binding-repo">Repo path</Label>
            <Input id="binding-repo" value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="/Users/me/src/orchd" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="binding-backend">Backend</Label>
            <Input id="binding-backend" value="codex" disabled />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={submitting}>{submitting ? "Creating…" : "Create binding"}</Button>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Binding creation failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
