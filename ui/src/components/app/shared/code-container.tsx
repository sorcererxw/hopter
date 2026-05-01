import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react"
import SimpleBar from "simplebar-react"

import { cn } from "@/lib/utils"

type CodeContainerProps<T extends ElementType = "div"> = {
  as?: T
  children: ReactNode
  className?: string
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">

export function CodeContainer<T extends ElementType = "div">({
  as,
  children,
  className,
  ...props
}: CodeContainerProps<T>) {
  const Component = (as || "div") as ElementType

  return (
    <Component
      className={cn(
        "max-w-full overflow-hidden rounded-lg border border-border bg-surface-secondary px-4 py-3 font-mono text-sm leading-6 text-foreground shadow-sm shadow-black/5",
        className
      )}
      {...props}
    >
      <SimpleBar autoHide className="max-h-[inherit] max-w-full">
        {children}
      </SimpleBar>
    </Component>
  )
}
