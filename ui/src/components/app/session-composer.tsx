import type { ButtonHTMLAttributes, ReactNode } from "react"
import { ArrowUp, ChevronDown, LoaderCircle, Mic, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

type SessionComposerProps = {
  busy?: boolean
  disabled?: boolean
  placeholder: string
  projectLabel?: string
  branchLabel?: string
  settingsLabel?: string
  reasoningLabel?: string
  modelLabel?: string
  onSubmit: () => Promise<void> | void
  onValueChange: (value: string) => void
  value: string
}

export function SessionComposer({
  busy = false,
  disabled = false,
  placeholder,
  projectLabel = "本地",
  branchLabel = "main",
  settingsLabel = "自定义 (config.toml)",
  reasoningLabel = "High",
  modelLabel = "GPT-5.4",
  onSubmit,
  onValueChange,
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
    <div className="px-3 pb-3 pt-2 md:px-4 md:pb-4">
      <div className="overflow-hidden rounded-2xl border border-ws-border-strong bg-ws-panel shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <div className="px-4 pb-3 pt-3">
          <textarea
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
            className="min-h-14 w-full resize-none bg-transparent text-sm leading-[1.6] text-ws-text outline-none placeholder:text-ws-text-off"
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
              className={cn(
                "flex size-8 items-center justify-center rounded-lg transition md:size-7",
                canSubmit
                  ? "bg-ws-text text-ws-page hover:brightness-110"
                  : "bg-ws-hover text-ws-text-muted"
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
      className="flex size-8 items-center justify-center rounded-md text-ws-text-muted transition hover:bg-ws-hover hover:text-ws-text-sub md:size-7"
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
      className="workspace-chip inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-xs text-ws-text-sub transition hover:bg-ws-hover"
    >
      {children}
      <ChevronDown className="size-[11px] text-ws-text-muted" />
    </button>
  )
}

function MetaButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md px-2 py-1 text-[11.5px] text-ws-text-muted transition hover:bg-ws-hover-soft hover:text-ws-text-sub"
    >
      {children}
    </button>
  )
}
