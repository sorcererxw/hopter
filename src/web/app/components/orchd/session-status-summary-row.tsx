import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SessionStatusSummaryRow({ degraded, latestSummary }: { degraded: boolean; latestSummary: string | null }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{degraded ? "Degraded: live attachment truth is reduced." : "Live session state is current."}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Latest summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{latestSummary ?? "No summary yet."}</p>
        </CardContent>
      </Card>
    </div>
  );
}
