import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card className="border-dashed bg-muted/35 shadow-none">
      <CardContent className="p-5">
        <div className="grid gap-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{title}</p>
          <p>{description}</p>
          {action ? <div className="pt-3">{action}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
