import { useQuery } from "@tanstack/react-query"

import { hostClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

// Host browser queries back the project picker and other local-filesystem UI.
// They intentionally stay read-only: project creation happens elsewhere.
export function useDirectoryRoots() {
  return useQuery({
    queryKey: queryKeys.hostRoots(),
    queryFn: async () => {
      const response = await hostClient.listDirectoryRoots({})
      return response.roots
    },
  })
}

export function useDirectoryListing(path: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.hostDirectory(path),
    enabled: enabled && path.trim().length > 0,
    queryFn: async () => {
      const response = await hostClient.listDirectory({ path })
      return response.listing
    },
  })
}

export function usePathMetadata(path: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.hostPathMetadata(path),
    enabled: enabled && path.trim().length > 0,
    queryFn: async () => {
      const response = await hostClient.getPathMetadata({ path })
      return response.metadata
    },
  })
}

export function useRecentRepos(limit = 6) {
  return useQuery({
    queryKey: queryKeys.hostRecentRepos(limit),
    queryFn: async () => {
      const response = await hostClient.listRecentRepos({ limit })
      return response.repos
    },
  })
}
