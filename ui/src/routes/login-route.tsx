import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { useLogin } from "@/features/auth/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function LoginRoute() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useLogin()

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("login.localDevelopmentMode")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>{t("login.localDevelopmentModeBody")}</p>
          <Button
            onClick={async () => {
              await login.mutateAsync()
              navigate("/")
            }}
          >
            {t("login.enterWorkspace")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
