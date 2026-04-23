import { useTranslation } from "react-i18next"

import { SessionStatus } from "@/gen/proto/hopter/v1/common_pb"
import type { Session } from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

import type { SessionEventStreamState } from "./model"

export function SessionConnectionBlock({
  state,
}: {
  state: SessionEventStreamState
}) {
  const { t } = useTranslation()
  if (state === "connected") {
    return null
  }

  const display = getConnectionDisplay(state, t)

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

function getConnectionDisplay(
  state: SessionEventStreamState,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (state) {
    case "connecting":
      return {
        body: t("session.connectingBody"),
        bodyClassName: "text-muted-foreground",
        containerClassName: "border-border bg-card",
        detail: t("session.connectingDetail"),
        title: t("session.connecting"),
        titleClassName: "text-foreground",
      }
    case "reconnecting":
      return {
        body: t("session.reconnectingBody"),
        bodyClassName: "text-amber-900 dark:text-amber-50",
        containerClassName: "border-amber-400/20 bg-amber-400/10",
        detail: t("session.reconnectingDetail"),
        title: t("session.reconnecting"),
        titleClassName: "text-amber-800 dark:text-amber-100",
      }
    case "offline":
      return {
        body: t("session.offlineBody"),
        bodyClassName: "text-destructive",
        containerClassName: "border-destructive/20 bg-destructive/10",
        detail: t("session.offlineDetail"),
        title: t("session.offline"),
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
  const { t } = useTranslation()
  const attention = getSessionAttentionDisplay(session, t)

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
            {t("session.approve")}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-transparent px-3 font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={responding}
            onClick={onReject}
          >
            {t("session.reject")}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function getSessionAttentionDisplay(
  session: Session,
  t: ReturnType<typeof useTranslation>["t"]
) {
  const reason = session.attentionReason.trim()
  const summary = session.summary.trim()

  if (
    session.pendingApprovalId ||
    session.status === SessionStatus.WAITING_APPROVAL
  ) {
    return {
      body: reason || t("session.approvalRequiredBody"),
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: t("session.approvalRequiredDetail"),
      title: t("session.approvalRequired"),
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.status === SessionStatus.FAILED) {
    return {
      body: reason || summary || t("session.turnFailedBody"),
      bodyClassName: "text-destructive",
      containerClassName: "border-destructive/20 bg-destructive/10",
      detail: t("session.turnFailedDetail"),
      title: t("session.turnFailed"),
      titleClassName: "text-destructive",
    }
  }

  if (session.status === SessionStatus.DEGRADED) {
    return {
      body: reason || summary || t("session.degradedBody"),
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: t("session.degradedDetail"),
      title: t("session.degraded"),
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.status === SessionStatus.WAITING_INPUT) {
    return {
      body: reason || t("session.inputNeededBody"),
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: t("session.inputNeededDetail"),
      title: t("session.inputNeeded"),
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.attentionRequired) {
    return {
      body: reason || t("session.attentionBody"),
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: "",
      title: t("session.attention"),
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  return null
}
