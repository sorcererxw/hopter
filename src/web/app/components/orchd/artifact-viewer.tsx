import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ArtifactDetail } from "@/lib/contracts";

export function ArtifactViewer({ artifactDetail }: { artifactDetail: ArtifactDetail | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Artifact viewer</CardTitle>
      </CardHeader>
      <CardContent>
        {artifactDetail?.content ? (
          <ScrollArea className="max-h-[28rem] rounded-2xl border border-border/70 bg-slate-950/60 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm text-slate-100">{artifactDetail.content}</pre>
          </ScrollArea>
        ) : (
          <p className="text-sm text-muted-foreground">Select an artifact to inspect it.</p>
        )}
      </CardContent>
    </Card>
  );
}
