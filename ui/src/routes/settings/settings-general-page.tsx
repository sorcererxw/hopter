import { useHostStatus } from "@/features/host/use-host-status"
import { CardTitle } from "@/components/ui/card"

function formatHostStatusLabel(status?: number) {
  switch (status) {
    case 1:
      return "Healthy"
    case 2:
      return "Degraded"
    case 3:
      return "Unavailable"
    default:
      return "Unknown"
  }
}

function statusColor(status?: number) {
  switch (status) {
    case 1:
      return "bg-emerald-500"
    case 2:
      return "bg-amber-500"
    case 3:
      return "bg-red-500"
    default:
      return "bg-zinc-500"
  }
}

export function SettingsGeneralPage() {
  const { data: hostStatus, isLoading } = useHostStatus()

  return (
    <div>
      <CardTitle className="mb-8 text-2xl text-foreground">General</CardTitle>

      <div className="divide-y divide-border">
        <div className="flex items-center justify-between py-4">
          <div>
            <div className="text-foreground">Host status</div>
            <div className="mt-0.5 text-sm font-normal text-muted-foreground">
              Current state reported by the host service
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isLoading ? (
              <span className="text-sm font-normal text-muted-foreground">
                Loading…
              </span>
            ) : (
              <>
                <span
                  className={`size-2 rounded-full ${statusColor(hostStatus?.status)}`}
                />
                <span className="text-sm text-foreground">
                  {formatHostStatusLabel(hostStatus?.status)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
