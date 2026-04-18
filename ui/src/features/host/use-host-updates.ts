import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export function useHostUpdates(refetchInterval: number | false = 30_000) {
  return useQuery({
    queryKey: queryKeys.hostUpdates(),
    queryFn: async () => {
      const response = await hostClient.checkForUpdate({ force: false })
      return response.updateStatus
    },
    refetchInterval,
  })
}

export function useApplyUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await hostClient.applyUpdate({})
      return response.updateStatus
    },
    onSuccess: async (status) => {
      queryClient.setQueryData(queryKeys.hostUpdates(), status)
      await queryClient.invalidateQueries({ queryKey: queryKeys.hostUpdates() })
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.hostUpdates() })
    },
  })
}
