import { useQuery } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export function useHostSkill(path?: string) {
  const skillPath = path ?? ""

  return useQuery({
    enabled: skillPath.trim().length > 0,
    queryKey: queryKeys.hostSkill(skillPath),
    queryFn: async () => {
      const response = await hostClient.getSkill({ path: skillPath })
      return response.skill
    },
    staleTime: 5 * 60 * 1000,
  })
}
