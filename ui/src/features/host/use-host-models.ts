import { useQuery } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export function useCodexModels() {
  return useQuery({
    queryKey: queryKeys.hostModels("codex"),
    queryFn: async () => {
      const response = await hostClient.listModels({
        backendKey: "codex",
      })
      return response.models
    },
    staleTime: 5 * 60_000,
  })
}
