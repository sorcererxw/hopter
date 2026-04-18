import { useQuery } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export function useBackends() {
  return useQuery({
    queryKey: queryKeys.hostBackends(),
    queryFn: async () => {
      const response = await hostClient.listBackends({})
      return response.backends
    },
    staleTime: 30_000,
  })
}
