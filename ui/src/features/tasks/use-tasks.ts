import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { taskClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

type CreateTaskInput = {
  projectId: string
  prompt: string
  title?: string
}

// Task hooks mirror the current v1 surface: a flat list plus task creation.
export function useTasks(projectId?: string) {
  return useQuery({
    queryKey: queryKeys.tasks(projectId),
    queryFn: async () => {
      const response = await taskClient.listTasks({
        projectId,
        limit: 100,
      })
      return response.tasks
    },
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ projectId, prompt, title }: CreateTaskInput) => {
      const response = await taskClient.createTask({
        projectId,
        prompt,
        title,
      })
      return response.task
    },
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks() })
      if (task?.id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id) })
      }
    },
  })
}
