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
        <CardTitle>Artifact viewer</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading artifact…</p>
        ) : error ? (
          <p className="text-sm text-foreground">{error}</p>
        ) : artifactDetail?.content ? (
          <ScrollArea className="max-h-[28rem] rounded-2xl border border-border bg-muted/40 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm text-foreground">{artifactDetail.content}</pre>
          </ScrollArea>
        ) : artifactDetail?.downloadUrl ? (
          <a className="text-sm font-medium text-foreground underline underline-offset-4" href={artifactDetail.downloadUrl}>
            Download artifact
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">Select an artifact to inspect it.</p>
        )}
      </CardContent>
    </Card>
  );
}
