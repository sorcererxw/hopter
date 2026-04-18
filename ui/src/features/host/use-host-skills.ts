import { useQuery } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export function useHostSkills() {
  return useQuery({
    queryKey: queryKeys.hostSkills(),
    queryFn: async () => {
      const response = await hostClient.listSkills({})
      return response.skills
    },
    staleTime: 5 * 60 * 1000,
  })
}
