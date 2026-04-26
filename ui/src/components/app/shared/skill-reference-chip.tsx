import { Hammer, Package } from "lucide-react"
import type { ComponentPropsWithoutRef } from "react"

import { cn } from "@/lib/utils"

export function SkillReferenceChip({
  className,
  description,
  name,
  reference,
  tooltipPlacement = "top",
  variant = "skill",
  ...props
}: {
  description?: string
  name?: string
  reference: string
  source?: string
  tooltipPlacement?: "bottom" | "top"
  variant?: "plugin" | "skill"
} & Omit<ComponentPropsWithoutRef<"span">, "children">) {
  const tooltipDescription = description?.trim() || name?.trim() || reference
  const Icon = variant === "plugin" ? Hammer : Package
  const displayLabel = name?.trim() || reference
  const tooltipPlacementClassName =
    tooltipPlacement === "bottom" ? "top-full mt-2" : "bottom-full mb-2"

  return (
    <span
      className={cn(
        "group relative inline-flex max-w-full cursor-default items-center gap-1 rounded-md bg-accent px-1 py-0.5 font-semibold whitespace-nowrap text-accent-foreground [&_svg]:text-accent-foreground",
        className
      )}
      {...props}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0" data-testid="reference-chip-label">
        {displayLabel}
      </span>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 hidden w-80 max-w-xs -translate-x-1/2 rounded-lg border border-border bg-overlay px-3 py-2 text-left text-sm leading-5 whitespace-normal text-overlay-foreground shadow-lg group-hover:block",
          tooltipPlacementClassName
        )}
        data-testid="skill-reference-tooltip"
      >
        <span className="line-clamp-3 block">{tooltipDescription}</span>
      </span>
    </span>
  )
}
