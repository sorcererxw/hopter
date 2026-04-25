import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react"

import { cn } from "@/lib/utils"

import { workspaceScrollbarClassName } from "./style-classnames"

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
        workspaceScrollbarClassName,
        "max-w-full overflow-x-auto rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm leading-6 text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  )
}
