import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function SettingsRoute() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Settings</p>
        <h2 className="text-3xl font-semibold tracking-tight">Local dev controls</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dev-local mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>This rebuild assumes localhost-only access without a password while the Go backend is still under active development.</p>
          <p>Future auth and relay controls will land here without disturbing the main workspace shell.</p>
        </CardContent>
      </Card>
    </div>
  )
}
