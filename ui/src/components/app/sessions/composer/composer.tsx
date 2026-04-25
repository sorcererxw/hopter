import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
  type ComponentProps,
  type ClipboardEvent,
  type Key,
  type KeyboardEvent,
} from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  Paperclip,
  Square,
  X,
  Zap,
} from "lucide-react"
import {
  Button,
  Dropdown,
  Header,
  Label,
  Separator,
  Switch,
  Tooltip,
} from "@heroui/react"

import {
  composerSendShortcutPreferenceFromConfig,
  formatComposerSendShortcutPreference,
  isComposerSendShortcutEvent,
  useConfig,
} from "@/features/config/use-config"
import { useCodexModels } from "@/features/host/use-host-models"
import { useHostSkills } from "@/features/host/use-host-skills"
import type { AgentModel, SkillSummary } from "@/gen/proto/hopter/v1/host_pb"
import { cn } from "@/lib/utils"

import type { SessionComposerSelection } from "./selection"
import {
  applyAtomicSkillDeletion,
  normalizeAtomicSkillSelection,
} from "./skill-token"
import {
  hiddenScrollbarClassName,
  SkillReferenceChip,
  stableDropdownPopoverClassName,
} from "@/components/app/shared"

const MAX_SKILL_SUGGESTIONS = 8
const DEFAULT_MODEL = "gpt-5.4"
const DEFAULT_REASONING_EFFORT = "xhigh"
const MAX_IMAGE_ATTACHMENTS = 4
const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024

export type SessionComposerAttachment = {
  contentType: string
  id: string
  label: string
  size: number
  url: string
}

type SessionComposerSubmitOptions = {
  attachments: SessionComposerAttachment[]
  codexFastMode: boolean
  model: string
  reasoningEffort: string
}

