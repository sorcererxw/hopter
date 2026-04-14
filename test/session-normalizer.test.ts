import { describe, expect, test } from "bun:test";
import {
  deriveSessionStateFromThread,
  normalizeCompletedItem,
  normalizeNotification,
  normalizeServerRequest,
} from "../src/server/services/session-normalizer.ts";

describe("session-normalizer", () => {
  test("maps approval requests to attention state", () => {
    const patch = normalizeServerRequest("item/commandExecution/requestApproval", 7);
    expect(patch.status).toBe("waiting_approval");
    expect(patch.attention?.reason).toBe("approval_required");
    expect(patch.attention?.requestId).toBe(7);
  });

  test("maps completed agent message to summary artifact", () => {
    const patch = normalizeCompletedItem({
      type: "agentMessage",
      text: "Implemented reconnect handling and added validation.",
      phase: "final_answer",
    });

    expect(patch.lastSummary).toContain("Implemented reconnect handling");
    expect(patch.artifactText?.kind).toBe("final_message");
  });

  test("derives thread state from historical turns", () => {
    const patch = deriveSessionStateFromThread({
      turns: [
        {
          status: "completed",
          items: [
            {
              type: "agentMessage",
              text: "SUMMARY_FROM_HISTORY",
              phase: "final_answer",
            },
          ],
        },
      ],
    });

    expect(patch.status).toBe("completed");
    expect(patch.lastSummary).toContain("SUMMARY_FROM_HISTORY");
  });

  test("maps degraded notification", () => {
    const patch = normalizeNotification("error", {});
    expect(patch.status).toBe("degraded");
    expect(patch.degraded).toBe(true);
  });
});
