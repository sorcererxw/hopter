import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SelectableSurface } from "@/components/orchd/selectable-surface";
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
                <SelectableSurface
                  title={session.title ?? session.id}
                  description={session.lastSummary ?? "No summary yet."}
                  meta={session.backendSessionId ? <span>{session.backendSessionId}</span> : undefined}
                  aside={<StatusBadge status={session.status} />}
                  onSelect={() => onSelect(session.id)}
                />
                {index < sessions.length - 1 ? <Separator /> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
