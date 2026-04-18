import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { ApprovalDecision } from "@/gen/proto/orchd/v1/common_pb"
import type {
  SessionTranscriptPage,
} from "@/gen/proto/orchd/v1/session_pb"
import { sessionClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

type CreateSessionInput = {
  backendKey?: string
  projectId: string
  prompt: string
  title?: string
}

type SendSessionInput = {
  sessionId: string
  input: string
}

type RespondToApprovalInput = {
  sessionId: string
  approvalId: string
  decision: ApprovalDecision
}

const defaultTranscriptPageSize = 50

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
    queryKey: queryKeys.sessionTranscriptLatest(sessionId ?? "pending", pageSize),
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
      projectId,
      prompt,
      title,
    }: CreateSessionInput) => {
      const response = await sessionClient.createSession({
        backendKey,
        projectId,
        prompt,
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
    mutationFn: async ({ sessionId, input }: SendSessionInput) => {
      return sessionClient.sendSessionInput({ sessionId, input })
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
