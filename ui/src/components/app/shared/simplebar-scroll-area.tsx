import SimpleBar from "simplebar-react"
import type {
  ComponentProps,
  ReactNode,
  RefObject,
  UIEventHandler,
} from "react"

import { cn } from "@/lib/utils"

type SimplebarScrollAreaProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  forceVisible?: ComponentProps<typeof SimpleBar>["forceVisible"]
  onScroll?: UIEventHandler<HTMLDivElement>
  scrollableNodeRef?: RefObject<HTMLDivElement | null>
}

export function SimplebarScrollArea({
  children,
  className,
  contentClassName,
  forceVisible,
  onScroll,
  scrollableNodeRef,
}: SimplebarScrollAreaProps) {
  return (
    <SimpleBar
      autoHide
      forceVisible={forceVisible}
      className={cn("h-full", className)}
      scrollableNodeProps={{
        ref: scrollableNodeRef,
        onScroll,
      }}
    >
      <div className={contentClassName}>{children}</div>
    </SimpleBar>
  )
}
