import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/orchd/empty-state";
import type { SessionDetail } from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";

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
          <Tabs
            value={selectedArtifactId ?? artifacts[0]?.id}
            onValueChange={(artifactId) => void onSelect(artifactId)}
            orientation="vertical"
            className="w-full"
          >
            <TabsList variant="line" className="grid h-auto w-full gap-2 bg-transparent p-0">
              {artifacts.map((artifact) => (
                <TabsTrigger
                  key={artifact.id}
                  value={artifact.id}
                  className="h-auto w-full justify-start rounded-2xl border border-border bg-card px-4 py-4 text-left data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10"
                >
                  <div className="grid gap-2 text-left">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-foreground">{artifact.label}</span>
                      <Badge variant="secondary">{artifact.kind}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{artifact.contentType}</span>
                  </div>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
