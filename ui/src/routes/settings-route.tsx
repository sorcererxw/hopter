import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

import { WorkspacePageToolbar } from "@/components/app/workspace-page-toolbar"
import { useTheme } from "@/components/theme-provider"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useBackends } from "@/features/host/use-host-backends"
import { useHostStatus } from "@/features/host/use-host-status"
import { cn } from "@/lib/utils"

const THEME_OPTIONS = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
] as const

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

function hostStatusColor(status?: number) {
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

function availabilityColor(available: boolean) {
  return available ? "bg-emerald-500" : "bg-zinc-500"
}

function SettingsSection({
  children,
  id,
  title,
}: {
  children: ReactNode
  id: string
  title: string
}) {
  return (
    <section id={id} className="scroll-mt-16">
      <h2 className="mb-3 text-2xl leading-tight text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function SettingsRow({
  action,
  description,
  label,
}: {
  action: ReactNode
  description?: string
  label: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-sm font-normal text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

export function SettingsRoute() {
  const location = useLocation()
  const { resolvedTheme, theme, setTheme } = useTheme()
  const { data: hostStatus, isLoading: hostStatusLoading } = useHostStatus()
  const { data: backends, isLoading: backendsLoading } = useBackends()

  if (
    location.hash === "#plugins" ||
    location.hash === "#skills" ||
    location.hash === "#mcp"
  ) {
    return <Navigate to="/plugins" replace />
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="settings-workspace-pane"
    >
      <WorkspacePageToolbar title="Settings" showOverflowMenu={false} />

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
          <SettingsSection id="general" title="General">
            <div className="divide-y divide-border rounded-lg border border-border">
              <SettingsRow
                label="Host status"
                description="Current state reported by the host service"
                action={
                  <div className="flex items-center gap-2 text-sm">
                    {hostStatusLoading ? (
                      <span className="font-normal text-muted-foreground">
                        Loading...
                      </span>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            hostStatusColor(hostStatus?.status)
                          )}
                        />
                        <span className="text-foreground">
                          {formatHostStatusLabel(hostStatus?.status)}
                        </span>
                      </>
                    )}
                  </div>
                }
              />
            </div>
          </SettingsSection>

          <SettingsSection id="appearance" title="Appearance">
            <div className="divide-y divide-border rounded-lg border border-border">
              <SettingsRow
                label="Theme"
                description={
                  theme === "system"
                    ? `Following ${resolvedTheme}`
                    : "Workspace theme preference"
                }
                action={
                  <NativeSelect
                    aria-label="Theme"
                    className="min-w-40"
                    value={theme}
                    onChange={(event) =>
                      setTheme(
                        event.target.value as "dark" | "light" | "system"
                      )
                    }
                  >
                    {THEME_OPTIONS.map((option) => (
                      <NativeSelectOption
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                }
              />
            </div>
          </SettingsSection>

          <SettingsSection id="agents" title="Agents">
            {backendsLoading ? (
              <div className="rounded-lg border border-border py-8 text-center text-sm font-normal text-muted-foreground">
                Loading backends...
              </div>
            ) : !backends || backends.length === 0 ? (
              <div className="rounded-lg border border-border py-8 text-center text-sm font-normal text-muted-foreground">
                No backends discovered
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {backends.map((backend) => (
                  <div
                    key={backend.backendKey}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0 truncate text-sm text-foreground">
                      {backend.backendKey}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          availabilityColor(backend.available)
                        )}
                      />
                      <span className="font-normal text-muted-foreground">
                        {backend.available ? "Available" : "Unavailable"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
