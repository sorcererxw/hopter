// Shared query key factory so hooks, SSE invalidation, and optimistic cache
// patches all speak the same cache-addressing language.
export const queryKeys = {
  authStatus: () => ["auth-status"] as const,
  config: () => ["config"] as const,
  host: () => ["host"] as const,
  hostUpdates: () => ["host", "updates"] as const,
  hostBackends: () => ["host", "backends"] as const,
  hostModels: (backendKey?: string) =>
    ["host", "models", { backendKey: backendKey ?? "codex" }] as const,
  hostSkills: () => ["host", "skills"] as const,
  hostMCPServers: () => ["host", "mcp-servers"] as const,
  hostRoots: () => ["host", "roots"] as const,
  hostDirectory: (path: string) => ["host", "directory", path] as const,
  hostPathMetadata: (path: string) => ["host", "path-metadata", path] as const,
  hostRecentRepos: (limit: number) => ["host", "recent-repos", limit] as const,
  projects: () => ["projects"] as const,
  projectGitStatus: (projectId: string) =>
    ["project-git-status", projectId] as const,
  tasks: (projectId?: string) =>
    ["tasks", { projectId: projectId ?? null }] as const,
  task: (taskId: string) => ["task", taskId] as const,
  sessions: (projectId?: string) =>
    ["sessions", { projectId: projectId ?? null }] as const,
  sessionMeta: (sessionId: string) => ["session-meta", sessionId] as const,
  sessionArtifacts: (sessionId: string) =>
    ["session-artifacts", sessionId] as const,
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
