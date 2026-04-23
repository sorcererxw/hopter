import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { GitCommitMode } from "@/gen/proto/hopter/v1/git_pb"
import { gitClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

type CommitProjectChangesInput = {
  expectedStatusToken: string
  message: string
  mode: GitCommitMode
  projectId: string
}

type PushProjectBranchInput = {
  expectedHeadSha: string
  expectedStatusToken: string
  projectId: string
}

// Git actions are protected by backend-issued tokens so the UI only retries or
// refreshes after the server has validated the current repo state.
export function useProjectGitStatus(projectId?: string, enabled = true) {
  return useQuery({
    enabled: Boolean(projectId) && enabled,
    queryKey: queryKeys.projectGitStatus(projectId ?? "pending"),
    queryFn: async () => {
      if (!projectId) {
        throw new Error("projectId is required")
      }
      const response = await gitClient.getProjectGitStatus({ projectId })
      return response.status
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })
}

export function useCommitProjectChanges() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      expectedStatusToken,
      message,
      mode,
      projectId,
    }: CommitProjectChangesInput) => {
      return gitClient.commitProjectChanges({
        expectedStatusToken,
        message,
        mode,
        projectId,
      })
    },
    onSuccess: async (_response, variables) => {
      await invalidateProjectGitQueries(queryClient, variables.projectId)
    },
  })
}

export function usePushProjectBranch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      expectedHeadSha,
      expectedStatusToken,
      projectId,
    }: PushProjectBranchInput) => {
      return gitClient.pushProjectBranch({
        expectedHeadSha,
        expectedStatusToken,
        projectId,
      })
    },
    onSuccess: async (_response, variables) => {
      await invalidateProjectGitQueries(queryClient, variables.projectId)
    },
  })
}

async function invalidateProjectGitQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string
) {
  // A successful commit/push can change project badges, session affordances,
  // and the detailed git panel, so invalidate all three surfaces together.
  await queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
  await queryClient.invalidateQueries({ queryKey: queryKeys.sessions() })
  await queryClient.invalidateQueries({
    queryKey: queryKeys.projectGitStatus(projectId),
  })
}
