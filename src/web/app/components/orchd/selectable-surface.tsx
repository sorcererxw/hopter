import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SelectableSurface({
  title,
  description,
  meta,
  aside,
  selected = false,
  onSelect,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={selected}
      className={cn(
        "h-auto w-full justify-start rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-all hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60",
        selected && "border-primary/60 bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_40%,transparent)]",
        className,
      )}
      onClick={onSelect}
    >
      <div className="grid w-full gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            {meta ? <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">{meta}</div> : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
    </Button>
  );
}
