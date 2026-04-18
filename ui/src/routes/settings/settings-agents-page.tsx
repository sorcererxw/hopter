import { useBackends } from "@/features/host/use-host-backends"
import { CardTitle } from "@/components/ui/card"

export function SettingsAgentsPage() {
  const { data: backends, isLoading } = useBackends()

  return (
    <div>
      <CardTitle className="mb-8 text-2xl text-foreground">Agents</CardTitle>

      {isLoading ? (
        <div className="py-8 text-center text-sm font-normal text-muted-foreground">
          Loading backends…
        </div>
      ) : !backends || backends.length === 0 ? (
        <div className="py-8 text-center text-sm font-normal text-muted-foreground">
          No backends discovered
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {backends.map((backend) => (
            <div
              key={backend.backendKey}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="text-sm text-foreground">
                {backend.backendKey}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`size-2 rounded-full ${backend.available ? "bg-emerald-500" : "bg-zinc-500"}`}
                />
                <span className="text-sm font-normal text-muted-foreground">
                  {backend.available ? "Available" : "Unavailable"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
