import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Badge variant="secondary" className="w-fit tracking-[0.12em]">{eyebrow}</Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p> : null}
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </CardHeader>
      {actions ? (
        <>
          <Separator />
          <CardContent className="pt-6">{actions}</CardContent>
        </>
      ) : null}
    </Card>
  );
}
