import { AlertTriangle } from "lucide-react";

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
    return null;
  }

  return (
    <section className="rounded-[24px] border border-signal-waiting/35 bg-signal-waiting/10 p-4 text-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-signal-waiting/15 text-signal-waiting">
          <AlertTriangle className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal-waiting">Pending approval</p>
            <p className="font-semibold text-foreground">{attention.headline}</p>
            <p className="text-muted-foreground">{attention.reason}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="sm" onClick={() => void onApprove()}>Approve</Button>
            <Button size="sm" variant="secondary" onClick={() => void onReject()}>Reject</Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
