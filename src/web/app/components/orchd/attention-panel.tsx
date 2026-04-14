import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { SessionDetail } from "@/lib/contracts";

export function AttentionPanel({
  attention,
  onApprove,
  onReject,
  error,
}: {
  attention: SessionDetail["attention"];
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  error?: string | null;
}) {
  if (!attention) {
    return (
      <Alert>
        <AlertTitle>Attention</AlertTitle>
        <AlertDescription>No action required.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="warning" className="space-y-4">
      <div className="space-y-2">
        <AlertTitle>Attention</AlertTitle>
        <AlertDescription>
          <span className="block font-medium text-foreground">{attention.headline}</span>
          <span className="mt-1 block">{attention.reason}</span>
        </AlertDescription>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void onApprove()}>Approve</Button>
        <Button variant="secondary" onClick={() => void onReject()}>Reject</Button>
      </div>
      {error ? <p className="text-sm text-foreground">{error}</p> : null}
    </Alert>
  );
}
