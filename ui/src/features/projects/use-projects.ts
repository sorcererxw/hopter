import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { projectClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

type CreateProjectInput = {
  name: string
  rootPath: string
  defaultBackend: string
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: async () => {
      const response = await projectClient.listProjects({})
      return response.projects
    },
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, rootPath, defaultBackend }: CreateProjectInput) => {
      const response = await projectClient.createProject({
        name,
        rootPath,
        defaultBackend,
      })
      return response.project
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })
}
