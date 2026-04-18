import { useNavigate } from "react-router-dom"

import { useLogin } from "@/features/auth/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function LoginRoute() {
  const navigate = useNavigate()
  const login = useLogin()

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Local development mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            The rebuild currently assumes localhost-only access without a
            password gate.
          </p>
          <Button
            onClick={async () => {
              await login.mutateAsync()
              navigate("/")
            }}
          >
            Enter workspace
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
