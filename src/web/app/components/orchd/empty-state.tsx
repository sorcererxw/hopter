import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function EmptyState({ title, description, action, className }: { title: string; description: string; action?: ReactNode; className?: string }) {
  return (
    <Card className={cn("border-dashed bg-muted/25 shadow-none", className)}>
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
