import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
} from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowUp,
  ChevronDown,
  LoaderCircle,
  Plus,
  Square,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { useCodexModels } from "@/features/host/use-host-models"
import { useHostSkills } from "@/features/host/use-host-skills"
import type { AgentModel, SkillSummary } from "@/gen/proto/hopter/v1/host_pb"
import { cn } from "@/lib/utils"

import type { SessionComposerSelection } from "./selection"
import {
  applyAtomicSkillDeletion,
  normalizeAtomicSkillSelection,
} from "./skill-token"
import { SkillReferenceChip } from "@/components/app/shared"

const MAX_SKILL_SUGGESTIONS = 8
const DEFAULT_MODEL = "gpt-5.4"
const DEFAULT_REASONING_EFFORT = "xhigh"

type SessionComposerSubmitOptions = {
  codexFastMode: boolean
  model: string
  reasoningEffort: string
}

type SessionComposerProps = {
  busy?: boolean
  disabled?: boolean
  interruptMode?: boolean
  initialSelection?: Partial<SessionComposerSelection>
  placeholder: string
  placement?: "sticky" | "inline"
  composerTestId?: string
  inputTestId?: string
  projectLabel?: string
  branchLabel?: string
  settingsLabel?: string
  onInterrupt?: () => Promise<void> | void
  onSelectionChange?: (selection: SessionComposerSelection) => void
  onSubmit: (options: SessionComposerSubmitOptions) => Promise<void> | void
  onValueChange: (value: string) => void
  interruptTestId?: string
  selectionKey?: string
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
  known?: boolean
  reference?: string
  selected?: boolean
  text: string
}

