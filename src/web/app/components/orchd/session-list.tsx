import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { BackendSessionView } from "@/lib/contracts";
import { EmptyState } from "@/components/orchd/empty-state";
import { StatusBadge } from "@/components/orchd/status-badge";

export function SessionList({
  title,
  sessions,
  emptyTitle,
  emptyDescription,
  onSelect,
}: {
  title: string;
  sessions: BackendSessionView[];
  emptyTitle: string;
  emptyDescription: string;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="space-y-4">
            {sessions.map((session, index) => (
              <div key={session.id} className="space-y-4">
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start rounded-2xl border border-border/70 bg-background/35 px-4 py-4 text-left hover:bg-accent/40"
                  onClick={() => onSelect(session.id)}
                >
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-foreground">{session.title ?? session.id}</span>
                      <StatusBadge status={session.status} />
                    </div>
                    <span className="text-sm text-muted-foreground">{session.lastSummary ?? "No summary yet."}</span>
                  </div>
                </Button>
                {index < sessions.length - 1 ? <Separator /> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
