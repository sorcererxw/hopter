import { useQuery } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export function useHostStatus() {
  return useQuery({
    queryKey: queryKeys.host(),
    queryFn: async () => {
      const response = await hostClient.getHostStatus({})
      return response.hostStatus
    },
  })
}
