import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ApprovalDecision } from "@/gen/proto/hopter/v1/common_pb"
import {
  SessionInputMode,
  type SessionTranscriptPage,
} from "@/gen/proto/hopter/v1/session_pb"
import { sessionClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

type CreateSessionInput = {
  attachments?: SessionInputAttachment[]
  backendKey?: string
  codexFastMode?: boolean
  model?: string
  projectId: string
  prompt: string
  reasoningEffort?: string
  title?: string
}

type SendSessionInput = {
  attachments?: SessionInputAttachment[]
  codexFastMode?: boolean
  input: string
  mode?: "guide" | "queue"
  model?: string
  reasoningEffort?: string
  sessionId: string
}

type RollbackSessionInput = SendSessionInput & {
  orderKey: string
  transcriptItemId: string
}

type SessionInputAttachment = {
  contentType?: string
  label: string
  url: string
}

type GetSessionFileInput = {
  sessionId: string
  path: string
  line?: number
  column?: number
}

type InterruptSessionInput = {
  sessionId: string
}

type RespondToApprovalInput = {
  sessionId: string
  approvalId: string
  decision: ApprovalDecision
}

const defaultTranscriptPageSize = 50

// Session queries are intentionally split by surface: list, meta, artifacts,
// transcript, and file/review lookups can all refresh on different cadences.
export function useSessions(
  projectId?: string,
  pollInterval: number | false = false
) {
  return useQuery({
    queryKey: queryKeys.sessions(projectId),
    queryFn: async () => {
      const response = await sessionClient.listSessions({
        projectId,
        limit: 50,
      })
      return response.sessions
    },
    refetchInterval: pollInterval,
    refetchIntervalInBackground: pollInterval !== false,
  })
}

export function useSessionMeta(sessionId?: string) {
  return useQuery({
    enabled: Boolean(sessionId),
    queryKey: queryKeys.sessionMeta(sessionId ?? "pending"),
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("sessionId is required")
      }

      const response = await sessionClient.getSessionMeta({ sessionId })
      return response.session
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })
}

export function useSessionQueue(sessionId?: string, enabled = true) {
  return useQuery({
    enabled: Boolean(sessionId) && enabled,
    queryKey: queryKeys.sessionQueue(sessionId ?? "pending"),
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("sessionId is required")
      }

      const response = await sessionClient.listSessionQueue({ sessionId })
      return response.items
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })
}

export function useSessionArtifacts(sessionId?: string, enabled = true) {
  return useQuery({
    enabled: Boolean(sessionId) && enabled,
    queryKey: queryKeys.sessionArtifacts(sessionId ?? "pending"),
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("sessionId is required")
      }

      const response = await sessionClient.listSessionArtifacts({ sessionId })
      return response.artifacts
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })
}

export function useSessionReview(sessionId?: string, enabled = true) {
  return useQuery({
    enabled: Boolean(sessionId) && enabled,
    queryKey: queryKeys.sessionReview(sessionId ?? "pending"),
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("sessionId is required")
      }

      const response = await sessionClient.getSessionReview({ sessionId })
      return response.review
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })
}

export function useSessionFile(input?: GetSessionFileInput, enabled = true) {
  const sessionId = input?.sessionId ?? ""
  const path = input?.path ?? ""
  const line = input?.line
  const column = input?.column

  return useQuery({
    enabled: Boolean(sessionId) && path.trim().length > 0 && enabled,
    queryKey: queryKeys.sessionFile(sessionId || "pending", path, line, column),
    queryFn: async () => {
      if (!sessionId || !path.trim()) {
        throw new Error("sessionId and path are required")
      }

      const response = await sessionClient.getSessionFile({
        sessionId,
        path,
        line,
        column,
      })
      return response.file
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })
}

export async function fetchSessionTranscriptPage(
  sessionId: string,
  beforeCursor?: string,
  pageSize = defaultTranscriptPageSize
) {
  const response = await sessionClient.listSessionTranscript({
    sessionId,
    beforeCursor: beforeCursor || undefined,
    limit: pageSize,
  })

  return normalizeSessionTranscriptPage(response.page)
}

export function useSessionTranscript(
  sessionId?: string,
  enabled = true,
  pageSize = defaultTranscriptPageSize,
  pollInterval: number | false = false
) {
  return useQuery({
    enabled: Boolean(sessionId) && enabled,
    queryKey: queryKeys.sessionTranscriptLatest(
      sessionId ?? "pending",
      pageSize
    ),
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("sessionId is required")
      }

      return fetchSessionTranscriptPage(sessionId, undefined, pageSize)
    },
    refetchInterval: pollInterval,
    refetchIntervalInBackground: pollInterval !== false,
  })
}

