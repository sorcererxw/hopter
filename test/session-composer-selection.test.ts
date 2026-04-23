import { describe, expect, test } from "bun:test";

import {
  clearSessionComposerSelections,
  getSessionComposerSelection,
  rememberSessionComposerSelection,
  resolveSessionComposerSelection,
} from "../ui/src/components/app/sessions/composer/selection.ts";

describe("session composer selection handoff", () => {
  test("remembers model and reasoning effort per session", () => {
    clearSessionComposerSelections();

    rememberSessionComposerSelection("session-low", {
      codexFastMode: false,
      model: "gpt-5.4",
      reasoningEffort: "low",
    });
    rememberSessionComposerSelection("session-high", {
      codexFastMode: true,
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
    });

    expect(getSessionComposerSelection("session-low")).toEqual({
      codexFastMode: false,
      model: "gpt-5.4",
      reasoningEffort: "low",
    });
    expect(getSessionComposerSelection("session-high")).toEqual({
      codexFastMode: true,
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
    });
  });

  test("returns defensive copies", () => {
    clearSessionComposerSelections();

    rememberSessionComposerSelection("session-low", {
      codexFastMode: false,
      model: "gpt-5.4",
      reasoningEffort: "low",
    });

    const selection = getSessionComposerSelection("session-low");
    if (!selection) {
      throw new Error("expected remembered selection");
    }
    selection.reasoningEffort = "xhigh";

    expect(getSessionComposerSelection("session-low")?.reasoningEffort).toBe(
      "low",
    );
  });

  test("prefers the first non-empty persisted selection candidate", () => {
    expect(
      resolveSessionComposerSelection(
        undefined,
        {
          codexFastMode: true,
          model: " ",
          reasoningEffort: "",
        },
        {
          codexFastMode: false,
          model: "gpt-5.4",
          reasoningEffort: "medium",
        },
      ),
    ).toEqual({
      codexFastMode: false,
      model: "gpt-5.4",
      reasoningEffort: "medium",
    });
  });
});
