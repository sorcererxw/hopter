import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { SessionStatus } from "@/gen/proto/orchd/v1/common_pb"
import type { Session } from "@/gen/proto/orchd/v1/session_pb"
import { sessionClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

type CreateSessionInput = {
  projectId: string
  prompt: string
  title?: string
}

type SendSessionInput = {
  sessionId: string
  input: string
}

export function useSessions(projectId?: string) {
  return useQuery({
    queryKey: queryKeys.sessions(projectId),
    queryFn: async () => {
      const response = await sessionClient.listSessions({
        projectId,
        limit: 50,
      })
      return response.sessions
    },
  })
}

export function useSession(sessionId?: string) {
  return useQuery({
    enabled: Boolean(sessionId),
    queryKey: queryKeys.session(sessionId ?? "pending"),
    queryFn: async () => {
      if (!sessionId) {
        throw new Error("sessionId is required")
      }

      const response = await sessionClient.getSession({ sessionId })
      return response.session
    },
    refetchInterval: (query) => {
      const session = query.state.data as Session | undefined
      if (!session) {
        return false
      }

      return shouldPollSession(session) ? 1500 : false
    },
    refetchIntervalInBackground: true,
  })
}

export function useCreateSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ projectId, prompt, title }: CreateSessionInput) => {
      const response = await sessionClient.createSession({
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
          queryKey: queryKeys.session(session.id),
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
        queryKey: queryKeys.session(variables.sessionId),
      })
    },
  })
}

function shouldPollSession(session: Session) {
  switch (session.status) {
    case SessionStatus.PENDING:
    case SessionStatus.RUNNING:
    case SessionStatus.WAITING_APPROVAL:
      return true
    default:
      return false
  }
}
