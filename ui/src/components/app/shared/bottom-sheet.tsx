import { useEffect, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@heroui/react"

import { cn } from "@/lib/utils"

type BottomSheetProps = {
  children: ReactNode
  onClose: () => void
  open: boolean
  title: string
}

export function BottomSheet({
  children,
  onClose,
  open,
  title,
}: BottomSheetProps) {
  const { t } = useTranslation()

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
          "absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-xl border-t border-border bg-overlay pb-[env(safe-area-inset-bottom)]",
          "animate-in duration-200 slide-in-from-bottom"
        )}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-overlay px-4 py-3 text-sm text-foreground">
          <span className="text-foreground">{title}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onPress={onClose}
            className="text-muted"
          >
            {t("common.done")}
          </Button>
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
    <Button
      type="button"
      onPress={onClick}
      variant="ghost"
      className={cn(
        "flex w-full items-center px-4 py-3 text-base text-foreground",
        active ? "bg-surface-tertiary" : "hover:bg-surface-tertiary"
      )}
    >
      {children}
    </Button>
  )
}
