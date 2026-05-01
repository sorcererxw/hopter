import { type ReactNode } from "react"
import { ChevronRight } from "@/components/icons/hugeicons"

import { cn } from "@/lib/utils"

import { useActivitySyncedDisclosure } from "./timeline-disclosure-state"

// TranscriptDisclosureItem wraps a disclosure button together with auto-managed expanded body content.
export function TranscriptDisclosureItem({
  active = false,
  buttonClassName,
  children,
  disclosureKey,
  iconClassName,
  label,
  title,
}: {
  active?: boolean
  buttonClassName?: string
  children: ReactNode
  disclosureKey?: string
  iconClassName?: string
  label: ReactNode
  title?: string
}) {
  const [expanded, toggleExpanded] = useActivitySyncedDisclosure(
    active,
    disclosureKey
  )

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
      <TranscriptDisclosureBody expanded={expanded}>
        {children}
      </TranscriptDisclosureBody>
    </div>
  )
}

// TranscriptDisclosureBody avoids layout-property animation because transcript
// bodies can contain markdown, syntax highlighting, and large diffs.
export function TranscriptDisclosureBody({
  children,
  expanded,
}: {
  children: ReactNode
  expanded: boolean
}) {
  return (
    <div
      aria-hidden={!expanded}
      className={cn(
        "overflow-hidden",
        expanded ? "opacity-100" : "pointer-events-none hidden opacity-0"
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

// TranscriptDisclosureButton renders the shared disclosure trigger with the rotating chevron affordance.
export function TranscriptDisclosureButton({
  children,
  className,
  expanded,
  iconClassName,
  onClick,
  ...props
}: React.ComponentProps<"button"> & {
  expanded: boolean
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
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
