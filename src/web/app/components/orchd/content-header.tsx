import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ContentHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 rounded-[28px] border border-border bg-card/90 px-5 py-4 shadow-sm backdrop-blur md:px-6", className)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/90">{eyebrow}</p> : null}
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h1>
            {description ? <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p> : null}
          </div>
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
