import type { UserConfig } from "@/gen/proto/hopter/v1/config_pb"

export type AgentSelectionPreference = {
  codexFastMode: boolean
  model: string
  reasoningEffort: string
}

// These helpers isolate how session/home composers map between UI selections
// and the persisted config shape.
export function agentSelectionPreferenceFromConfig(
  config?: UserConfig
): AgentSelectionPreference | undefined {
  const agent = config?.agent
  if (!agent) {
    return undefined
  }

  const model = agent.defaultModel.trim()
  const reasoningEffort = agent.defaultReasoningEffort.trim()
  if (!agent.defaultCodexFastMode && !model && !reasoningEffort) {
    return undefined
  }

  return {
    codexFastMode: agent.defaultCodexFastMode,
    model,
    reasoningEffort,
  }
}

export function buildAgentSelectionConfigPatch(
  config: UserConfig | undefined,
  selection: Partial<AgentSelectionPreference>
) {
  return {
    defaultBackend: config?.agent?.defaultBackend?.trim() || "codex",
    defaultCodexFastMode:
      selection.codexFastMode ?? config?.agent?.defaultCodexFastMode ?? false,
    defaultModel: (selection.model ?? config?.agent?.defaultModel ?? "").trim(),
    defaultReasoningEffort: (
      selection.reasoningEffort ??
      config?.agent?.defaultReasoningEffort ??
      ""
    ).trim(),
  }
}
