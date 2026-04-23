import { useEffect, useState, type ReactNode } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { Navigate, useLocation } from "react-router-dom"

import { WorkspacePageToolbar } from "@/components/app/workspace"
import { useTheme } from "@/components/theme-provider"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useBackends } from "@/features/host/use-host-backends"
import { useHostStatus } from "@/features/host/use-host-status"
import {
  composerSendShortcutPreferenceFromConfig,
  composerSendShortcutPreferenceToProto,
  formatComposerSendShortcutPreference,
  useConfig,
  useUpdateConfig,
  type ComposerSendShortcutPreference,
} from "@/features/config/use-config"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

const THEME_OPTIONS = [
  { labelKey: "app.settings.themeSystem", value: "system" },
  { labelKey: "app.settings.themeDark", value: "dark" },
  { labelKey: "app.settings.themeLight", value: "light" },
] as const

const LOCALE_OPTIONS = [
  { labelKey: "app.locale.system", value: "system" },
  { labelKey: "app.locale.en", value: "en" },
  { labelKey: "app.locale.zhCN", value: "zh-CN" },
] as const

const COMPOSER_SEND_SHORTCUT_OPTIONS = [
  { value: "cmd-enter" },
  { value: "enter" },
] as const

// These labels mirror backend enums but stay numeric here to avoid leaking the
// generated transport layer into the rest of the settings UI.
function formatHostStatusLabel(status: number | undefined, t: TFunction) {
  switch (status) {
    case 1:
      return t("app.status.healthy")
    case 2:
      return t("app.status.degraded")
    case 3:
      return t("app.status.unavailable")
    default:
      return t("app.status.unknown")
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

// Shared section wrapper keeps the settings page consistent while still letting
// each category own its own controls and descriptions.
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

// SettingsRoute is the control-plane settings page for host health, appearance,
// defaults, and backend availability. It is not intended to expose raw config.
export function SettingsRoute() {
  const { t } = useTranslation()
  const location = useLocation()
  const { resolvedTheme, theme, setTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  const configQuery = useConfig()
  const updateConfig = useUpdateConfig()
  const { data: hostStatus, isLoading: hostStatusLoading } = useHostStatus()
  const { data: backends, isLoading: backendsLoading } = useBackends()
  const configSendShortcut = composerSendShortcutPreferenceFromConfig(
    configQuery.data
  )
  const [optimisticSendShortcut, setOptimisticSendShortcut] =
    useState<ComposerSendShortcutPreference | null>(null)
  const sendShortcut = optimisticSendShortcut ?? configSendShortcut

  useEffect(() => {
    if (optimisticSendShortcut === configSendShortcut) {
      setOptimisticSendShortcut(null)
    }
  }, [configSendShortcut, optimisticSendShortcut])

  if (
    location.hash === "#plugins" ||
    location.hash === "#skills" ||
    location.hash === "#mcp"
  ) {
    return <Navigate to="/plugins" replace />
  }

  function handleSendShortcutChange(nextShortcut: string) {
    const shortcut = nextShortcut as ComposerSendShortcutPreference
    setOptimisticSendShortcut(shortcut)
    // Mirror the optimistic UI pattern used for theme/locale so the dropdown
    // feels instant while the persisted config revision catches up.
    updateConfig.mutate(
      {
        composer: {
          sendShortcut: composerSendShortcutPreferenceToProto(shortcut),
        },
        expectedRevision: configQuery.data?.revision ?? 0n,
      },
      {
        onError: () => {
          setOptimisticSendShortcut(null)
        },
      }
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="settings-workspace-pane"
    >
      <WorkspacePageToolbar
        title={t("app.settings.pageTitle")}
        showOverflowMenu={false}
      />

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
          <SettingsSection id="general" title={t("app.settings.general")}>
            <div className="divide-y divide-border rounded-lg border border-border">
              <SettingsRow
                label={t("app.settings.hostStatus")}
                description={t("app.settings.hostStatusDescription")}
                action={
                  <div className="flex items-center gap-2 text-sm">
                    {hostStatusLoading ? (
                      <span className="font-normal text-muted-foreground">
                        {t("app.settings.loading")}
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
                          {formatHostStatusLabel(hostStatus?.status, t)}
                        </span>
                      </>
                    )}
                  </div>
                }
              />
              <SettingsRow
                label={t("app.settings.theme")}
                description={
                  theme === "system"
                    ? t("app.settings.themeFollowing", {
                        theme: t(
                          `app.settings.theme${capitalizeTheme(resolvedTheme)}`
                        ),
                      })
                    : t("app.settings.themeDescription")
                }
                action={
                  <Select
                    value={theme}
                    onValueChange={(value) =>
                      setTheme(value as "dark" | "light" | "system")
                    }
                  >
                    <SelectTrigger
                      aria-label={t("app.settings.theme")}
                      className="min-w-40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {THEME_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
              <SettingsRow
                label={t("app.settings.language")}
                description={t("app.settings.languageDescription")}
                action={
                  <Select
                    value={locale}
                    onValueChange={(value) => setLocale(value as typeof locale)}
                  >
                    <SelectTrigger
                      aria-label={t("app.settings.language")}
                      className="min-w-40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {LOCALE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
              <SettingsRow
                label={t("app.settings.sendShortcut")}
                description={t("app.settings.sendShortcutDescription")}
                action={
                  <Select
                    value={sendShortcut}
                    onValueChange={handleSendShortcutChange}
                    disabled={configQuery.isLoading || updateConfig.isPending}
                  >
                    <SelectTrigger
                      aria-label={t("app.settings.sendShortcut")}
                      className="min-w-40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {COMPOSER_SEND_SHORTCUT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {formatComposerSendShortcutPreference(option.value)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
            </div>
          </SettingsSection>

          <SettingsSection id="agents" title={t("app.settings.agents")}>
            {backendsLoading ? (
              <div className="rounded-lg border border-border py-8 text-center text-sm font-normal text-muted-foreground">
                {t("app.settings.loadingBackends")}
              </div>
            ) : !backends || backends.length === 0 ? (
              <div className="rounded-lg border border-border py-8 text-center text-sm font-normal text-muted-foreground">
                {t("app.settings.noBackends")}
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
                        {backend.available
                          ? t("app.settings.available")
                          : t("app.settings.unavailable")}
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

function capitalizeTheme(theme: "dark" | "light") {
  return theme === "dark" ? "Dark" : "Light"
}
