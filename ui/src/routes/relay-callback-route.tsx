import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Button, Card } from "@heroui/react"

import {
  CheckCircle2,
  ChevronRight,
  Terminal,
} from "@/components/icons/hugeicons"

export function RelayCallbackRoute() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isConnected = searchParams.get("status") === "connected"
  const workspaceURL = searchParams.get("workspaceURL")?.trim()

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <Card className="w-full max-w-lg border border-border bg-surface">
        <Card.Header className="space-y-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-success/15 text-success">
            {isConnected ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <Terminal className="size-5" />
            )}
          </div>
          <div>
            <Card.Title>
              {isConnected
                ? t("relayCallback.connectedTitle")
                : t("relayCallback.pendingTitle")}
            </Card.Title>
            <p className="mt-2 text-sm text-muted">
              {isConnected
                ? t("relayCallback.connectedBody")
                : t("relayCallback.pendingBody")}
            </p>
          </div>
        </Card.Header>
        <Card.Content className="space-y-5 text-sm">
          {workspaceURL ? (
            <div className="rounded-lg border border-border bg-surface-secondary p-3">
              <div className="mb-1 text-sm text-muted">
                {t("relayCallback.workspace")}
              </div>
              <div className="break-all text-foreground">{workspaceURL}</div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted">{t("relayCallback.terminalHint")}</p>
            <Button
              className="w-full sm:w-auto"
              onPress={() => {
                navigate("/")
              }}
            >
              {t("relayCallback.openWorkspace")}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  )
}
