export type SessionComposerSelection = {
  codexFastMode: boolean
  model: string
  reasoningEffort: string
}

const sessionComposerSelections = new Map<string, SessionComposerSelection>()

export function getSessionComposerSelection(sessionId: string) {
  const selection = sessionComposerSelections.get(sessionId)
  return selection ? { ...selection } : undefined
}

export function rememberSessionComposerSelection(
  sessionId: string,
  selection: SessionComposerSelection
) {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return
  }

  sessionComposerSelections.set(normalizedSessionId, { ...selection })
}

export function clearSessionComposerSelections() {
  sessionComposerSelections.clear()
}
