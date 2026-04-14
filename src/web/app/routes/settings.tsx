import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import type { HostStatus } from "@/lib/contracts";
import { usePolling } from "@/lib/hooks";

export function SettingsRoute() {
  const { data: host } = usePolling(() => api.get<HostStatus>("/api/host/status"), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Host health</CardTitle>
        <CardDescription>Raw host and backend status for local inspection.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[32rem] rounded-2xl border border-border/70 bg-slate-950/60 p-4">
          <pre className="whitespace-pre-wrap break-words text-sm text-slate-100">{JSON.stringify(host, null, 2)}</pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
