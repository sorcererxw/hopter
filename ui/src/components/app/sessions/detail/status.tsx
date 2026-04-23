import { SessionStatus } from "@/gen/proto/hopter/v1/common_pb"
import type { Session } from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

import type { SessionEventStreamState } from "./model"

export function SessionConnectionBlock({
  state,
}: {
  state: SessionEventStreamState
}) {
  if (state === "connected") {
    return null
  }

  const display = getConnectionDisplay(state)

  return (
    <section
      className={cn("rounded-lg border px-4 py-3", display.containerClassName)}
      data-testid="session-connection-block"
      aria-label={display.title}
    >
      <div className={cn("text-sm font-medium", display.titleClassName)}>
        {display.title}
      </div>
      <p
        className={cn(
          "mt-1 text-base leading-6 font-medium",
          display.bodyClassName
        )}
      >
        {display.body}
      </p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {display.detail}
      </p>
    </section>
  )
}

function getConnectionDisplay(state: SessionEventStreamState) {
  switch (state) {
    case "connecting":
      return {
        body: "Connecting to live session updates.",
        bodyClassName: "text-muted-foreground",
        containerClassName: "border-border bg-card",
        detail:
          "The cached session view is visible while the browser opens the event stream.",
        title: "Connecting",
        titleClassName: "text-foreground",
      }
    case "reconnecting":
      return {
        body: "Live updates are reconnecting.",
        bodyClassName: "text-amber-900 dark:text-amber-50",
        containerClassName: "border-amber-400/20 bg-amber-400/10",
        detail:
          "Inspect history and artifacts normally, but wait for reconnection before trusting live control state.",
        title: "Reconnecting",
        titleClassName: "text-amber-800 dark:text-amber-100",
      }
    case "offline":
      return {
        body: "The browser is offline.",
        bodyClassName: "text-destructive",
        containerClassName: "border-destructive/20 bg-destructive/10",
        detail:
          "This page is effectively read-only until network connectivity returns.",
        title: "Offline",
        titleClassName: "text-destructive",
      }
    case "connected":
    default:
      return {
        body: "",
        bodyClassName: "",
        containerClassName: "",
        detail: "",
        title: "",
        titleClassName: "",
      }
  }
}

export function SessionAttentionBlock({
  onApprove,
  onReject,
  responding,
  session,
}: {
  onApprove: () => void
  onReject: () => void
  responding: boolean
  session: Session
}) {
  const attention = getSessionAttentionDisplay(session)

  if (!attention) {
    return null
  }

  return (
    <section
      className={cn(
        "rounded-lg border px-4 py-3",
        attention.containerClassName
      )}
      data-testid="session-attention-block"
      aria-label={attention.title}
    >
      <div className={cn("mb-1 text-sm font-medium", attention.titleClassName)}>
        {attention.title}
      </div>
      <p
        className={cn(
          "text-base leading-7 font-medium",
          attention.bodyClassName
        )}
      >
        {attention.body}
      </p>
      {attention.detail ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {attention.detail}
        </p>
      ) : null}
      {session.pendingApprovalId ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 font-medium text-emerald-700 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-100"
            disabled={responding}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-transparent px-3 font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={responding}
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      ) : null}
    </section>
  )
}

function getSessionAttentionDisplay(session: Session) {
  const reason = session.attentionReason.trim()
  const summary = session.summary.trim()

  if (
    session.pendingApprovalId ||
    session.status === SessionStatus.WAITING_APPROVAL
  ) {
    return {
      body: reason || "Codex needs approval before it can continue.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: "Review the request before approving or rejecting the next step.",
      title: "Approval required",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.status === SessionStatus.FAILED) {
    return {
      body: reason || summary || "This thread failed before it could complete.",
      bodyClassName: "text-destructive",
      containerClassName: "border-destructive/20 bg-destructive/10",
      detail:
        "You can send a follow-up with more context or retry from the composer.",
      title: "Turn failed",
      titleClassName: "text-destructive",
    }
  }

  if (session.status === SessionStatus.DEGRADED) {
    return {
      body:
        reason ||
        summary ||
        "This thread is available, but live state may be incomplete.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail:
        "Inspect history and artifacts normally, but treat live control state as partially reliable.",
      title: "Degraded state",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.status === SessionStatus.WAITING_INPUT) {
    return {
      body: reason || "Codex is waiting for your next instruction.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: "Use the composer below to steer this thread.",
      title: "Input needed",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.attentionRequired) {
    return {
      body: reason || "This session requires user input.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: "",
      title: "Attention",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  return null
}
