import type { ButtonHTMLAttributes, ReactNode } from "react"
import { LoaderCircle, Mic, Plus, SendHorizonal } from "lucide-react"

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
  branchLabel = "codex",
  settingsLabel = "自定义 (config.toml)",
  reasoningLabel = "高",
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
      <div className="rounded-[24px] border border-white/10 bg-[#1d1d1d] shadow-[0_16px_48px_rgba(0,0,0,0.32)]">
        <div className="px-4 pt-4 pb-3">
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
            className="min-h-14 w-full resize-none bg-transparent text-[15px] leading-7 text-[#ececec] outline-none placeholder:text-[#5d5d5d]"
          />
        </div>

        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-1.5">
            <GhostIconButton aria-label="Add context">
              <Plus className="size-4" />
            </GhostIconButton>

            <ChipButton>{modelLabel}</ChipButton>
            <ChipButton>{reasoningLabel}</ChipButton>
          </div>

          <div className="flex items-center gap-2">
            <GhostIconButton aria-label="Voice input">
              <Mic className="size-4" />
            </GhostIconButton>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition md:size-9",
                canSubmit
                  ? "bg-[#f0f0f0] text-[#121212] hover:bg-white"
                  : "bg-white/8 text-[#4f4f4f]"
              )}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <SendHorizonal className="size-4" />
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
      className="flex size-8 items-center justify-center rounded-lg text-[#6d6d6d] transition hover:bg-white/6 hover:text-[#bdbdbd] md:size-9"
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
      className="workspace-chip inline-flex min-h-8 items-center rounded-xl px-3 text-[12px] text-[#cfcfcf] transition hover:bg-white/10"
    >
      {children}
    </button>
  )
}

function MetaButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md px-2 py-1 text-[11.5px] text-[#666] transition hover:bg-white/5 hover:text-[#9a9a9a]"
    >
      {children}
    </button>
  )
}