export function SessionComposer({
  busy = false,
  disabled = false,
  interruptMode = false,
  initialSelection,
  placeholder,
  placement = "sticky",
  composerTestId,
  inputTestId,
  onInterrupt,
  onSelectionChange,
  onSubmit,
  onValueChange,
  interruptTestId,
  selectionKey,
  submitTestId,
  value,
}: SessionComposerProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)
  const canSubmit =
    ((value.trim().length > 0 && !interruptMode) ||
      (interruptMode && value.trim().length === 0)) &&
    !busy &&
    !disabled
  const [caretPosition, setCaretPosition] = useState(value.length)
  const [selectionRange, setSelectionRange] = useState({
    end: value.length,
    start: value.length,
  })
  const [skillSuggestionsDismissed, setSkillSuggestionsDismissed] =
    useState(false)
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0)
  const [selectedModel, setSelectedModel] = useState(
    initialSelection?.model ?? DEFAULT_MODEL
  )
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(
    initialSelection?.reasoningEffort ?? DEFAULT_REASONING_EFFORT
  )
  const [codexFastMode, setCodexFastMode] = useState(
    initialSelection?.codexFastMode ?? false
  )
  const hostSkillsQuery = useHostSkills()
  const codexModelsQuery = useCodexModels()
  const modelOptions = codexModelsQuery.data ?? []
  const selectedModelOption =
    modelOptions.find((option) => modelValue(option) === selectedModel) ??
    modelOptions.find((option) => option.isDefault) ??
    modelOptions[0]
  const supportedReasoningOptions =
    selectedModelOption?.supportedReasoningEfforts.map((effort) => ({
      label: formatReasoningEffort(effort.reasoningEffort, t),
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

  useEffect(() => {
    setSelectedModel(initialSelection?.model ?? DEFAULT_MODEL)
    setSelectedReasoningEffort(
      initialSelection?.reasoningEffort ?? DEFAULT_REASONING_EFFORT
    )
    setCodexFastMode(initialSelection?.codexFastMode ?? false)
  }, [
    initialSelection?.codexFastMode,
    initialSelection?.model,
    initialSelection?.reasoningEffort,
    selectionKey,
  ])

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
  const atomicSkillReferences = useMemo(
    () =>
      new Set(
        (hostSkillsQuery.data ?? [])
          .map((skill) => normalizeSearch(skill.reference))
          .filter(Boolean)
      ),
    [hostSkillsQuery.data]
  )
  const composerTextSegments = useMemo(
    () =>
      buildComposerTextSegments(value, atomicSkillReferences, selectionRange),
    [atomicSkillReferences, selectionRange, value]
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
    const textarea = textareaRef.current
    syncComposerOverlayScroll()
    const selection = normalizeAtomicSkillSelection(
      textarea.value,
      textarea.selectionStart ?? textarea.value.length,
      textarea.selectionEnd ?? textarea.value.length,
      atomicSkillReferences
    )
    if (selection.changed) {
      textarea.setSelectionRange(selection.start, selection.end)
    }
    setCaretPosition(selection.end)
    setSelectionRange({ end: selection.end, start: selection.start })
  }

  function handleComposerInput(value: string) {
    onValueChange(value)
    window.requestAnimationFrame(() => {
      syncComposerOverlayScroll()
      syncCaretPosition()
    })
  }

  function syncComposerOverlayScroll() {
    if (!textareaRef.current || !composerOverlayRef.current) {
      return
    }
    const textarea = textareaRef.current
    const overlay = composerOverlayRef.current
    const textareaScrollRange = Math.max(
      0,
      textarea.scrollHeight - textarea.clientHeight
    )
    const overlayScrollRange = Math.max(
      0,
      overlay.scrollHeight - overlay.clientHeight
    )
    overlay.scrollTop =
      textareaScrollRange > 0
        ? (textarea.scrollTop / textareaScrollRange) * overlayScrollRange
        : 0
    overlay.scrollLeft = textarea.scrollLeft
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
      codexFastMode,
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
    const nextModelValue = modelValue(nextModel)
    const nextReasoningEffort = resolveReasoningEffort(
      nextModel,
      selectedReasoningEffort
    )

    setSelectedModel(nextModelValue)
    if (nextReasoningEffort !== selectedReasoningEffort) {
      setSelectedReasoningEffort(nextReasoningEffort)
    }
    onSelectionChange?.({
      codexFastMode,
      model: nextModelValue,
      reasoningEffort: nextReasoningEffort,
    })
  }

  function handleReasoningEffortChange(reasoningEffort: string) {
    setSelectedReasoningEffort(reasoningEffort)
    onSelectionChange?.({
      codexFastMode,
      model: effectiveModel,
      reasoningEffort,
    })
  }

  function handleCodexFastModeChange(checked: boolean) {
    setCodexFastMode(checked)
    onSelectionChange?.({
      codexFastMode: checked,
      model: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
    })
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const atomicDeletion = applyAtomicSkillDeletion(
      value,
      event.currentTarget.selectionStart ?? value.length,
      event.currentTarget.selectionEnd ?? value.length,
      event.key,
      atomicSkillReferences
    )
    if (atomicDeletion) {
      event.preventDefault()
      onValueChange(atomicDeletion.value)
      window.requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(
          atomicDeletion.selectionStart,
          atomicDeletion.selectionEnd
        )
        textareaRef.current?.focus()
        setCaretPosition(atomicDeletion.selectionEnd)
      })
      return
    }

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
                t={t}
              />
            ) : null}

            <div className="overflow-hidden rounded-2xl border border-border bg-popover">
              <div className="px-3 pt-3 pb-2">
                <div className="relative min-h-14">
                  {value.length > 0 ? (
                    <div
                      ref={composerOverlayRef}
                      aria-hidden="true"
                      data-testid="composer-visual-overlay"
                      className="pointer-events-none absolute inset-0 overflow-hidden py-0 text-base leading-relaxed break-words whitespace-pre-wrap text-foreground"
                    >
                      {composerTextSegments.map((segment, index) =>
                        segment.highlighted ? (
                          <ComposerSkillToken
                            key={`${segment.text}-${index}`}
                            known={Boolean(segment.known)}
                            reference={segment.reference}
                            selected={Boolean(segment.selected)}
                            text={segment.text}
                          />
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
                    onMouseUp={syncCaretPosition}
                    onScroll={syncComposerOverlayScroll}
                    onSelect={syncCaretPosition}
                    onTouchEnd={syncCaretPosition}
                    placeholder={placeholder}
                    className={cn(
                      "scrollbar-native-hidden relative z-10 min-h-14 w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground",
                      value.length > 0
                        ? "text-transparent caret-foreground selection:bg-transparent selection:text-transparent"
                        : "text-foreground"
                    )}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-1">
                  <GhostIconButton aria-label={t("composer.addContext")}>
                    <Plus className="size-4" />
                  </GhostIconButton>
                </div>

                <div className="flex min-w-0 items-center justify-end gap-1">
                  <InlineDropdownMenu
                    aria-label={t("composer.model")}
                    codexFastMode={codexFastMode}
                    disabled={
                      codexModelsQuery.isLoading || modelOptions.length === 0
                    }
                    onCodexFastModeChange={handleCodexFastModeChange}
                    options={modelOptions.map((model) => ({
                      label: model.displayName || modelValue(model),
                      value: modelValue(model),
                    }))}
                    showCodexFastModeToggle
                    value={effectiveModel}
                    onValueChange={handleModelChange}
                  >
                    {selectedModelOption
                      ? selectedModelOption.displayName ||
                        modelValue(selectedModelOption)
                      : codexModelsQuery.isLoading
                        ? t("composer.loadingModel")
                        : t("composer.defaultModel")}
                  </InlineDropdownMenu>

                  <InlineDropdownMenu
                    aria-label={t("composer.reasoningEffort")}
                    disabled={supportedReasoningOptions.length === 0}
                    options={supportedReasoningOptions}
                    value={effectiveReasoningEffort}
                    onValueChange={handleReasoningEffortChange}
                  >
                    {formatReasoningEffort(effectiveReasoningEffort, t)}
                  </InlineDropdownMenu>

                  <Button
                    type="button"
                    size="icon-lg"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                    aria-label={
                      interruptMode
                        ? t("composer.interruptTurn")
                        : t("composer.sendMessage")
                    }
                    title={
                      interruptMode
                        ? t("composer.interruptTurn")
                        : t("composer.sendMessage")
                    }
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
                      <Square className="size-3.5 fill-current" />
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

function ComposerSkillToken({
  known,
  reference,
  selected,
  text,
}: {
  known: boolean
  reference?: string
  selected: boolean
  text: string
}) {
  if (known) {
    return (
      <span
        data-testid="composer-skill-highlight"
        data-known="true"
        data-selected={selected ? "true" : "false"}
        className="relative inline-block text-accent-foreground"
      >
        <span aria-hidden="true" className="invisible inline-flex">
          <SkillReferenceChip
            reference={reference || text.replace(/^\$/, "")}
          />
        </span>
        <span className="absolute inset-y-0 left-0 inline-flex items-center">
          <SkillReferenceChip
            reference={reference || text.replace(/^\$/, "")}
          />
        </span>
      </span>
    )
  }

  return (
    <span
      data-testid="composer-skill-highlight"
      className="relative inline-block text-accent-foreground"
    >
      <span
        aria-hidden="true"
        className="absolute -inset-x-1 inset-y-0 rounded-md bg-accent"
      />
      <span className="relative">{text}</span>
    </span>
  )
}

function SkillSuggestionPopover({
  highlightedIndex,
  loading,
  onSelectSkill,
  query,
  skills,
  t,
}: {
  highlightedIndex: number
  loading: boolean
  onSelectSkill: (skill: SkillSummary) => void
  query: string
  skills: SkillSummary[]
  t: ReturnType<typeof useTranslation>["t"]
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-full z-50 mb-2"
      data-testid="skill-suggestion-popover"
    >
      <div className="overflow-hidden rounded-lg border border-border bg-popover text-sm font-medium text-foreground shadow-lg">
        <div className="border-b border-border px-4 py-2 text-xs tracking-wider text-muted-foreground uppercase">
          {loading
            ? t("composer.loadingSkills")
            : query
              ? t("composer.skillsMatching", { query: `$${query}` })
              : t("composer.skills")}
        </div>

        {loading ? (
          <div className="px-4 py-3 text-muted-foreground">
            {t("composer.loadingSkills")}
          </div>
        ) : skills.length === 0 ? (
          <div
            className="px-4 py-3 text-muted-foreground"
            data-testid="skill-suggestion-empty"
          >
            {t("composer.noSkills", { query: `$${query}` })}{" "}
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
                      {formatSkillSource(skill.source, t)}
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

function resolveReasoningEffort(model: AgentModel, requested: string) {
  const efforts = model.supportedReasoningEfforts.map(
    (effort) => effort.reasoningEffort
  )
  if (efforts.includes(requested)) {
    return requested
  }
  return model.defaultReasoningEffort || efforts[0] || ""
}

function InlineDropdownMenu({
  children,
  codexFastMode = false,
  disabled = false,
  onCodexFastModeChange,
  onValueChange,
  options,
  showCodexFastModeToggle = false,
  value,
  ...props
}: {
  children: string
  codexFastMode?: boolean
  disabled?: boolean
  onCodexFastModeChange?: (checked: boolean) => void
  onValueChange: (value: string) => void
  options: readonly { label: string; value: string }[]
  showCodexFastModeToggle?: boolean
  value: string
} & Omit<React.ComponentProps<typeof Button>, "onChange" | "value">) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          className="rounded-full text-muted-foreground hover:text-foreground"
          disabled={disabled}
          {...props}
        >
          {codexFastMode ? (
            <Zap
              className="size-3.5 fill-current"
              data-testid="composer-fast-mode-icon"
            />
          ) : null}
          <span>{children}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {showCodexFastModeToggle ? (
          <>
            <div className="flex items-center justify-between gap-4 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {t("composer.fastMode")}
                </div>
              </div>
              <Switch
                aria-label={t("composer.codexFastMode")}
                checked={codexFastMode}
                onCheckedChange={(checked) => {
                  onCodexFastModeChange?.(checked)
                }}
              />
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

function formatSkillSource(
  source: string,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (source) {
    case "project":
      return t("composer.skillSource.project")
    case "plugin":
      return t("composer.skillSource.plugin")
    case "local":
    default:
      return t("composer.skillSource.local")
  }
}

function formatReasoningEffort(
  effort: string,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (effort) {
    case "none":
      return t("composer.reasoning.none")
    case "minimal":
      return t("composer.reasoning.minimal")
    case "low":
      return t("composer.reasoning.low")
    case "medium":
      return t("composer.reasoning.medium")
    case "high":
      return t("composer.reasoning.high")
    case "xhigh":
      return t("composer.reasoning.xhigh")
    default:
      return effort
  }
}

function normalizeSearch(value?: string) {
  return (value ?? "").trim().toLowerCase()
}

function buildComposerTextSegments(
  value: string,
  skillReferences: ReadonlySet<string>,
  selectedRange: {
    end: number
    start: number
  }
): ComposerTextSegment[] {
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
    const reference = normalizeSearch(token.slice(1))
    const tokenStart = matchIndex + prefix.length
    const tokenEnd = tokenStart + token.length

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
      const known = skillReferences.has(reference)
      segments.push({
        highlighted: true,
        known,
        reference,
        selected:
          known &&
          selectedRange.start === tokenStart &&
          selectedRange.end === tokenEnd,
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
