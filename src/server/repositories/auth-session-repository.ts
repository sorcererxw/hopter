import type { Database } from "bun:sqlite";

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

type AuthSessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
};

function mapRow(row: AuthSessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export class AuthSessionRepository {
  constructor(private readonly db: Database) {}

  create(session: AuthSession): AuthSession {
    this.db
      .query(`
        INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt);

    return session;
  }

  getByTokenHash(tokenHash: string): AuthSession | null {
    const row = this.db
      .query("SELECT * FROM auth_sessions WHERE token_hash = ?")
      .get(tokenHash) as AuthSessionRow | null;

    return row ? mapRow(row) : null;
  }

  deleteById(id: string): void {
    this.db.query("DELETE FROM auth_sessions WHERE id = ?").run(id);
  }

  deleteExpired(nowIso: string): void {
    this.db.query("DELETE FROM auth_sessions WHERE expires_at < ?").run(nowIso);
  }
}