// Copy the generated transcript page into a plain object so React Query cache
// updates can safely replace or patch items without relying on generated class
// identity semantics.
function normalizeSessionTranscriptPage(
  page: SessionTranscriptPage | undefined
): SessionTranscriptPage | undefined {
  if (!page) {
    return undefined
  }

  return {
    items: page.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      status: item.status,
      displayBody: item.displayBody,
      attachments: item.attachments,
      commandActions: item.commandActions,
      orderKey: item.orderKey,
    })),
    nextBeforeCursor: page.nextBeforeCursor,
    hasMoreBefore: page.hasMoreBefore,
    snapshotUpdatedAt: page.snapshotUpdatedAt,
  } as SessionTranscriptPage
}

export function useCreateSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      backendKey,
      attachments,
      codexFastMode,
      model,
      projectId,
      prompt,
      reasoningEffort,
      title,
    }: CreateSessionInput) => {
      const response = await sessionClient.createSession({
        backendKey,
        attachments,
        codexFastMode,
        model,
        projectId,
        prompt,
        reasoningEffort,
        title,
      })
      return response.session
    },
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() })

      if (session?.id) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.sessionMeta(session.id),
        })
        await queryClient.invalidateQueries({
          queryKey: queryKeys.sessionTranscript(session.id),
        })
      }
    },
  })
}

export function useSendSessionInput() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      input,
      attachments,
      codexFastMode,
      model,
      mode,
      reasoningEffort,
      sessionId,
    }: SendSessionInput) => {
      return sessionClient.sendSessionInput({
        input,
        attachments,
        codexFastMode,
        mode:
          mode === "queue" ? SessionInputMode.QUEUE : SessionInputMode.GUIDE,
        model,
        reasoningEffort,
        sessionId,
      })
    },
    onSuccess: async (_response, variables) => {
      // Sending input changes both the session list metadata and the transcript,
      // so refresh both even if the server will also stream patches later.
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionMeta(variables.sessionId),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionTranscript(variables.sessionId),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionQueue(variables.sessionId),
      })
    },
  })
}

export function useRollbackSessionInput() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      input,
      attachments,
      codexFastMode,
      model,
      orderKey,
      reasoningEffort,
      sessionId,
      transcriptItemId,
    }: RollbackSessionInput) => {
      return sessionClient.rollbackSessionInput({
        input,
        attachments,
        codexFastMode,
        model,
        orderKey,
        reasoningEffort,
        sessionId,
        transcriptItemId,
      })
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionMeta(variables.sessionId),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionTranscript(variables.sessionId),
      })
    },
  })
}

export function useInterruptSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ sessionId }: InterruptSessionInput) => {
      return sessionClient.interruptSession({ sessionId })
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionMeta(variables.sessionId),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionTranscript(variables.sessionId),
      })
    },
  })
}

export function useRespondToSessionApproval() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sessionId,
      approvalId,
      decision,
    }: RespondToApprovalInput) => {
      return sessionClient.respondToSessionApproval({
        sessionId,
        approvalId,
        decision,
      })
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionMeta(variables.sessionId),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessionTranscript(variables.sessionId),
      })
    },
  })
}
