import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { SessionStatus } from "@/gen/proto/orchd/v1/common_pb"
import type {
  SessionMeta,
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

const defaultTranscriptPageSize = 50
const activeSessionPollMs = 1500
const passiveSessionPollMs = 5000
const sessionListPollMs = 3000

export function useSessions(
  projectId?: string,
  pollInterval: number | false = sessionListPollMs
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
    refetchInterval: (query) => {
      const session = query.state.data as SessionMeta | undefined
      if (!session) {
        return false
      }

      return shouldPollSession(session)
        ? activeSessionPollMs
        : passiveSessionPollMs
    },
    refetchIntervalInBackground: true,
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

function shouldPollSession(
  session: Pick<SessionMeta, "status">
) {
  switch (session.status) {
    case SessionStatus.PENDING:
    case SessionStatus.RUNNING:
    case SessionStatus.WAITING_APPROVAL:
      return true
    default:
      return false
  }
}
