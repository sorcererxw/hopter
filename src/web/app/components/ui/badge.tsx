import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-[0.08em] uppercase transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        success: "border-emerald-400/20 bg-emerald-500/15 text-emerald-200",
        warning: "border-amber-400/20 bg-amber-400/15 text-amber-100",
        destructive: "border-red-400/20 bg-red-500/15 text-red-100",
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
