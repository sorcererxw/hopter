export type TerminalSession = {
  id: string;
  projectId: string;
  cwd: string;
  shell: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
};

export class TerminalSessionRepository {
  private readonly sessions = new Map<string, TerminalSession>();

  create(session: TerminalSession): TerminalSession {
    this.sessions.set(session.id, session);
    return session;
  }

  listByProjectId(projectId: string): TerminalSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
