import type { ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function PageHero({
  eyebrow,
  title,
  description,
  status,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card className="bg-[linear-gradient(180deg,rgba(30,41,59,0.98),rgba(15,23,42,0.92))]">
      <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">{eyebrow}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p> : null}
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </CardHeader>
      {actions ? <CardContent className="pt-0">{actions}</CardContent> : null}
    </Card>
  );
}
