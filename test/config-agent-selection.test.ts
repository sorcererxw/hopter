import { describe, expect, test } from "bun:test";

import {
  agentSelectionPreferenceFromConfig,
  buildAgentSelectionConfigPatch,
} from "../ui/src/features/config/agent-selection.ts";

describe("agent selection config persistence", () => {
  test("reads persisted fast mode even without model defaults", () => {
    expect(
      agentSelectionPreferenceFromConfig({
        agent: {
          defaultBackend: "codex",
          defaultCodexFastMode: true,
          defaultModel: "",
          defaultReasoningEffort: "",
        },
      } as never),
    ).toEqual({
      codexFastMode: true,
      model: "",
      reasoningEffort: "",
    });
  });

  test("reads persisted fast mode alongside model defaults", () => {
    expect(
      agentSelectionPreferenceFromConfig({
        agent: {
          defaultBackend: "codex",
          defaultCodexFastMode: true,
          defaultModel: "gpt-5.4",
          defaultReasoningEffort: "high",
        },
      } as never),
    ).toEqual({
      codexFastMode: true,
      model: "gpt-5.4",
      reasoningEffort: "high",
    });
  });

  test("preserves existing model and reasoning when only fast mode changes", () => {
    expect(
      buildAgentSelectionConfigPatch(
        {
          agent: {
            defaultBackend: "codex",
            defaultCodexFastMode: false,
            defaultModel: "gpt-5.4",
            defaultReasoningEffort: "xhigh",
          },
        } as never,
        {
          codexFastMode: true,
        },
      ),
    ).toEqual({
      defaultBackend: "codex",
      defaultCodexFastMode: true,
      defaultModel: "gpt-5.4",
      defaultReasoningEffort: "xhigh",
    });
  });
});
