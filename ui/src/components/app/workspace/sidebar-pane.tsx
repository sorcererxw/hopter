import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/utils"

export function SidebarPane({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full shrink-0 flex-col border-r border-border bg-background-secondary text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
