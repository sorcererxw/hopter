import { useState } from "react";
import { Navigate } from "react-router-dom";

import { EmptyState } from "@/components/orchd/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthMe } from "@/lib/contracts";
import { api } from "@/lib/api";
import { toUserFacingError } from "@/lib/utils";

export function LoginRoute({ auth, onLoggedIn }: { auth: AuthMe; onLoggedIn: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!auth.required || auth.authenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Badge variant="secondary" className="w-fit tracking-[0.14em]">orchd</Badge>
          <CardDescription>Single-user access</CardDescription>
          <CardTitle>Sign in</CardTitle>
          <p className="text-sm text-muted-foreground">Single-user password auth protects remote control actions when enabled.</p>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setSubmitting(true);
              setError(null);
              try {
                await api.post("/api/auth/login", { password });
                await onLoggedIn();
              } catch (loginError) {
                setError(toUserFacingError("Could not sign in", loginError));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <Button disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</Button>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Sign-in failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </form>
          {!error ? (
            <div className="pt-4">
              <EmptyState
                title="Browser-first control plane"
                description="Sign in to inspect status, approve the next step, reply, interrupt, and inspect artifacts from any browser."
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
