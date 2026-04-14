import type { BackendSessionHandle } from "../../shared/domain/session.ts";

export class SessionRepository {
  private readonly sessions = new Map<string, BackendSessionHandle>();

  listAll(): BackendSessionHandle[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listByProjectId(projectId: string): BackendSessionHandle[] {
    return this.listAll().filter((session) => session.projectId === projectId);
  }

  getById(id: string): BackendSessionHandle | null {
    return this.sessions.get(id) ?? null;
  }

  create(session: BackendSessionHandle): BackendSessionHandle {
    this.sessions.set(session.id, session);
    return session;
  }

  update(session: BackendSessionHandle): BackendSessionHandle {
    this.sessions.set(session.id, session);
    return session;
  }
}
