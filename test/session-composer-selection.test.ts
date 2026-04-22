import { describe, expect, test } from "bun:test"

import {
  clearSessionComposerSelections,
  getSessionComposerSelection,
  rememberSessionComposerSelection,
} from "../ui/src/components/app/session-composer-selection.ts"

describe("session composer selection handoff", () => {
  test("remembers model and reasoning effort per session", () => {
    clearSessionComposerSelections()

    rememberSessionComposerSelection("session-low", {
      model: "gpt-5.4",
      reasoningEffort: "low",
    })
    rememberSessionComposerSelection("session-high", {
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
    })

    expect(getSessionComposerSelection("session-low")).toEqual({
      model: "gpt-5.4",
      reasoningEffort: "low",
    })
    expect(getSessionComposerSelection("session-high")).toEqual({
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
    })
  })

  test("returns defensive copies", () => {
    clearSessionComposerSelections()

    rememberSessionComposerSelection("session-low", {
      model: "gpt-5.4",
      reasoningEffort: "low",
    })

    const selection = getSessionComposerSelection("session-low")
    if (!selection) {
      throw new Error("expected remembered selection")
    }
    selection.reasoningEffort = "xhigh"

    expect(getSessionComposerSelection("session-low")?.reasoningEffort).toBe(
      "low"
    )
  })
})
