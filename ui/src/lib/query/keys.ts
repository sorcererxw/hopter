export const queryKeys = {
  authStatus: () => ["auth-status"] as const,
  host: () => ["host"] as const,
  hostUpdates: () => ["host", "updates"] as const,
  hostBackends: () => ["host", "backends"] as const,
  hostSkills: () => ["host", "skills"] as const,
  hostMCPServers: () => ["host", "mcp-servers"] as const,
  hostRoots: () => ["host", "roots"] as const,
  hostDirectory: (path: string) => ["host", "directory", path] as const,
  hostPathMetadata: (path: string) => ["host", "path-metadata", path] as const,
  hostRecentRepos: (limit: number) => ["host", "recent-repos", limit] as const,
  projects: () => ["projects"] as const,
  sessions: (projectId?: string) =>
    ["sessions", { projectId: projectId ?? null }] as const,
  sessionMeta: (sessionId: string) => ["session-meta", sessionId] as const,
  sessionReview: (sessionId: string) => ["session-review", sessionId] as const,
  sessionFile: (
    sessionId: string,
    path: string,
    line?: number,
    column?: number
  ) =>
    [
      "session-file",
      sessionId,
      { path, line: line ?? null, column: column ?? null },
    ] as const,
  sessionTranscript: (sessionId: string) =>
    ["session-transcript", sessionId] as const,
  sessionTranscriptLatest: (sessionId: string, pageSize?: number) =>
    ["session-transcript", sessionId, { pageSize: pageSize ?? null }] as const,
  terminalSession: (
    sessionId: string,
    browserInstanceId: string,
    tabId: string
  ) => ["terminal-session", sessionId, browserInstanceId, tabId] as const,
} as const
