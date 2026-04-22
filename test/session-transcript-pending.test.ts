import { describe, expect, test } from "bun:test"

import { SessionTranscriptItemKind } from "../ui/src/gen/proto/hopter/v1/session_pb.ts"
import {
  insertPendingInputActivityItem,
  isDisplayableTranscriptItem,
  transcriptTextMatchesPendingHint,
  type ActivityItem,
} from "../ui/src/components/app/session-transcript-activity.ts"

describe("session transcript pending hint reconciliation", () => {
  test("matches ellipsis-truncated hints against the full user transcript text", () => {
    const prompt =
      "请用中文说明 codeshell/hopter 项目当前现状：产品定位、Go-first 架构方向、当前可用能力、最近已知验证证据、下一步主要风险。请基于当前 codeshell 项目上下文回答，先不要改代码。"
    const truncatedHint =
      "请用中文说明 codeshell/hopter 项目当前现状：产品定位、Go-first 架构方向、当前可用能力、…"

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

  test("hides placeholder-only reasoning transcript items", () => {
    expect(
      isDisplayableTranscriptItem(
        transcriptItem("reasoning-empty", SessionTranscriptItemKind.REASONING, {
          body: "Reasoning progress emitted by Codex.",
          displayBody: "",
          orderKey: "trace:000000000001:reasoning-empty",
        })
      )
    ).toBe(false)

    expect(
      isDisplayableTranscriptItem(
        transcriptItem("reasoning-real", SessionTranscriptItemKind.REASONING, {
          body: "Inspecting the route tree.",
          displayBody: "",
          orderKey: "trace:000000000002:reasoning-real",
        })
      )
    ).toBe(true)
  })
})

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
    title: kind === SessionTranscriptItemKind.USER_MESSAGE ? "You" : "Codex",
  }
}