type SessionComposerProps = {
  busy?: boolean
  contextWindowUsage?: SessionComposerContextWindowUsage
  disabled?: boolean
  interruptMode?: boolean
  initialSelection?: Partial<SessionComposerSelection>
  placeholder: string
  placement?: "sticky" | "inline"
  composerTestId?: string
  footerStart?: ReactNode
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

type SessionComposerContextWindowUsage = {
  lastTokens?: bigint | number
  totalTokens?: bigint | number
  usedTokens?: bigint | number
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

type ComposerDropdownOption = {
  label: string
  value: string
}

// SessionComposer owns prompt entry plus lightweight agent selection state. It
// also does local skill-token editing so the backend receives already-formed
// `$skill` references instead of partial mention syntax.
export function SessionComposer({
  busy = false,
  contextWindowUsage,
  disabled = false,
  interruptMode = false,
  initialSelection,
  placeholder,
  placement = "sticky",
  composerTestId,
  footerStart,
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
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)
  const [attachments, setAttachments] = useState<SessionComposerAttachment[]>(
    []
  )
  const [attachmentError, setAttachmentError] = useState("")
  const canSubmit =
    (((value.trim().length > 0 || attachments.length > 0) && !interruptMode) ||
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
  const configQuery = useConfig()
  const sendShortcut = composerSendShortcutPreferenceFromConfig(
    configQuery.data
  )
  const sendShortcutLabel = formatComposerSendShortcutPreference(sendShortcut)
  const sendButtonTooltip = interruptMode
    ? t("composer.interruptTurnShortcut")
    : t("composer.sendMessageShortcut", { shortcut: sendShortcutLabel })
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
    // Reset local selections when the parent swaps session context or supplies
    // a fresh initial preference set.
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
  const hasComposerTextOverlay = composerTextSegments.some(
    (segment) => segment.highlighted
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
      // New mention targets should reopen suggestion state and reset keyboard
      // focus without fighting the current keystroke.
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

  useEffect(() => {
    if (!interruptMode || !canSubmit) {
      return
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.repeat || event.defaultPrevented) {
        return
      }

      event.preventDefault()
      void onInterrupt?.()
    }

    window.addEventListener("keydown", handleWindowKeyDown)
    return () => window.removeEventListener("keydown", handleWindowKeyDown)
  }, [canSubmit, interruptMode, onInterrupt])

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
      // Known skill references behave like atomic chips: keep the caret from
      // landing in the middle of a `$skill-name` token.
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
      // Move the caret to the end of the inserted token plus trailing space so
      // the next keystroke continues the prompt naturally.
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
      attachments,
      codexFastMode,
      model: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
    })
    setAttachments([])
    setAttachmentError("")
  }

  async function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    await attachImageFiles(files)
  }

  async function handleTextareaPaste(
    event: ClipboardEvent<HTMLTextAreaElement>
  ) {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    )
    if (imageFiles.length === 0) {
      return
    }

    event.preventDefault()
    await attachImageFiles(imageFiles)
  }

  async function attachImageFiles(files: File[]) {
    if (files.length === 0) {
      return
    }

    const availableSlots = MAX_IMAGE_ATTACHMENTS - attachments.length
    // Enforce image-only uploads and a hard attachment cap in the client so the
    // composer can explain rejection before the request leaves the browser.
    const acceptedFiles = files
      .filter((file) => file.type.startsWith("image/"))
      .filter((file) => file.size <= MAX_IMAGE_ATTACHMENT_BYTES)
      .slice(0, Math.max(0, availableSlots))

    if (acceptedFiles.length !== files.length) {
      setAttachmentError(
        t("composer.imageAttachLimit", {
          count: MAX_IMAGE_ATTACHMENTS,
          size: formatBytes(MAX_IMAGE_ATTACHMENT_BYTES),
        })
      )
    } else {
      setAttachmentError("")
    }

    let nextAttachments: SessionComposerAttachment[]
    try {
      nextAttachments = await Promise.all(
        acceptedFiles.map(readImageAttachment)
      )
    } catch {
      setAttachmentError(t("composer.imageAttachFailed"))
      return
    }
    if (nextAttachments.length > 0) {
      setAttachments((current) =>
        [...current, ...nextAttachments].slice(0, MAX_IMAGE_ATTACHMENTS)
      )
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    )
    setAttachmentError("")
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
      // Backspace/delete should remove an entire skill token rather than
      // corrupting the mention into an unparseable partial reference.
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

    if (event.key === "Enter" && event.shiftKey) {
      return
    }

    if (isComposerSendShortcutEvent(event, sendShortcut)) {
      event.preventDefault()
      void handleSubmit()
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

      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
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

            <div className="overflow-hidden rounded-2xl border border-border bg-overlay">
              <div className="px-3 pt-3 pb-2">
                <div className="relative min-h-14">
                  {hasComposerTextOverlay ? (
                    <div
                      ref={composerOverlayRef}
                      aria-hidden="true"
                      data-testid="composer-visual-overlay"
                      className="pointer-events-none absolute inset-0 overflow-hidden py-0 text-base leading-relaxed break-words whitespace-pre-wrap text-foreground"
                    >
                      {/* The overlay mirrors textarea content only for highlighted
                      skill chips; the real editable value still lives in the
                      textarea underneath. */}
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
                    onPaste={(event) => void handleTextareaPaste(event)}
                    onScroll={syncComposerOverlayScroll}
                    onSelect={syncCaretPosition}
                    onTouchEnd={syncCaretPosition}
                    placeholder={placeholder}
                    className={cn(
                      hiddenScrollbarClassName,
                      "relative z-10 min-h-14 w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-field-placeholder",
                      hasComposerTextOverlay
                        ? "text-transparent caret-foreground selection:bg-transparent selection:text-transparent"
                        : "text-foreground"
                    )}
                  />
                </div>

                {attachments.length > 0 || attachmentError ? (
                  <div className="px-3 pb-2">
                    {attachments.length > 0 ? (
                      <div
                        className="flex flex-wrap gap-2"
                        data-testid="composer-image-attachments"
                      >
                        {attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface-secondary px-2 py-1 text-xs text-foreground"
                          >
                            <img
                              alt=""
                              src={attachment.url}
                              className="size-6 rounded-md object-cover"
                            />
                            <span className="max-w-40 truncate">
                              {attachment.label}
                            </span>
                            <GhostIconButton
                              aria-label={t("composer.removeAttachment", {
                                label: attachment.label,
                              })}
                              className="size-5 md:size-5"
                              onPress={() => removeAttachment(attachment.id)}
                            >
                              <X className="size-3" />
                            </GhostIconButton>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {attachmentError ? (
                      <div className="mt-2 text-xs text-amber-400">
                        {attachmentError}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-center justify-between px-2 pb-2">
                  <div className="flex min-w-0 items-center gap-1">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(event) => void handleImageSelection(event)}
                    />
                    <Tooltip>
                      <Tooltip.Trigger>
                        <span className="inline-flex rounded-full">
                          <GhostIconButton
                            aria-label={t("composer.attachImages")}
                            isDisabled={disabled || busy || interruptMode}
                            onPress={() => imageInputRef.current?.click()}
                          >
                            <Paperclip className="size-4" />
                          </GhostIconButton>
                        </span>
                      </Tooltip.Trigger>
                      <Tooltip.Content placement="top" showArrow>
                        {t("composer.attachImages")}
                      </Tooltip.Content>
                    </Tooltip>
                    {footerStart ? (
                      <div className="min-w-0">{footerStart}</div>
                    ) : null}
                  </div>

                  <div className="flex min-w-0 items-center justify-end gap-1">
                    <ContextWindowIndicator t={t} usage={contextWindowUsage} />

                    <AgentSelectionDropdown
                      aria-label={t("composer.agentSelection")}
                      codexFastMode={codexFastMode}
                      disabled={
                        codexModelsQuery.isLoading || modelOptions.length === 0
                      }
                      onCodexFastModeChange={handleCodexFastModeChange}
                      modelOptions={modelOptions.map((model) => ({
                        label: model.displayName || modelValue(model),
                        value: modelValue(model),
                      }))}
                      modelValue={effectiveModel}
                      reasoningOptions={supportedReasoningOptions}
                      reasoningValue={effectiveReasoningEffort}
                      showCodexFastModeToggle
                      tooltip={t("composer.agentSelection")}
                      onModelChange={handleModelChange}
                      onReasoningChange={handleReasoningEffortChange}
                    >
                      <span className="min-w-0 truncate">
                        {selectedModelOption
                          ? selectedModelOption.displayName ||
                            modelValue(selectedModelOption)
                          : codexModelsQuery.isLoading
                            ? t("composer.loadingModel")
                            : t("composer.defaultModel")}
                      </span>
                      {effectiveReasoningEffort ? (
                        <span className="shrink-0">
                          {formatReasoningEffort(effectiveReasoningEffort, t)}
                        </span>
                      ) : null}
                    </AgentSelectionDropdown>

                    <Tooltip>
                      <Tooltip.Trigger>
                        <span className="inline-flex rounded-full">
                          <Button
                            type="button"
                            size="lg"
                            isIconOnly
                            onPress={() => void handleSubmit()}
                            isDisabled={!canSubmit}
                            aria-label={
                              interruptMode
                                ? t("composer.interruptTurn")
                                : t("composer.sendMessage")
                            }
                            data-testid={
                              interruptMode ? interruptTestId : submitTestId
                            }
                            className={cn(
                              "size-9 rounded-full transition md:size-8",
                              canSubmit
                                ? "bg-accent text-accent-foreground hover:brightness-110"
                                : "bg-surface-tertiary text-muted"
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
                        </span>
                      </Tooltip.Trigger>
                      <Tooltip.Content placement="top" showArrow>
                        {sendButtonTooltip}
                      </Tooltip.Content>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function ContextWindowIndicator({
  t,
  usage,
}: {
  t: ReturnType<typeof useTranslation>["t"]
  usage?: SessionComposerContextWindowUsage
}) {
  const usedTokens = toSafeNumber(usage?.usedTokens)
  const totalTokens = toSafeNumber(usage?.totalTokens)

  if (!usedTokens || !totalTokens) {
    return null
  }

  const clampedUsedTokens = Math.min(usedTokens, totalTokens)
  const usedPercent = Math.max(
    1,
    Math.min(99, Math.round((clampedUsedTokens / totalTokens) * 100))
  )
  const remainingPercent = Math.max(0, 100 - usedPercent)
  const ringStyle = {
    background: `conic-gradient(currentColor ${usedPercent}%, transparent 0)`,
  }

  return (
    <Tooltip>
      <Tooltip.Trigger>
        <button
          type="button"
          aria-label={t("composer.contextWindow")}
          className="inline-flex size-8 items-center justify-center rounded-full bg-transparent text-foreground transition hover:bg-surface-tertiary"
        >
          <span className="relative flex size-4 items-center justify-center text-muted">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-border"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full opacity-80"
              style={ringStyle}
            />
            <span
              aria-hidden="true"
              className="absolute inset-[2px] rounded-full bg-background"
            />
          </span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content
        placement="top"
        offset={8}
        className="max-w-72 px-5 py-4"
        showArrow
      >
        <div className="space-y-3 text-center">
          <div className="text-sm font-medium">
            {t("composer.contextWindow")}
          </div>
          <div className="text-sm leading-snug">
            {t("composer.contextWindowSummary", {
              usedPercent,
              percent: remainingPercent,
              remainingPercent,
            })}
          </div>
          <div className="text-sm leading-snug">
            {t("composer.contextWindowTokensCompact", {
              total: formatTokenCount(totalTokens),
              used: formatTokenCount(clampedUsedTokens),
            })}
          </div>
        </div>
      </Tooltip.Content>
    </Tooltip>
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
      <div className="overflow-hidden rounded-lg border border-border bg-overlay text-sm font-medium text-foreground shadow-lg">
        <div className="border-b border-border px-4 py-2 text-xs tracking-wider text-muted uppercase">
          {loading
            ? t("composer.loadingSkills")
            : query
              ? t("composer.skillsMatching", { query: `$${query}` })
              : t("composer.skills")}
        </div>

        {loading ? (
          <div className="px-4 py-3 text-muted">
            {t("composer.loadingSkills")}
          </div>
        ) : skills.length === 0 ? (
          <div
            className="px-4 py-3 text-muted"
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
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-secondary font-mono text-xs text-foreground">
                  $
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{skill.name}</span>
                    <span className="font-mono text-xs text-muted">
                      ${skill.reference}
                    </span>
                    <span className="shrink-0 text-xs tracking-wider text-muted uppercase">
                      {formatSkillSource(skill.source, t)}
                    </span>
                  </div>
                  {skill.description ? (
                    <div className="mt-1 line-clamp-1 text-muted">
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
}: Omit<
  React.ComponentProps<typeof Button>,
  "isIconOnly" | "type" | "variant"
>) {
  return (
    <Button
      type="button"
      variant="ghost"
      isIconOnly
      className={cn("text-muted md:size-7", className)}
      {...props}
    >
      {children}
    </Button>
  )
}

function readImageAttachment(file: File): Promise<SessionComposerAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        contentType: file.type || "image/*",
        id: createAttachmentId(),
        label: file.name || "Image",
        size: file.size,
        url: String(reader.result ?? ""),
      })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function createAttachmentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatBytes(bytes: number) {
  const megabytes = bytes / (1024 * 1024)
  return `${Math.round(megabytes)} MB`
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

function AgentSelectionDropdown({
  children,
  codexFastMode = false,
  disabled = false,
  modelOptions,
  modelValue,
  onCodexFastModeChange,
  onModelChange,
  onReasoningChange,
  reasoningOptions,
  reasoningValue,
  showCodexFastModeToggle = false,
  tooltip,
  ...props
}: {
  children: ReactNode
  codexFastMode?: boolean
  disabled?: boolean
  modelOptions: readonly ComposerDropdownOption[]
  modelValue: string
  onCodexFastModeChange?: (checked: boolean) => void
  onModelChange: (value: string) => void
  onReasoningChange: (value: string) => void
  reasoningOptions: readonly ComposerDropdownOption[]
  reasoningValue: string
  showCodexFastModeToggle?: boolean
  tooltip: string
} & Omit<ComponentProps<typeof Button>, "onChange" | "value">) {
  const { t } = useTranslation()
  const positionFreezeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const [shouldUpdateMenuPosition, setShouldUpdateMenuPosition] =
    useState(true)
  const selectedModelLabel =
    modelOptions.find((option) => option.value === modelValue)?.label ??
    modelValue

  useEffect(() => {
    return () => {
      if (positionFreezeTimeoutRef.current !== null) {
        clearTimeout(positionFreezeTimeoutRef.current)
      }
    }
  }, [])

  function handleOpenChange(isOpen: boolean) {
    if (positionFreezeTimeoutRef.current !== null) {
      clearTimeout(positionFreezeTimeoutRef.current)
      positionFreezeTimeoutRef.current = null
    }

    setShouldUpdateMenuPosition(true)
    if (isOpen) {
      // Let React Aria compute the initial placement, then keep the root menu
      // still while submenus open and trigger their own overlay measurements.
      positionFreezeTimeoutRef.current = setTimeout(() => {
        setShouldUpdateMenuPosition(false)
        positionFreezeTimeoutRef.current = null
      }, 50)
    }
  }

  function handleAction(key: Key) {
    const action = String(key)
    if (action.startsWith("reasoning:")) {
      onReasoningChange(action.slice("reasoning:".length))
    }
  }

  return (
    <Dropdown onOpenChange={handleOpenChange}>
      <Tooltip>
        <Tooltip.Trigger>
          <span className="inline-flex rounded-full">
            <Dropdown.Trigger isDisabled={disabled}>
              <Button
                type="button"
                variant="ghost"
                className="max-w-64 rounded-full text-muted hover:text-foreground"
                isDisabled={disabled}
                {...props}
              >
                {codexFastMode ? (
                  <Zap
                    className="size-3.5 fill-current"
                    data-testid="composer-fast-mode-icon"
                  />
                ) : null}
                <span className="flex min-w-0 items-center gap-1">
                  {children}
                </span>
                <ChevronDown className="size-3" />
              </Button>
            </Dropdown.Trigger>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content placement="top" showArrow>
          {tooltip}
        </Tooltip.Content>
      </Tooltip>
      <Dropdown.Popover
        className={cn(stableDropdownPopoverClassName, "w-72")}
        shouldUpdatePosition={shouldUpdateMenuPosition}
      >
        <Dropdown.Menu onAction={handleAction} selectionMode="none">
          {reasoningOptions.length > 0 ? (
            <Dropdown.Section>
              <Header className="px-2 py-1 text-xs text-muted">
                {t("composer.intelligence")}
              </Header>
              {reasoningOptions.map((option) => (
                <Dropdown.Item
                  key={`reasoning:${option.value}`}
                  id={`reasoning:${option.value}`}
                  textValue={option.label}
                >
                  <Label>{option.label}</Label>
                  <span className="flex size-3.5 items-center justify-center">
                    {option.value === reasoningValue ? (
                      <Check className="size-3.5" />
                    ) : null}
                  </span>
                </Dropdown.Item>
              ))}
            </Dropdown.Section>
          ) : null}
          <Separator className="my-1" />
          <Dropdown.SubmenuTrigger>
            <Dropdown.Item id="model-submenu" textValue={t("composer.model")}>
              <Label>{t("composer.model")}</Label>
              <span className="ml-auto flex min-w-0 items-center gap-2">
                <span className="max-w-36 truncate text-muted">
                  {selectedModelLabel}
                </span>
                <Dropdown.SubmenuIndicator />
              </span>
            </Dropdown.Item>
            <Dropdown.Popover
              className={cn(stableDropdownPopoverClassName, "w-72")}
              placement="start top"
            >
              <Dropdown.Menu
                onAction={(key) =>
                  onModelChange(String(key).slice("model:".length))
                }
                selectionMode="none"
              >
                {modelOptions.map((option) => (
                  <Dropdown.Item
                    key={`model:${option.value}`}
                    id={`model:${option.value}`}
                    textValue={option.label}
                  >
                    <Label>{option.label}</Label>
                    <span className="flex size-3.5 items-center justify-center">
                      {option.value === modelValue ? (
                        <Check className="size-3.5" />
                      ) : null}
                    </span>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.SubmenuTrigger>
        </Dropdown.Menu>
        {showCodexFastModeToggle ? (
          <div className="flex items-center justify-between gap-4 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {t("composer.fastMode")}
              </div>
            </div>
            <Switch
              aria-label={t("composer.codexFastMode")}
              isSelected={codexFastMode}
              onChange={(checked) => {
                onCodexFastModeChange?.(checked)
              }}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        ) : null}
      </Dropdown.Popover>
    </Dropdown>
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

function toSafeNumber(value: bigint | number | undefined) {
  if (typeof value === "bigint") {
    return Number(value)
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  return 0
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    const compact = value / 1_000_000
    return `${trimTrailingZeroes(compact.toFixed(compact >= 10 ? 0 : 1))}M`
  }
  if (value >= 1_000) {
    const compact = value / 1_000
    return `${trimTrailingZeroes(compact.toFixed(compact >= 100 ? 0 : 1))}k`
  }
  return `${value}`
}

function trimTrailingZeroes(value: string) {
  return value.replace(/\.0$/, "")
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
