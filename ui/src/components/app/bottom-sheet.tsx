import { useEffect, type ReactNode } from "react"

import { cn } from "@/lib/utils"

type BottomSheetProps = {
  children: ReactNode
  onClose: () => void
  open: boolean
  title: string
}

export function BottomSheet({ children, onClose, open, title }: BottomSheetProps) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-xl border-t border-border bg-popover pb-[env(safe-area-inset-bottom)]",
          "animate-in slide-in-from-bottom duration-200"
        )}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-popover px-4 py-3">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            Done
          </button>
        </div>
        <div className="py-1">{children}</div>
      </div>
    </div>
  )
}

export function BottomSheetItem({
  active = false,
  children,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center px-4 py-3 text-base text-foreground transition",
        active ? "bg-accent font-medium" : "hover:bg-accent"
      )}
    >
      {children}
    </button>
  )
}
