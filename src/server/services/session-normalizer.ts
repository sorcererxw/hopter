import type { ArtifactRef } from "../../shared/domain/artifact.ts";

export type SessionAttention = {
  reason: "approval_required" | "input_required";
  headline: string;
  requestMethod: string;
  requestId?: string | number;
  note?: string | null;
};

export type SessionPatch = {
  status?: string;
  lastSummary?: string | null;
  attention?: SessionAttention | null;
  degraded?: boolean;
  lastEventAt?: string;
  activeTurnId?: string | null;
  artifactText?: {
    kind: string;
    label: string;
    content: string;
  } | null;
};

type ThreadItem =
  | { type: "agentMessage"; text: string; phase: string | null }
  | { type: "plan"; text: string }
  | { type: "commandExecution"; command: string; aggregatedOutput: string | null; exitCode: number | null }
  | { type: string };

function nowIso(): string {
  return new Date().toISOString();
}

export function summarizeText(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (compact === "") {
    return "";
  }

  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

export function normalizeServerRequest(method: string, requestId?: string | number): SessionPatch {
  switch (method) {
    case "item/tool/requestUserInput":
      return {
        status: "waiting_input",
        attention: {
          reason: "input_required",
          headline: "Codex needs additional input to continue",
          requestMethod: method,
          requestId,
        },
        lastEventAt: nowIso(),
      };
    default:
      return {
        status: "waiting_approval",
        attention: {
          reason: "approval_required",
          headline: "Codex needs approval to continue",
          requestMethod: method,
          requestId,
        },
        lastEventAt: nowIso(),
      };
  }
}

export function normalizeNotification(method: string, params: unknown): SessionPatch {
  const lastEventAt = nowIso();

  switch (method) {
    case "thread/status/changed": {
      const status = (params as { status?: { type?: string; activeFlags?: string[] } }).status;
      const statusType = status?.type;
      const flags = status?.activeFlags ?? [];
      if (flags.includes("waitingOnApproval")) {
        return {
          status: "waiting_approval",
          lastEventAt,
        };
      }
      return {
        status: statusType === "active" ? "running" : statusType === "idle" ? "completed" : "degraded",
        lastEventAt,
      };
    }
    case "turn/started": {
      const turnId = (params as { turn?: { id?: string } }).turn?.id ?? null;
      return {
        status: "running",
        activeTurnId: turnId,
        attention: null,
        lastEventAt,
      };
    }
    case "turn/completed": {
      const turn = (params as { turn?: { status?: string; error?: unknown } }).turn;
      return {
        status: turn?.status === "failed" ? "failed" : "completed",
        activeTurnId: null,
        lastEventAt,
      };
    }
    case "error":
      return {
        status: "degraded",
        degraded: true,
        lastEventAt,
      };
    default:
      return {
        lastEventAt,
      };
  }
}

export function normalizeCompletedItem(item: ThreadItem): SessionPatch {
  if (item.type === "agentMessage") {
    const summary = summarizeText(item.text);
    return {
      lastSummary: summary || null,
      artifactText: summary
        ? {
            kind: item.phase === "final_answer" ? "final_message" : "agent_message",
            label: item.phase === "final_answer" ? "Final response" : "Agent response",
            content: item.text,
          }
        : null,
      lastEventAt: nowIso(),
    };
  }

  if (item.type === "plan") {
    return {
      lastSummary: summarizeText(item.text) || null,
      artifactText: item.text.trim()
        ? {
            kind: "plan",
            label: "Plan update",
            content: item.text,
          }
        : null,
      lastEventAt: nowIso(),
    };
  }

  if (item.type === "commandExecution" && item.aggregatedOutput) {
    return {
      artifactText: {
        kind: "command_output",
        label: `Command output: ${item.command}`,
        content: item.aggregatedOutput,
      },
      lastEventAt: nowIso(),
    };
  }

  return {
    lastEventAt: nowIso(),
  };
}

export function deriveSessionStateFromThread(thread: { turns: Array<{ items: ThreadItem[]; status: string }> }): SessionPatch {
  let summary: string | null = null;
  let artifactText: SessionPatch["artifactText"] = null;

  const turns = [...thread.turns].reverse();
  for (const turn of turns) {
    const items = [...turn.items].reverse();
    for (const item of items) {
      const patch = normalizeCompletedItem(item);
      if (!summary && patch.lastSummary) {
        summary = patch.lastSummary;
      }
      if (!artifactText && patch.artifactText) {
        artifactText = patch.artifactText;
      }
      if (summary && artifactText) {
        break;
      }
    }
    if (summary && artifactText) {
      break;
    }
  }

  const latestTurn = thread.turns.at(-1) ?? null;
  const status = latestTurn?.status === "failed" ? "failed" : latestTurn ? "completed" : "idle";

  return {
    status,
    lastSummary: summary,
    artifactText,
    activeTurnId: null,
    attention: null,
    lastEventAt: nowIso(),
  };
}
