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
  projectLabel = "本地",
  branchLabel = "main",
  settingsLabel = "自定义 (config.toml)",
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
      className="px-3 pb-3 pt-2 md:px-4 md:pb-4"
      data-testid={composerTestId}
    >
      <div className="overflow-hidden rounded-[1rem] border border-[color:var(--workspace-border-strong)] bg-[var(--workspace-panel-bg)] shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
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
            className="min-h-14 w-full resize-none bg-transparent text-[14px] leading-[1.6] text-[var(--workspace-text-primary)] outline-none placeholder:text-[var(--workspace-text-disabled)]"
          />
        </div>

        <div className="flex items-center justify-between px-2.5 pb-2.5">
          <div className="flex items-center gap-1.5">
            <GhostIconButton aria-label="Add context">
              <Plus className="size-4" />
            </GhostIconButton>

            <ChipButton>{modelLabel}</ChipButton>
            <ChipButton>{reasoningLabel}</ChipButton>
          </div>

          <div className="flex items-center gap-2">
            <GhostIconButton aria-label="Voice input">
              <Mic className="size-[15px]" />
            </GhostIconButton>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              data-testid={submitTestId}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg transition md:size-7",
                canSubmit
                  ? "bg-[var(--workspace-text-primary)] text-[var(--workspace-page-bg)] hover:brightness-110"
                  : "bg-[var(--workspace-hover-bg)] text-[var(--workspace-text-muted)]"
              )}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-[14px]" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="flex size-8 items-center justify-center rounded-md text-[var(--workspace-text-muted)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)] md:size-7"
      {...props}
    >
      {children}
    </button>
  )
}

function ChipButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="workspace-chip inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-[var(--workspace-text-secondary)] transition hover:bg-[var(--workspace-hover-bg)]"
    >
      {children}
      <ChevronDown className="size-[11px] text-[var(--workspace-text-muted)]" />
    </button>
  )
}

function MetaButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md px-2 py-1 text-[11.5px] text-[var(--workspace-text-muted)] transition hover:bg-[var(--workspace-hover-bg-soft)] hover:text-[var(--workspace-text-secondary)]"
    >
      {children}
    </button>
  )
}
