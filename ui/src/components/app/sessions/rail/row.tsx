import type { ReactNode } from "react"
import { Link, NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"

export type RailRowProps = {
  activeClassName?: string
  ariaExpanded?: boolean
  asDivInteractive?: boolean
  className?: string
  hoverable?: boolean
  fullWidth?: boolean
  icon: ReactNode
  interactive?: boolean
  label: ReactNode
  labelFill?: boolean
  labelClassName?: string
  nav?: boolean
  onClick?: () => void
  reserveIconSpace?: boolean
  right?: ReactNode
  rightClassName?: string
  title?: string
  to?: string
}

// RailRow is the shared primitive for navigation rows, expandable section
// headers, and passive labels inside the session rail.
export function RailRow({
  activeClassName,
  ariaExpanded,
  asDivInteractive = false,
  className,
  hoverable = false,
  fullWidth = true,
  icon,
  interactive = false,
  label,
  labelFill = true,
  labelClassName,
  nav = false,
  onClick,
  reserveIconSpace = true,
  right,
  rightClassName,
  title,
  to,
}: RailRowProps) {
  const isInteractive =
    interactive || Boolean(to || onClick || ariaExpanded !== undefined)
  const rowClassName = cn(
    "group flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-base leading-6 text-current transition select-none",
    fullWidth ? "w-full" : "w-fit",
    isInteractive ? "cursor-pointer" : undefined,
    hoverable
      ? "hover:bg-background-tertiary active:bg-background-tertiary"
      : undefined,
    className
  )

  const content = (currentIcon: ReactNode) => (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      {reserveIconSpace ? (
        <span className="flex size-5 shrink-0 items-center justify-center text-current">
          {currentIcon}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0",
          labelFill ? "flex-1" : "shrink-0",
          labelClassName
        )}
      >
        {label}
      </span>
      {right ? (
        <span className={cn("shrink-0", rightClassName)}>{right}</span>
      ) : null}
    </span>
  )

  if (to && nav) {
    return (
      <NavLink
        to={to}
        onClick={onClick}
        title={title}
        data-rail-row="true"
        className={({ isActive }) =>
          cn(rowClassName, isActive ? activeClassName : undefined)
        }
      >
        {content(icon)}
      </NavLink>
    )
  }

  if (to) {
    return (
      <Link
        to={to}
        onClick={onClick}
        title={title}
        data-rail-row="true"
        className={rowClassName}
      >
        {content(icon)}
      </Link>
    )
  }

  if (asDivInteractive && onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-rail-row="true"
        className={rowClassName}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            // Keep div-backed rows keyboard-accessible when button semantics are
            // not usable because of surrounding layout constraints.
            event.preventDefault()
            onClick()
          }
        }}
      >
        {content(icon)}
      </div>
    )
  }

  if (onClick || ariaExpanded !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-expanded={ariaExpanded}
        data-rail-row="true"
        className={rowClassName}
      >
        {content(icon)}
      </button>
    )
  }

  return (
    <div data-rail-row="true" className={rowClassName}>
      {content(icon)}
    </div>
  )
}
