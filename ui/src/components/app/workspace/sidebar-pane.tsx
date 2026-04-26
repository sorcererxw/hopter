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
        "flex w-[248px] shrink-0 flex-col border-r border-border bg-background",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
