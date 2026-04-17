import { useState, type ButtonHTMLAttributes, type ReactNode } from "react"
import { ArrowUp, Check, ChevronDown, LoaderCircle, Mic, Plus } from "lucide-react"

import { BottomSheet, BottomSheetItem } from "@/components/app/bottom-sheet"
import { cn } from "@/lib/utils"

/** Matches Tailwind `md` breakpoint (768px) */
const MD_BREAKPOINT = 768

const MODEL_OPTIONS = [
  { label: "GPT-5.4", value: "gpt-5.4" },
  { label: "o3", value: "o3" },
  { label: "o4-mini", value: "o4-mini" },
  { label: "GPT-4.1", value: "gpt-4.1" },
]

const REASONING_OPTIONS = [
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
  { label: "Off", value: "off" },
]

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
  projectLabel: _projectLabel = "Local",
  branchLabel: _branchLabel = "main",
  settingsLabel: _settingsLabel = "Custom (config.toml)",
  reasoningLabel = "High",
  modelLabel = "GPT-5.4",
  onSubmit,
  onValueChange,
  submitTestId,
  value,
}: SessionComposerProps) {
  const canSubmit = value.trim().length > 0 && !busy && !disabled
  const [selectedModel, setSelectedModel] = useState(
    MODEL_OPTIONS.find((opt) => opt.label === modelLabel)?.value ?? "gpt-5.4"
  )
  const [selectedReasoning, setSelectedReasoning] = useState(
    REASONING_OPTIONS.find((opt) => opt.label === reasoningLabel)?.value ?? "high"
  )
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false)
  const [modelSheetOpen, setModelSheetOpen] = useState(false)
  const [reasoningSheetOpen, setReasoningSheetOpen] = useState(false)

  const currentModelLabel = MODEL_OPTIONS.find((opt) => opt.value === selectedModel)?.label ?? modelLabel
  const currentReasoningLabel = REASONING_OPTIONS.find((opt) => opt.value === selectedReasoning)?.label ?? reasoningLabel

  async function handleSubmit() {
    if (!canSubmit) {
      return
    }

    await onSubmit()
  }

  return (
    <>
      <div
        className="composer-foreground px-6 pb-3 pt-2 md:pb-4"
        data-testid={composerTestId}
      >
        <div className="mx-auto max-w-[720px]">
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

              {/* Model selector – dropdown on desktop, bottom sheet on phone */}
              <div className="relative">
                <GhostTextButton
                  onClick={() => {
                    // Desktop: toggle dropdown
                    setModelMenuOpen((prev) => !prev)
                  }}
                  onTouchEnd={(event) => {
                    // Phone: open bottom sheet instead
                    if (window.innerWidth < MD_BREAKPOINT) {
                      event.preventDefault()
                      setModelSheetOpen(true)
                      setModelMenuOpen(false)
                    }
                  }}
                >
                  {currentModelLabel}
                </GhostTextButton>
                {modelMenuOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40 hidden md:block"
                      onClick={() => setModelMenuOpen(false)}
                    />
                    <div className="absolute bottom-full left-0 z-50 mb-1 hidden w-40 rounded-lg border border-border bg-popover py-1 shadow-lg md:block">
                      {MODEL_OPTIONS.map((option) => (
                        <DropdownItem
                          key={option.value}
                          active={selectedModel === option.value}
                          onClick={() => {
                            setSelectedModel(option.value)
                            setModelMenuOpen(false)
                          }}
                        >
                          {option.label}
                        </DropdownItem>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              {/* Reasoning selector – dropdown on desktop, bottom sheet on phone */}
              <div className="relative">
                <GhostTextButton
                  onClick={() => {
                    setReasoningMenuOpen((prev) => !prev)
                  }}
                  onTouchEnd={(event) => {
                    if (window.innerWidth < MD_BREAKPOINT) {
                      event.preventDefault()
                      setReasoningSheetOpen(true)
                      setReasoningMenuOpen(false)
                    }
                  }}
                >
                  {currentReasoningLabel}
                </GhostTextButton>
                {reasoningMenuOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40 hidden md:block"
                      onClick={() => setReasoningMenuOpen(false)}
                    />
                    <div className="absolute bottom-full left-0 z-50 mb-1 hidden w-40 rounded-lg border border-border bg-popover py-1 shadow-lg md:block">
                      {REASONING_OPTIONS.map((option) => (
                        <DropdownItem
                          key={option.value}
                          active={selectedReasoning === option.value}
                          onClick={() => {
                            setSelectedReasoning(option.value)
                            setReasoningMenuOpen(false)
                          }}
                        >
                          {option.label}
                        </DropdownItem>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
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
      </div>

      {/* Phone bottom sheets – rendered outside composer card via portal-like placement */}
      <BottomSheet
        open={modelSheetOpen}
        onClose={() => setModelSheetOpen(false)}
        title="Model"
      >
        {MODEL_OPTIONS.map((option) => (
          <BottomSheetItem
            key={option.value}
            active={selectedModel === option.value}
            onClick={() => {
              setSelectedModel(option.value)
              setModelSheetOpen(false)
            }}
          >
            {option.label}
          </BottomSheetItem>
        ))}
      </BottomSheet>

      <BottomSheet
        open={reasoningSheetOpen}
        onClose={() => setReasoningSheetOpen(false)}
        title="Reasoning"
      >
        {REASONING_OPTIONS.map((option) => (
          <BottomSheetItem
            key={option.value}
            active={selectedReasoning === option.value}
            onClick={() => {
              setSelectedReasoning(option.value)
              setReasoningSheetOpen(false)
            }}
          >
            {option.label}
          </BottomSheetItem>
        ))}
      </BottomSheet>
    </>
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

function GhostTextButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
      {...props}
    >
      {children}
      <ChevronDown className="size-3 opacity-50" />
    </button>
  )
}

function DropdownItem({
  active = false,
  children,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between px-3 py-2 text-sm transition hover:bg-accent",
        active ? "text-foreground" : "text-foreground/70"
      )}
    >
      <span>{children}</span>
      {active ? <Check className="size-3.5 text-foreground" /> : null}
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
