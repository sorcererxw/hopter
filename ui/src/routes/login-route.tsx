import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Button, Card } from "@heroui/react"

import { useLogin } from "@/features/auth/use-auth"

export function LoginRoute() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useLogin()

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{t("login.localDevelopmentMode")}</Card.Title>
        </Card.Header>
        <Card.Content className="space-y-4 text-sm text-muted">
          <p>{t("login.localDevelopmentModeBody")}</p>
          <Button
            onPress={async () => {
              await login.mutateAsync()
              navigate("/")
            }}
          >
            {t("login.enterWorkspace")}
          </Button>
        </Card.Content>
      </Card>
    </div>
  )
}
