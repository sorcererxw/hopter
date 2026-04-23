import { useEffect, useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

// useTranscriptDisclosure provides simple local expanded/collapsed state for static disclosure sections.
export function useTranscriptDisclosure(defaultExpanded = false) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return [expanded, () => setExpanded((prev) => !prev)] as const
}

// useActivitySyncedDisclosure keeps a disclosure open while the underlying activity remains active.
export function useActivitySyncedDisclosure(active: boolean) {
  const [expanded, setExpanded] = useState(active)

  useEffect(() => {
    setExpanded(active)
  }, [active])

  return [expanded, () => setExpanded((prev) => !prev)] as const
}

// TranscriptDisclosureItem wraps a disclosure button together with auto-managed expanded body content.
export function TranscriptDisclosureItem({
  active = false,
  buttonClassName,
  children,
  iconClassName,
  label,
  title,
}: {
  active?: boolean
  buttonClassName?: string
  children: ReactNode
  iconClassName?: string
  label: ReactNode
  title?: string
}) {
  const [expanded, toggleExpanded] = useActivitySyncedDisclosure(active)

  return (
    <div className="min-w-0">
      <TranscriptDisclosureButton
        expanded={expanded}
        iconClassName={iconClassName}
        className={buttonClassName}
        onClick={toggleExpanded}
        title={title}
      >
        {label}
      </TranscriptDisclosureButton>
      {expanded ? children : null}
    </div>
  )
}

// TranscriptDisclosureButton renders the shared disclosure trigger with the rotating chevron affordance.
export function TranscriptDisclosureButton({
  children,
  className,
  expanded,
  iconClassName,
  ...props
}: React.ComponentProps<"button"> & {
  expanded: boolean
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className={cn(
        "group inline-flex max-w-full items-center text-left transition",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "shrink-0 transition",
          expanded
            ? "rotate-90 opacity-100"
            : "opacity-60 group-hover:opacity-100",
          iconClassName
        )}
      />
    </button>
  )
}
