import { FileText, ImageIcon, TestTube2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/orchd/empty-state";
import type { SessionDetail } from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function artifactIcon(kind: string) {
  if (kind.includes("screenshot")) return ImageIcon;
  if (kind.includes("test")) return TestTube2;
  return FileText;
}

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
          <EmptyState title="No artifacts yet" description="Artifacts will show up inline as the session produces summaries, diffs, tests, and screenshots." />
        ) : (
          <div className="space-y-2">
            {artifacts.map((artifact) => {
              const Icon = artifactIcon(artifact.kind);
              const isSelected = selectedArtifactId === artifact.id;
              return (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => void onSelect(artifact.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-[22px] border px-3 py-3 text-left transition",
                    isSelected ? "border-primary/60 bg-primary/10" : "border-border bg-background/60 hover:border-primary/30 hover:bg-accent/40",
                  )}
                >
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{artifact.label}</span>
                      <Badge variant="secondary">{artifact.kind}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{artifact.contentType}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
