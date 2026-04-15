import { ChevronDown } from "lucide-react";

export function TerminalDrawer() {
  return (
    <details className="group rounded-[24px] border border-dashed border-border bg-muted/25 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
        Terminal drawer
        <ChevronDown className="size-4 transition group-open:rotate-180" />
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">Still secondary. Present when needed, but intentionally subordinate to status, approvals, and artifacts.</p>
    </details>
  );
}
