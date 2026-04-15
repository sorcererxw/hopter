import { ChevronDown } from "lucide-react";

export function TimelinePanel() {
  return (
    <details className="group rounded-[24px] border border-border bg-card/70 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
        Timeline
        <ChevronDown className="size-4 transition group-open:rotate-180" />
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">Timeline stays compressed by default. Raw event drill-down can grow later, but it should never drown the conversation surface.</p>
    </details>
  );
}
