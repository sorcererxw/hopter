import { useState } from "react";
import { Navigate } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthMe } from "@/lib/contracts";
import { api } from "@/lib/api";

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
          <CardDescription>orchd</CardDescription>
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
                setError(loginError instanceof Error ? loginError.message : String(loginError));
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
        </CardContent>
      </Card>
    </main>
  );
}
