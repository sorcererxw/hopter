import type { ButtonHTMLAttributes, ReactNode } from "react"
import { ArrowUp, ChevronDown, LoaderCircle, Mic, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

type SessionComposerProps = {
  busy?: boolean
  disabled?: boolean
  placeholder: string
  composerTestId?: string
  inputTestId?: string
  projectLabel?: string
  branchLabel?: string
  settingsLabel?: string
  reasoningLabel?: string
  modelLabel?: string
  onSubmit: () => Promise<void> | void
  onValueChange: (value: string) => void
  submitTestId?: string
  value: string
}

export function SessionComposer({
  busy = false,
  disabled = false,
  placeholder,
  composerTestId,
  inputTestId,
  projectLabel = "Local",
  branchLabel = "main",
  settingsLabel = "Custom (config.toml)",
  reasoningLabel = "High",
  modelLabel = "GPT-5.4",
  onSubmit,
  onValueChange,
  submitTestId,
  value,
}: SessionComposerProps) {
  const canSubmit = value.trim().length > 0 && !busy && !disabled

  async function handleSubmit() {
    if (!canSubmit) {
      return
    }

    await onSubmit()
  }

  return (
    <div
      className="composer-foreground px-3 pb-3 pt-2 md:px-4 md:pb-4"
      data-testid={composerTestId}
    >
      <div className="overflow-hidden rounded-lg border border-ws-border-strong bg-popover shadow-lg">
        {/* Main action row */}
        <div className="px-4 pb-3 pt-3">
          <textarea
            data-testid={inputTestId}
            rows={2}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder={placeholder}
            className="min-h-14 w-full resize-none bg-transparent text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex items-center justify-between px-2.5 pb-2.5">
          <div className="flex items-center gap-1">
            <GhostIconButton aria-label="Add context">
              <Plus className="size-4" />
            </GhostIconButton>

            <GhostTextButton>{modelLabel}</GhostTextButton>
            <GhostTextButton>{reasoningLabel}</GhostTextButton>
          </div>

          <div className="flex items-center gap-2">
            <GhostIconButton aria-label="Voice input" className="hidden md:flex">
              <Mic className="size-4" />
            </GhostIconButton>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              data-testid={submitTestId}
              className={cn(
                "flex items-center justify-center rounded-lg transition",
                "size-9 md:size-8",
                canSubmit
                  ? "bg-primary text-primary-foreground hover:brightness-110"
                  : "bg-accent text-muted-foreground"
              )}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Lower metadata row – subordinate */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-1">
          <MetaButton>{projectLabel}</MetaButton>
          <MetaButton>{branchLabel}</MetaButton>
        </div>

        <MetaButton>{settingsLabel}</MetaButton>
      </div>
    </div>
  )
}

function GhostIconButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground md:size-7",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function GhostTextButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      {children}
      <ChevronDown className="size-3 opacity-50" />
    </button>
  )
}

function MetaButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md px-2 py-1 text-xs text-ws-text-muted transition hover:bg-muted hover:text-muted-foreground"
    >
      {children}
    </button>
  )
}
