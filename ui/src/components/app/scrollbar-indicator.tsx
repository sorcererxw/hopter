import { cn } from "@/lib/utils"

type ScrollbarIndicatorProps = {
  scrollable: boolean
  thumbHeight: number
  thumbOffset: number
  visible: boolean
}

export function ScrollbarIndicator({
  scrollable,
  thumbHeight,
  thumbOffset,
  visible,
}: ScrollbarIndicatorProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-1 right-1 w-1.5"
    >
      <div
        className={cn(
          "absolute right-0 w-1 rounded-full bg-border transition-opacity duration-300 ease-out",
          visible && scrollable ? "opacity-100" : "opacity-0"
        )}
        style={{
          height: `${thumbHeight}px`,
          transform: `translateY(${thumbOffset}px)`,
        }}
      />
    </div>
  )
}
