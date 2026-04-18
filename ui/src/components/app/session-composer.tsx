import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  Mic,
  Plus,
  Square,
} from "lucide-react"

import { BottomSheet, BottomSheetItem } from "@/components/app/bottom-sheet"
import { Button } from "@/components/ui/button"
import { useHostSkills } from "@/features/host/use-host-skills"
import type { SkillSummary } from "@/gen/proto/orchd/v1/host_pb"
import { cn } from "@/lib/utils"

/** Matches Tailwind `md` breakpoint (768px) */
const MD_BREAKPOINT = 768
const MAX_SKILL_SUGGESTIONS = 8

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
  interruptMode?: boolean
  placeholder: string
  composerTestId?: string
  inputTestId?: string
  projectLabel?: string
  branchLabel?: string
  settingsLabel?: string
  reasoningLabel?: string
  modelLabel?: string
  onInterrupt?: () => Promise<void> | void
  onSubmit: () => Promise<void> | void
  onValueChange: (value: string) => void
  interruptTestId?: string
  submitTestId?: string
  value: string
}

type SkillMentionMatch = {
  end: number
  query: string
  start: number
}

type ComposerTextSegment = {
  highlighted: boolean
  text: string
}

export function SessionComposer({
  busy = false,
  disabled = false,
  interruptMode = false,
  placeholder,
  composerTestId,
  inputTestId,
  projectLabel: _projectLabel = "Local",
  branchLabel: _branchLabel = "main",
  settingsLabel: _settingsLabel = "Custom (config.toml)",
  reasoningLabel = "High",
  modelLabel = "GPT-5.4",
  onInterrupt,
  onSubmit,
  onValueChange,
  interruptTestId,
  submitTestId,
  value,
}: SessionComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canSubmit =
    ((value.trim().length > 0 && !interruptMode) ||
      (interruptMode && value.trim().length === 0)) &&
    !busy &&
    !disabled
  const [selectedModel, setSelectedModel] = useState(
    MODEL_OPTIONS.find((opt) => opt.label === modelLabel)?.value ?? "gpt-5.4"
  )
  const [selectedReasoning, setSelectedReasoning] = useState(
    REASONING_OPTIONS.find((opt) => opt.label === reasoningLabel)?.value ??
      "high"
  )
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false)
  const [modelSheetOpen, setModelSheetOpen] = useState(false)
  const [reasoningSheetOpen, setReasoningSheetOpen] = useState(false)
  const [caretPosition, setCaretPosition] = useState(value.length)
  const [skillSuggestionsDismissed, setSkillSuggestionsDismissed] =
    useState(false)
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0)
  const hostSkillsQuery = useHostSkills()

  const currentModelLabel =
    MODEL_OPTIONS.find((opt) => opt.value === selectedModel)?.label ??
    modelLabel
  const currentReasoningLabel =
    REASONING_OPTIONS.find((opt) => opt.value === selectedReasoning)?.label ??
    reasoningLabel
  const isMobileViewport =
    typeof window !== "undefined" && window.innerWidth < MD_BREAKPOINT

  const activeSkillMatch = useMemo(
    () => getActiveSkillMatch(value, caretPosition),
    [caretPosition, value]
  )
  const activeSkillSignature = activeSkillMatch
    ? `${activeSkillMatch.start}:${activeSkillMatch.end}:${activeSkillMatch.query}`
    : ""
  const skillSuggestions = useMemo(() => {
    if (!activeSkillMatch) {
      return []
    }

    return rankSkills(hostSkillsQuery.data ?? [], activeSkillMatch.query).slice(
      0,
      MAX_SKILL_SUGGESTIONS
    )
  }, [activeSkillMatch, hostSkillsQuery.data])
  const composerTextSegments = useMemo(
    () => buildComposerTextSegments(value),
    [value]
  )
  const showSkillSuggestions =
    Boolean(activeSkillMatch) &&
    !interruptMode &&
    !disabled &&
    !skillSuggestionsDismissed &&
    skillSuggestions.length > 0
  const showSkillSuggestionState =
    Boolean(activeSkillMatch) &&
    !interruptMode &&
    !disabled &&
    !skillSuggestionsDismissed &&
    (hostSkillsQuery.isLoading ||
      skillSuggestions.length > 0 ||
      Boolean(activeSkillMatch?.query))

  useEffect(() => {
    setSkillSuggestionsDismissed(false)
    setHighlightedSkillIndex(0)
  }, [activeSkillSignature])

  useEffect(() => {
    if (highlightedSkillIndex < skillSuggestions.length) {
      return
    }
    setHighlightedSkillIndex(0)
  }, [highlightedSkillIndex, skillSuggestions.length])

  function handleModelTrigger() {
    if (isMobileViewport) {
      setModelSheetOpen(true)
      setModelMenuOpen(false)
      return
    }
    setModelMenuOpen((prev) => !prev)
  }

  function handleReasoningTrigger() {
    if (isMobileViewport) {
      setReasoningSheetOpen(true)
      setReasoningMenuOpen(false)
      return
    }
    setReasoningMenuOpen((prev) => !prev)
  }

  function syncCaretPosition() {
    if (!textareaRef.current) {
      return
    }
    setCaretPosition(textareaRef.current.selectionStart ?? value.length)
  }

  function handleComposerInput(value: string) {
    onValueChange(value)
    window.requestAnimationFrame(() => {
      syncCaretPosition()
    })
  }

  function insertSkillReference(skill: SkillSummary) {
    if (!activeSkillMatch) {
      return
    }

    const nextValue = [
      value.slice(0, activeSkillMatch.start),
      `$${skill.reference} `,
      value.slice(activeSkillMatch.end),
    ].join("")

    onValueChange(nextValue)
    setSkillSuggestionsDismissed(true)
    window.requestAnimationFrame(() => {
      const nextCaret = activeSkillMatch.start + skill.reference.length + 2
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
      setCaretPosition(nextCaret)
    })
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return
    }

    if (interruptMode) {
      await onInterrupt?.()
      return
    }

    await onSubmit()
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (showSkillSuggestions) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setHighlightedSkillIndex((current) =>
          current + 1 >= skillSuggestions.length ? 0 : current + 1
        )
        return
      }

      if (event.key === "ArrowUp") {
        event.preventDefault()
        setHighlightedSkillIndex((current) =>
          current === 0 ? skillSuggestions.length - 1 : current - 1
        )
        return
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const selectedSkill = skillSuggestions[highlightedSkillIndex]
        if (selectedSkill) {
          insertSkillReference(selectedSkill)
        }
        return
      }
    }

    if (showSkillSuggestionState && event.key === "Escape") {
      event.preventDefault()
      setSkillSuggestionsDismissed(true)
      return
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <>
      <div
        className="composer-foreground px-6 pb-3 md:pb-4"
        data-testid={composerTestId}
      >
        <div className="mx-auto max-w-[720px]">
          <div className="relative">
            {showSkillSuggestionState ? (
              <SkillSuggestionPopover
                highlightedIndex={highlightedSkillIndex}
                loading={hostSkillsQuery.isLoading}
                onSelectSkill={insertSkillReference}
                query={activeSkillMatch?.query ?? ""}
                skills={skillSuggestions}
              />
            ) : null}

            <div className="overflow-hidden rounded-lg border border-ws-border-strong bg-popover shadow-lg">
              <div className="px-4 pt-3 pb-3">
                <div className="relative min-h-14">
                  {value.length > 0 ? (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 py-0 text-base leading-relaxed break-words whitespace-pre-wrap text-foreground"
                    >
                      {composerTextSegments.map((segment, index) =>
                        segment.highlighted ? (
                          <span
                            key={`${segment.text}-${index}`}
                            data-testid="composer-skill-highlight"
                            className="rounded-md bg-picker px-1 py-0.5 text-foreground"
                          >
                            {segment.text}
                          </span>
                        ) : (
                          <span key={`${segment.text}-${index}`}>
                            {segment.text}
                          </span>
                        )
                      )}
                      <span>{"\u200b"}</span>
                    </div>
                  ) : null}

                  <textarea
                    ref={textareaRef}
                    data-testid={inputTestId}
                    rows={2}
                    value={value}
                    onChange={(event) =>
                      handleComposerInput(event.target.value)
                    }
                    onClick={syncCaretPosition}
                    onKeyDown={handleTextareaKeyDown}
                    onKeyUp={syncCaretPosition}
                    onSelect={syncCaretPosition}
                    placeholder={placeholder}
                    className={cn(
                      "relative z-10 min-h-14 w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground",
                      value.length > 0
                        ? "text-transparent caret-foreground"
                        : "text-foreground"
                    )}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-2.5 pb-2.5">
                <div className="flex items-center gap-1">
                  <GhostIconButton aria-label="Add context">
                    <Plus className="size-4" />
                  </GhostIconButton>

                  <div className="relative">
                    <GhostTextButton onClick={handleModelTrigger}>
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

                  <div className="relative">
                    <GhostTextButton onClick={handleReasoningTrigger}>
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
                  <GhostIconButton
                    aria-label="Voice input"
                    className="hidden md:flex"
                  >
                    <Mic className="size-4" />
                  </GhostIconButton>

                  <Button
                    type="button"
                    size="icon-lg"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                    aria-label={
                      interruptMode ? "Interrupt turn" : "Send message"
                    }
                    title={interruptMode ? "Interrupt turn" : "Send message"}
                    data-testid={interruptMode ? interruptTestId : submitTestId}
                    className={cn(
                      "rounded-full transition size-9 md:size-8",
                      canSubmit
                        ? "bg-primary text-primary-foreground hover:brightness-110"
                        : "bg-accent text-muted-foreground"
                    )}
                  >
                    {busy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : interruptMode ? (
                      <Square className="size-4 fill-current" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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

function SkillSuggestionPopover({
  highlightedIndex,
  loading,
  onSelectSkill,
  query,
  skills,
}: {
  highlightedIndex: number
  loading: boolean
  onSelectSkill: (skill: SkillSummary) => void
  query: string
  skills: SkillSummary[]
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-full z-50 mb-2"
      data-testid="skill-suggestion-popover"
    >
      <div className="overflow-hidden rounded-lg border border-ws-border-strong bg-popover text-sm font-medium text-foreground shadow-lg">
        <div className="border-b border-border px-4 py-2 text-xs tracking-wider text-muted-foreground uppercase">
          {loading
            ? "Loading skills"
            : query
              ? `Skills matching $${query}`
              : "Skills"}
        </div>

        {loading ? (
          <div className="px-4 py-3 text-muted-foreground">
            Loading skills...
          </div>
        ) : skills.length === 0 ? (
          <div
            className="px-4 py-3 text-muted-foreground"
            data-testid="skill-suggestion-empty"
          >
            No skills found for{" "}
            <span className="font-mono text-foreground">$${query}</span>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1">
            {skills.map((skill, index) => (
              <Button
                key={`${skill.reference}:${skill.source}`}
                type="button"
                variant={index === highlightedIndex ? "secondary" : "ghost"}
                data-testid="skill-suggestion-item"
                data-skill-reference={skill.reference}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelectSkill(skill)
                }}
                className={cn(
                  "h-auto w-full justify-start items-start gap-3 px-4 py-3 text-left",
                  index === highlightedIndex
                    ? "text-foreground"
                    : "text-foreground"
                )}
              >
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-secondary font-mono text-xs text-foreground">
                  $
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate">
                      {skill.name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      ${skill.reference}
                    </span>
                    <span className="shrink-0 text-xs tracking-wider text-muted-foreground uppercase">
                      {formatSkillSource(skill.source)}
                    </span>
                  </div>
                  {skill.description ? (
                    <div className="mt-1 line-clamp-1 text-muted-foreground">
                      {skill.description}
                    </div>
                  ) : null}
                </div>
              </Button>
            ))}
          </div>
        )}
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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "text-muted-foreground md:size-7",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
}

function GhostTextButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1 text-muted-foreground"
      {...props}
    >
      {children}
      <ChevronDown className="size-3 opacity-50" />
    </Button>
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
    <Button
      type="button"
      onClick={onClick}
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className={cn(
        "h-auto w-full justify-between px-3 py-2",
        active ? "text-foreground" : "text-foreground/70"
      )}
    >
      <span>{children}</span>
      {active ? <Check className="size-3.5 text-foreground" /> : null}
    </Button>
  )
}

function getActiveSkillMatch(
  value: string,
  caretPosition: number
): SkillMentionMatch | null {
  const clampedCaret = Math.max(0, Math.min(caretPosition, value.length))
  const prefix = value.slice(0, clampedCaret)
  const match = prefix.match(/(?:^|[\s([{])\$([a-z0-9:-]*)$/i)
  if (!match) {
    return null
  }

  const query = match[1] ?? ""
  return {
    start: clampedCaret - query.length - 1,
    end: clampedCaret,
    query,
  }
}

function rankSkills(skills: SkillSummary[], query: string) {
  const normalizedQuery = normalizeSearch(query)

  return [...skills]
    .map((skill) => ({
      rank: scoreSkill(skill, normalizedQuery),
      skill,
    }))
    .filter((entry) => entry.rank < Number.POSITIVE_INFINITY)
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank
      }

      const sourceOrder =
        sourcePriority(left.skill.source) - sourcePriority(right.skill.source)
      if (sourceOrder !== 0) {
        return sourceOrder
      }

      return left.skill.name.localeCompare(right.skill.name, undefined, {
        sensitivity: "base",
      })
    })
    .map((entry) => entry.skill)
}

function scoreSkill(skill: SkillSummary, query: string) {
  const reference = normalizeSearch(skill.reference)
  const name = normalizeSearch(skill.name)
  const description = normalizeSearch(skill.description)

  if (!query) {
    return sourcePriority(skill.source)
  }
  if (reference === query) {
    return 0
  }
  if (reference.startsWith(query)) {
    return 1
  }
  if (name.startsWith(query)) {
    return 2
  }
  if (reference.includes(query)) {
    return 3
  }
  if (name.includes(query)) {
    return 4
  }
  if (description.includes(query)) {
    return 5
  }
  return Number.POSITIVE_INFINITY
}

function sourcePriority(source: string) {
  switch (source) {
    case "project":
      return 0
    case "local":
      return 1
    case "plugin":
      return 2
    default:
      return 3
  }
}

function formatSkillSource(source: string) {
  switch (source) {
    case "project":
      return "project"
    case "plugin":
      return "plugin"
    case "local":
    default:
      return "local"
  }
}

function normalizeSearch(value?: string) {
  return (value ?? "").trim().toLowerCase()
}

function buildComposerTextSegments(value: string): ComposerTextSegment[] {
  if (!value) {
    return []
  }

  const pattern = /(^|[\s([{])(\$[a-z0-9:-]+)/gi
  const segments: ComposerTextSegment[] = []
  let lastIndex = 0

  for (const match of value.matchAll(pattern)) {
    const fullMatch = match[0] ?? ""
    const prefix = match[1] ?? ""
    const token = match[2] ?? ""
    const matchIndex = match.index ?? 0
    const tokenStart = matchIndex + prefix.length

    if (matchIndex > lastIndex) {
      segments.push({
        highlighted: false,
        text: value.slice(lastIndex, matchIndex),
      })
    }

    if (prefix) {
      segments.push({
        highlighted: false,
        text: prefix,
      })
    }

    if (token) {
      segments.push({
        highlighted: true,
        text: token,
      })
    }

    lastIndex = matchIndex + fullMatch.length
    if (lastIndex < tokenStart + token.length) {
      lastIndex = tokenStart + token.length
    }
  }

  if (lastIndex < value.length) {
    segments.push({
      highlighted: false,
      text: value.slice(lastIndex),
    })
  }

  return segments
}
