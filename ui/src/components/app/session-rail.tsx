import { CircleDot, Clock3, MessageSquarePlus } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router-dom"
import { timestampDate } from "@bufbuild/protobuf/wkt"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useSessions } from "@/features/sessions/use-sessions"
import { cn } from "@/lib/utils"

function statusTone(attentionRequired: boolean) {
  return attentionRequired ? "destructive" : "secondary"
}

function formatUpdatedAt(value?: Date | string) {
  if (!value) {
    return "Waiting for activity"
  }

  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function SessionRail() {
  const location = useLocation()
  const { data: sessions, isLoading, isError } = useSessions()

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="session-list">
      <div className="flex items-center gap-2 px-5 py-4">
        <Button asChild className="flex-1" size="sm">
          <Link to="/">
            <MessageSquarePlus className="size-4" />
            New session
          </Link>
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 pb-4">
        <div className="space-y-2">
          {isLoading
            ? Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="rounded-xl border border-border/60 bg-background/80 p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                  <Skeleton className="mt-4 h-3 w-1/2" />
                </div>
              ))
            : null}

          {isError ? (
            <div className="rounded-xl border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
              Session list unavailable. The shell is ready once the Go services respond.
            </div>
          ) : null}

          {sessions?.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
              No sessions yet. Start the first one from the composer.
            </div>
          ) : null}

          {sessions?.map((session) => {
            const active = location.pathname === `/sessions/${session.id}`

            return (
              <NavLink
                key={session.id}
                to={`/sessions/${session.id}`}
                className={cn(
                  "block rounded-2xl border p-3 transition-colors",
                  active
                    ? "border-primary/30 bg-primary/6"
                    : "border-border/70 bg-background/70 hover:bg-muted/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{session.title || "Untitled session"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {session.project?.name || "Unassigned project"}
                    </p>
                  </div>
                  <Badge variant={statusTone(session.attentionRequired)}>
                    {session.attentionRequired ? <CircleDot className="size-3" /> : <Clock3 className="size-3" />}
                    {session.status.toString().replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Updated {formatUpdatedAt(session.updatedAt ? timestampDate(session.updatedAt) : undefined)}
                </p>
              </NavLink>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
