import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/orchd/empty-state";
import type { SessionDetail } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export function ArtifactList({
  artifacts,
  selectedArtifactId,
  onSelect,
}: {
  artifacts: SessionDetail["artifacts"];
  selectedArtifactId?: string | null;
  onSelect: (id: string) => Promise<void> | void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Artifacts</CardTitle>
      </CardHeader>
      <CardContent>
        {artifacts.length === 0 ? (
          <EmptyState title="No artifacts yet" description="Codex-owned artifacts appear here as soon as the session emits them." />
        ) : (
          <div className="grid gap-3">
            {artifacts.map((artifact) => (
              <Button
                key={artifact.id}
                variant="ghost"
                className={cn(
                  "h-auto justify-start rounded-2xl border border-border/70 px-4 py-4 text-left hover:bg-accent/40",
                  selectedArtifactId === artifact.id && "border-primary/60 bg-primary/10",
                )}
                onClick={() => void onSelect(artifact.id)}
              >
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{artifact.label}</span>
                    <Badge variant="secondary">{artifact.kind}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{artifact.contentType}</span>
                </div>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
