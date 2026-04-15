export const queryKeys = {
  host: () => ["host"] as const,
  hostRoots: () => ["host", "roots"] as const,
  hostDirectory: (path: string) => ["host", "directory", path] as const,
  hostPathMetadata: (path: string) => ["host", "path-metadata", path] as const,
  hostRecentRepos: (limit: number) => ["host", "recent-repos", limit] as const,
  projects: () => ["projects"] as const,
  sessions: (projectId?: string) => ["sessions", { projectId: projectId ?? null }] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
} as const
