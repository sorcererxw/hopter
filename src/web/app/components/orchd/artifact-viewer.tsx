import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ArtifactDetail } from "@/lib/contracts";

export function ArtifactViewer({
  artifactDetail,
  loading = false,
  error = null,
}: {
  artifactDetail: ArtifactDetail | null;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{artifactDetail?.artifact.label ?? "Artifact viewer"}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading artifact…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : artifactDetail?.content ? (
          <ScrollArea className="max-h-[30rem] rounded-[22px] border border-border bg-background/70 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm text-foreground">{artifactDetail.content}</pre>
          </ScrollArea>
        ) : artifactDetail?.downloadUrl ? (
          <a className="text-sm font-medium text-foreground underline underline-offset-4" href={artifactDetail.downloadUrl}>
            Download artifact
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">Pick an artifact to inspect it inline.</p>
        )}
      </CardContent>
    </Card>
  );
}
