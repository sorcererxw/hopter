import { useTheme } from "@/components/theme-provider"
import { SettingsPageLayout } from "@/routes/settings/settings-page-layout"

const THEME_OPTIONS = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
] as const

export function SettingsAppearancePage() {
  const { resolvedTheme, theme, setTheme } = useTheme()

  return (
    <SettingsPageLayout title="Appearance">
      <div className="divide-y divide-border">
        <div className="flex items-start justify-between gap-8 py-4">
          <div className="flex-1">
            <div className="text-foreground">Theme</div>
            <div className="mt-0.5 text-sm font-normal text-muted-foreground">
              Choose the workspace theme
              {theme === "system"
                ? ` (currently following ${resolvedTheme})`
                : ""}
            </div>
          </div>
          <label className="relative block min-w-40 shrink-0">
            <select
              value={theme}
              onChange={(event) =>
                setTheme(event.target.value as "dark" | "light" | "system")
              }
              className="h-10 w-full appearance-none rounded-lg border border-input bg-transparent px-3 py-2 pr-8 text-foreground transition outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
              ▾
            </span>
          </label>
        </div>
      </div>
    </SettingsPageLayout>
  )
}
