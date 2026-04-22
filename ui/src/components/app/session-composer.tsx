import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
} from "react"
import { ArrowUp, ChevronDown, LoaderCircle, Pause, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { useCodexModels } from "@/features/host/use-host-models"
import { useHostSkills } from "@/features/host/use-host-skills"
import type { AgentModel, SkillSummary } from "@/gen/proto/hopter/v1/host_pb"
import { cn } from "@/lib/utils"

const MAX_SKILL_SUGGESTIONS = 8

const REASONING_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
}

type SessionComposerSubmitOptions = {
  model: string
  reasoningEffort: string
}

type SessionComposerProps = {
  busy?: boolean
  disabled?: boolean
  interruptMode?: boolean
  placeholder: string
  placement?: "sticky" | "inline"
  composerTestId?: string
  inputTestId?: string
  projectLabel?: string
  branchLabel?: string
  settingsLabel?: string
  onInterrupt?: () => Promise<void> | void
  onSubmit: (options: SessionComposerSubmitOptions) => Promise<void> | void
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
  placement = "sticky",
  composerTestId,
  inputTestId,
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
  const [caretPosition, setCaretPosition] = useState(value.length)
  const [skillSuggestionsDismissed, setSkillSuggestionsDismissed] =
    useState(false)
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0)
  const [selectedModel, setSelectedModel] = useState("gpt-5.4")
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useState("xhigh")
  const hostSkillsQuery = useHostSkills()
  const codexModelsQuery = useCodexModels()
  const modelOptions = codexModelsQuery.data ?? []
  const selectedModelOption =
    modelOptions.find((option) => modelValue(option) === selectedModel) ??
    modelOptions.find((option) => option.isDefault) ??
    modelOptions[0]
  const supportedReasoningOptions =
    selectedModelOption?.supportedReasoningEfforts.map((effort) => ({
      label: REASONING_LABELS[effort.reasoningEffort] ?? effort.reasoningEffort,
      value: effort.reasoningEffort,
    })) ?? []
  const effectiveReasoningEffort =
    supportedReasoningOptions.find(
      (option) => option.value === selectedReasoningEffort
    )?.value ??
    selectedModelOption?.defaultReasoningEffort ??
    supportedReasoningOptions[0]?.value ??
    ""
  const effectiveModel = selectedModelOption
    ? modelValue(selectedModelOption)
    : ""

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
    const frame = window.requestAnimationFrame(() => {
      setSkillSuggestionsDismissed(false)
      setHighlightedSkillIndex(0)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSkillSignature])

  useEffect(() => {
    if (highlightedSkillIndex < skillSuggestions.length) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      setHighlightedSkillIndex(0)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [highlightedSkillIndex, skillSuggestions.length])

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

    await onSubmit({
      model: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
    })
  }

  function handleModelChange(model: string) {
    const nextModel =
      modelOptions.find((option) => modelValue(option) === model) ??
      modelOptions[0]
    if (!nextModel) {
      return
    }
    setSelectedModel(modelValue(nextModel))
    const nextReasoningEfforts = nextModel.supportedReasoningEfforts.map(
      (effort) => effort.reasoningEffort
    )
    if (!nextReasoningEfforts.includes(selectedReasoningEffort)) {
      setSelectedReasoningEffort(nextModel.defaultReasoningEffort)
    }
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
        className={cn(
          placement === "sticky"
            ? "sticky bottom-0 z-20 bg-background px-6 pb-3 md:pb-4"
            : "w-full"
        )}
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

            <div className="overflow-hidden rounded-2xl border border-border bg-popover">
              <div className="px-3 pt-3 pb-2">
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
                            className="rounded-md bg-muted px-1 py-0.5 text-foreground"
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

              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-1">
                  <GhostIconButton aria-label="Add context">
                    <Plus className="size-4" />
                  </GhostIconButton>
                </div>

                <div className="flex min-w-0 items-center justify-end gap-1">
                  <InlineSelect
                    aria-label="Model"
                    disabled={
                      codexModelsQuery.isLoading || modelOptions.length === 0
                    }
                    options={modelOptions.map((model) => ({
                      label: model.displayName || modelValue(model),
                      value: modelValue(model),
                    }))}
                    value={effectiveModel}
                    onValueChange={handleModelChange}
                  >
                    {selectedModelOption
                      ? selectedModelOption.displayName ||
                        modelValue(selectedModelOption)
                      : codexModelsQuery.isLoading
                        ? "Loading model"
                        : "Default model"}
                  </InlineSelect>

                  <InlineSelect
                    aria-label="Reasoning effort"
                    disabled={supportedReasoningOptions.length === 0}
                    options={supportedReasoningOptions}
                    value={effectiveReasoningEffort}
                    onValueChange={setSelectedReasoningEffort}
                  >
                    {REASONING_LABELS[effectiveReasoningEffort] ??
                      effectiveReasoningEffort}
                  </InlineSelect>

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
                      "size-9 rounded-full transition md:size-8",
                      canSubmit
                        ? "bg-primary text-primary-foreground hover:brightness-110"
                        : "bg-accent text-muted-foreground"
                    )}
                  >
                    {busy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : interruptMode ? (
                      <Pause className="size-4" />
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
      <div className="overflow-hidden rounded-lg border border-border bg-popover text-sm font-medium text-foreground shadow-lg">
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
                  "h-auto w-full items-start justify-start gap-3 px-4 py-3 text-left",
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
                    <span className="truncate">{skill.name}</span>
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
      className={cn("text-muted-foreground md:size-7", className)}
      {...props}
    >
      {children}
    </Button>
  )
}

function modelValue(model: AgentModel) {
  return model.model || model.id
}

function InlineSelect({
  children,
  disabled = false,
  onValueChange,
  options,
  value,
  ...props
}: {
  children: string
  disabled?: boolean
  onValueChange: (value: string) => void
  options: readonly { label: string; value: string }[]
  value: string
} & Omit<React.ComponentProps<"select">, "onChange" | "value">) {
  return (
    <label
      className={cn(
        buttonVariants({ variant: "ghost", size: "default" }),
        "relative gap-2 rounded-full pr-8 text-muted-foreground hover:text-foreground",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <span aria-hidden="true">{children}</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
        {...props}
      >
        {options.length === 0 ? (
          <option value="">{children}</option>
        ) : (
          options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-3" />
      <span className="sr-only">{children}</span>
    </label>
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
