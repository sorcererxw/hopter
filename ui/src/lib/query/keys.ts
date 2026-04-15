export const queryKeys = {
  host: () => ["host"] as const,
  projects: () => ["projects"] as const,
  sessions: (projectId?: string) => ["sessions", { projectId: projectId ?? null }] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
} as const
