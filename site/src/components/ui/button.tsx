import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

    const variants = {
      default: "bg-white text-black hover:bg-gray-200",
      secondary:
        "border border-[var(--color-border-strong)] text-white hover:border-white/40 hover:bg-white/5",
      outline:
        "border border-[var(--color-border)] bg-transparent text-white hover:bg-white/5",
      ghost: "text-[var(--color-muted)] hover:text-white hover:bg-white/5",
    };

    const sizes = {
      default: "h-10 px-6 text-sm",
      sm: "h-8 px-4 text-xs",
      lg: "h-12 px-8 text-base",
    };

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
