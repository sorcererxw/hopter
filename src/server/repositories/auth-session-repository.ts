export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export class AuthSessionRepository {
  private readonly sessions = new Map<string, AuthSession>();

  create(session: AuthSession): AuthSession {
    this.sessions.set(session.id, session);
    return session;
  }

  getByTokenHash(tokenHash: string): AuthSession | null {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        return session;
      }
    }

    return null;
  }

  deleteById(id: string): void {
    this.sessions.delete(id);
  }

  deleteExpired(nowIso: string): void {
    for (const session of this.sessions.values()) {
      if (session.expiresAt < nowIso) {
        this.sessions.delete(session.id);
      }
    }
  }
}
