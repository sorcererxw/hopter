import type { Database } from "bun:sqlite";
import type { SessionRef } from "../../shared/domain/session.ts";

type SessionRow = {
  id: string;
  project_id: string;
  backend: string;
  backend_session_id: string | null;
  title: string | null;
  status: string;
  last_summary: string | null;
  attention_reason: string | null;
  degraded: number;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapSession(row: SessionRow): SessionRef {
  return {
    id: row.id,
    projectId: row.project_id,
    backend: row.backend,
    backendSessionId: row.backend_session_id,
    title: row.title,
    status: row.status,
    lastSummary: row.last_summary,
    attentionReason: row.attention_reason,
    degraded: row.degraded === 1,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SessionRepository {
  constructor(private readonly db: Database) {}

  listAll(): SessionRef[] {
    const rows = this.db
      .query("SELECT * FROM sessions ORDER BY created_at DESC")
      .all() as SessionRow[];

    return rows.map(mapSession);
  }

  listByProjectId(projectId: string): SessionRef[] {
    const rows = this.db
      .query("SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as SessionRow[];

    return rows.map(mapSession);
  }

  getById(id: string): SessionRef | null {
    const row = this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
    return row ? mapSession(row) : null;
  }

  create(session: SessionRef): SessionRef {
    this.db
      .query(`
        INSERT INTO sessions (
          id,
          project_id,
          backend,
          backend_session_id,
          title,
          status,
          last_summary,
          attention_reason,
          degraded,
          last_event_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        session.id,
        session.projectId,
        session.backend,
        session.backendSessionId,
        session.title,
        session.status,
        session.lastSummary,
        session.attentionReason,
        session.degraded ? 1 : 0,
        session.lastEventAt,
        session.createdAt,
        session.updatedAt,
      );

    return session;
  }

  update(session: SessionRef): SessionRef {
    this.db
      .query(`
        UPDATE sessions
        SET
          backend = ?,
          backend_session_id = ?,
          title = ?,
          status = ?,
          last_summary = ?,
          attention_reason = ?,
          degraded = ?,
          last_event_at = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        session.backend,
        session.backendSessionId,
        session.title,
        session.status,
        session.lastSummary,
        session.attentionReason,
        session.degraded ? 1 : 0,
        session.lastEventAt,
        session.updatedAt,
        session.id,
      );

    return session;
  }
}
