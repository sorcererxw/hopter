import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function LoginRoute() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Local development mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>The rebuild currently assumes localhost-only access without a password gate.</p>
          <Button asChild>
            <Link to="/">Enter workspace</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
