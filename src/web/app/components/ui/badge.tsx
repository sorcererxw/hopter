import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-[0.08em] uppercase transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        success: "border-signal-complete/30 bg-signal-complete/15 text-foreground",
        warning: "border-signal-waiting/30 bg-signal-waiting/15 text-foreground",
        destructive: "border-signal-failed/30 bg-signal-failed/15 text-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
