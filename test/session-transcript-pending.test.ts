import { describe, expect, test } from "bun:test"

import {
  SessionTranscriptItemKind,
  type SessionTranscriptPage,
} from "../ui/src/gen/proto/hopter/v1/session_pb.ts"
import {
  insertPendingInputActivityItem,
  isDisplayableTranscriptItem,
  transcriptTextMatchesPendingHint,
  type ActivityItem,
} from "../ui/src/components/app/sessions/transcript/activity.ts"
import {
  mergeLatestTranscriptPage,
  shouldPreserveLiveTranscriptItem,
} from "../ui/src/components/app/sessions/transcript/page-merge.ts"

describe("session transcript pending hint reconciliation", () => {
  test("matches ellipsis-truncated hints against the full user transcript text", () => {
    const prompt =
      "请用中文说明 sample-project/hopter 项目当前现状：产品定位、Go-first 架构方向、当前可用能力、最近已知验证证据、下一步主要风险。请基于当前 sample-project 项目上下文回答，先不要改代码。"
    const truncatedHint =
      "请用中文说明 sample-project/hopter 项目当前现状：产品定位、Go-first 架构方向、当前可用能力、…"

    expect(prompt.startsWith(truncatedHint)).toBe(false)
    expect(transcriptTextMatchesPendingHint(prompt, truncatedHint)).toBe(true)
  })

  test("does not match unrelated user messages", () => {
    expect(
      transcriptTextMatchesPendingHint(
        "Reply exactly: DIFFERENT",
        "Reply exactly: EXPECTED…"
      )
    ).toBe(false)
  })

  test("places pending input before a live assistant draft", () => {
    const items: ActivityItem[] = [
      transcriptActivityItem("user-1", SessionTranscriptItemKind.USER_MESSAGE, {
        body: "baseline prompt",
        orderKey: "000000000000:000000000000:user-1",
      }),
      transcriptActivityItem("agent-1", SessionTranscriptItemKind.AGENT_MESSAGE, {
        body: "baseline answer",
        orderKey: "000000000000:000000000001:agent-1",
      }),
      transcriptActivityItem("draft-1", SessionTranscriptItemKind.AGENT_MESSAGE, {
        body: "streaming answer",
        orderKey: "live:00000000000000000001:draft-1",
        status: "streaming",
      }),
    ]

    const next = insertPendingInputActivityItem(items, {
      key: "pending-input",
      text: "follow-up prompt",
    })

    expect(next.map((item) => item.key)).toEqual([
      "user-1",
      "agent-1",
      "pending-input",
      "draft-1",
    ])
    expect(items.map((item) => item.key)).toEqual([
      "user-1",
      "agent-1",
      "draft-1",
    ])
  })

  test("appends pending input when no live assistant draft exists", () => {
    const items: ActivityItem[] = [
      transcriptActivityItem("user-1", SessionTranscriptItemKind.USER_MESSAGE, {
        body: "baseline prompt",
        orderKey: "000000000000:000000000000:user-1",
      }),
      transcriptActivityItem("agent-1", SessionTranscriptItemKind.AGENT_MESSAGE, {
        body: "baseline answer",
        orderKey: "000000000000:000000000001:agent-1",
      }),
    ]

    const next = insertPendingInputActivityItem(items, {
      key: "pending-input",
      text: "follow-up prompt",
    })

    expect(next.map((item) => item.key)).toEqual([
      "user-1",
      "agent-1",
      "pending-input",
    ])
  })

  test("hides completed placeholder-only reasoning transcript markers", () => {
    expect(
      isDisplayableTranscriptItem(
        transcriptItem("reasoning-empty", SessionTranscriptItemKind.REASONING, {
          body: "Reasoning progress emitted by Codex.",
          displayBody: "",
          orderKey: "trace:000000000001:reasoning-empty",
          status: "completed",
          title: "Thinking",
        })
      )
    ).toBe(false)

    expect(
      isDisplayableTranscriptItem(
        transcriptItem("reasoning-active", SessionTranscriptItemKind.REASONING, {
          body: "Reasoning progress emitted by Codex.",
          displayBody: "",
          orderKey: "trace:000000000002:reasoning-active",
          status: "streaming",
          title: "Thinking",
        })
      )
    ).toBe(true)

    expect(
      isDisplayableTranscriptItem(
        transcriptItem("reasoning-real", SessionTranscriptItemKind.REASONING, {
          body: "Inspecting the route tree.",
          displayBody: "",
          orderKey: "trace:000000000003:reasoning-real",
        })
      )
    ).toBe(true)
  })

  test("keeps a terminal completed thought item visible", async () => {
    ensureBrowserOrigin()
    const { buildTimelineItems } = await import(
      "../ui/src/components/app/sessions/transcript/timeline-model.ts"
    )
    const items: ActivityItem[] = [
      transcriptActivityItem(
        "reasoning-tail",
        SessionTranscriptItemKind.REASONING,
        {
          body: "Inspected the current mobile route state.",
          orderKey: "000000000001:000000000000:reasoning-tail",
          status: "completed",
        }
      ),
    ]

    const timeline = buildTimelineItems(items)

    expect(timeline.map((item) => item.kind)).toEqual(["transcript"])
    expect(timeline[0]?.key).toBe("reasoning-tail")
  })

  test("groups consecutive completed commands before an active command", async () => {
    ensureBrowserOrigin()
    const { buildTimelineItems } = await import(
      "../ui/src/components/app/sessions/transcript/timeline-model.ts"
    )
    const items: ActivityItem[] = [
      transcriptActivityItem(
        "cmd-1",
        SessionTranscriptItemKind.COMMAND_EXECUTION,
        {
          body: "git status\n\nstatus: completed\n\noutput:\nclean",
          orderKey: "000000000001:000000000001:cmd-1",
          status: "completed",
        }
      ),
      transcriptActivityItem(
        "cmd-2",
        SessionTranscriptItemKind.COMMAND_EXECUTION,
        {
          body: "pnpm --dir ui typecheck\n\nstatus: completed\n\noutput:\npassed",
          orderKey: "000000000001:000000000002:cmd-2",
          status: "completed",
        }
      ),
      transcriptActivityItem(
        "cmd-running",
        SessionTranscriptItemKind.COMMAND_EXECUTION,
        {
          body: "pnpm --dir ui build\n\nstatus: inProgress\n\noutput:\nbuilding",
          orderKey: "000000000001:000000000003:cmd-running",
          status: "inProgress",
        }
      ),
    ]

    const timeline = buildTimelineItems(items)

    expect(timeline.map((item) => item.kind)).toEqual([
      "command-group",
      "transcript",
    ])
    expect(timeline[0]?.kind).toBe("command-group")
    if (timeline[0]?.kind !== "command-group") {
      throw new Error("expected command group")
    }
    expect(timeline[0].items.map((item) => item.id)).toEqual(["cmd-1", "cmd-2"])
    expect(timeline[1]?.key).toBe("cmd-running")
  })

  test("preserves active live transcript items across same-snapshot poll refreshes", () => {
    const current: SessionTranscriptPage = {
      hasMoreBefore: false,
      items: [
        transcriptItem("agent-1", SessionTranscriptItemKind.AGENT_MESSAGE, {
          body: "stable answer",
          displayBody: "stable answer",
          orderKey: "000000000001:000000000001:agent-1",
          status: "completed",
        }),
        transcriptItem("reasoning-live", SessionTranscriptItemKind.REASONING, {
          body: "Reasoning progress emitted by Codex.",
          displayBody: "",
          orderKey: "live:00000000000000000002:reasoning-live",
          status: "streaming",
          title: "Thinking",
        }),
      ],
      nextBeforeCursor: "",
      snapshotUpdatedAt: "2026-04-23T08:00:00Z",
    }
    const next: SessionTranscriptPage = {
      hasMoreBefore: false,
      items: [
        transcriptItem("agent-1", SessionTranscriptItemKind.AGENT_MESSAGE, {
          body: "stable answer",
          displayBody: "stable answer",
          orderKey: "000000000001:000000000001:agent-1",
          status: "completed",
        }),
      ],
      nextBeforeCursor: "",
      snapshotUpdatedAt: "2026-04-23T08:00:00Z",
    }

    const merged = mergeLatestTranscriptPage(current, next)

    expect(merged.items.map((item) => item.id)).toEqual([
      "agent-1",
      "reasoning-live",
    ])
  })

  test("does not preserve completed placeholder reasoning items across poll refreshes", () => {
    expect(
      shouldPreserveLiveTranscriptItem(
        transcriptItem("reasoning-done", SessionTranscriptItemKind.REASONING, {
          body: "Reasoning progress emitted by Codex.",
          displayBody: "",
          orderKey: "trace:00000000000000000002:reasoning-done",
          status: "completed",
          title: "Thinking",
        })
      )
    ).toBe(false)
  })
})

function ensureBrowserOrigin() {
  if ("window" in globalThis) {
    return
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://127.0.0.1:8787",
      },
    },
  })
}

function transcriptActivityItem(
  id: string,
  kind: SessionTranscriptItemKind,
  options: {
    body: string
    orderKey: string
    status?: string
  }
): ActivityItem {
  return {
    item: transcriptItem(id, kind, {
      body: options.body,
      displayBody: options.body,
      orderKey: options.orderKey,
      status: options.status,
    }),
    kind: "transcript",
    key: id,
  } as ActivityItem
}

function transcriptItem(
  id: string,
  kind: SessionTranscriptItemKind,
  options: {
    body: string
    displayBody: string
    orderKey: string
    status?: string
    title?: string
  }
) {
  return {
    attachments: [],
    body: options.body,
    displayBody: options.displayBody,
    id,
    kind,
    orderKey: options.orderKey,
    status: options.status ?? "",
    title:
      options.title ??
      (kind === SessionTranscriptItemKind.USER_MESSAGE ? "You" : "Codex"),
  }
}
