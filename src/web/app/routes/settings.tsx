import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHero } from "@/components/orchd/page-hero";
import { StatusBadge } from "@/components/orchd/status-badge";
import { ThemeControls } from "@/components/orchd/theme-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "@/lib/api";
import type { HostStatus } from "@/lib/contracts";
import { usePolling } from "@/lib/hooks";
import { toUserFacingError } from "@/lib/utils";

export function SettingsRoute() {
  const { data: host, error, loading } = usePolling(() => api.get<HostStatus>("/api/host/status"), []);

  return (
    <section className="grid gap-4">
      <PageHero
        eyebrow="Settings"
        title={host?.status ?? "Host health"}
        description="Raw host and backend status for local inspection."
        status={host ? <StatusBadge status={host.status} /> : null}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Host status unavailable</AlertTitle>
          <AlertDescription>{toUserFacingError("Could not refresh host health", new Error(error))}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Tailwind + shadcn class-based theme selection with semantic tokens.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeControls />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Host status JSON</CardTitle>
          <CardDescription>{loading ? "Refreshing host health…" : "Current normalized host status."}</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[32rem] rounded-2xl border border-border bg-muted/40 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm text-foreground">{JSON.stringify(host, null, 2)}</pre>
          </ScrollArea>
        </CardContent>
      </Card>
    </section>
  );
}
