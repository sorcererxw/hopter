import { LaptopMinimal, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/orchd/theme-provider";

const THEME_OPTIONS: Array<{
  value: Theme;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: LaptopMinimal },
];

function iconForTheme(theme: Theme) {
  return THEME_OPTIONS.find((option) => option.value === theme)?.icon ?? Sun;
}

export function ThemeControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">Theme</p>
          <p className="text-[11px] text-muted-foreground">Current: {theme === "system" ? `System (${resolvedTheme})` : theme}</p>
        </div>
      </div>
      <div className={cn("flex gap-2", compact ? "flex-wrap" : "flex-col sm:flex-row")}>
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.value === theme;
          return (
            <Button
              key={option.value}
              type="button"
              variant={selected ? "secondary" : "outline"}
              size={compact ? "sm" : "default"}
              className={cn("justify-start rounded-xl", !compact && "flex-1")}
              onClick={() => setTheme(option.value)}
              aria-pressed={selected}
            >
              <Icon className="size-4" />
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function QuickThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const activeTheme = theme === "system" ? resolvedTheme : theme;
  const nextTheme: Exclude<Theme, "system"> = activeTheme === "dark" ? "light" : "dark";
  const Icon = iconForTheme(activeTheme);
  const currentLabel = theme === "system" ? `system (${resolvedTheme})` : theme;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("rounded-xl border border-border bg-background/70 backdrop-blur", className)}
      onClick={() => setTheme(nextTheme)}
      aria-label={`Theme: ${currentLabel}. Switch to ${nextTheme}.`}
      title={`Theme: ${currentLabel}. Switch to ${nextTheme}.`}
    >
      <Icon className="size-4" />
    </Button>
  );
}
