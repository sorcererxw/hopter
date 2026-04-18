import { useQuery } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export function useMCPServers() {
  return useQuery({
    queryKey: queryKeys.hostMCPServers(),
    queryFn: async () => {
      const response = await hostClient.listMCPServers({})
      return response.servers
    },
    staleTime: 5 * 60 * 1000,
  })
}
