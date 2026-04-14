import type { Database } from "bun:sqlite";

export type TerminalSession = {
  id: string;
  projectId: string;
  cwd: string;
  shell: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
};

type TerminalSessionRow = {
  id: string;
  project_id: string;
  cwd: string;
  shell: string;
  status: string;
  created_at: string;
  closed_at: string | null;
};

function mapRow(row: TerminalSessionRow): TerminalSession {
  return {
    id: row.id,
    projectId: row.project_id,
    cwd: row.cwd,
    shell: row.shell,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

export class TerminalSessionRepository {
  constructor(private readonly db: Database) {}

  create(session: TerminalSession): TerminalSession {
    this.db
      .query(`
        INSERT INTO terminal_sessions (id, project_id, cwd, shell, status, created_at, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        session.id,
        session.projectId,
        session.cwd,
        session.shell,
        session.status,
        session.createdAt,
        session.closedAt,
      );

    return session;
  }

  listByProjectId(projectId: string): TerminalSession[] {
    const rows = this.db
      .query("SELECT * FROM terminal_sessions WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as TerminalSessionRow[];

    return rows.map(mapRow);
  }
}
