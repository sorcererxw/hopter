import type { Database } from "bun:sqlite";
import type { Project } from "../../shared/domain/project.ts";

type ProjectRow = {
  id: string;
  name: string;
  repo_path: string;
  host_id: string;
  default_backend: string;
  created_at: string;
  updated_at: string;
};

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    hostId: row.host_id,
    defaultBackend: row.default_backend,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  list(): Project[] {
    const rows = this.db
      .query("SELECT * FROM projects ORDER BY created_at DESC")
      .all() as ProjectRow[];

    return rows.map(mapProject);
  }

  getById(id: string): Project | null {
    const row = this.db
      .query("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | null;

    return row ? mapProject(row) : null;
  }

  getByRepoPath(repoPath: string): Project | null {
    const row = this.db
      .query("SELECT * FROM projects WHERE repo_path = ?")
      .get(repoPath) as ProjectRow | null;

    return row ? mapProject(row) : null;
  }

  create(project: Project): Project {
    this.db
      .query(`
        INSERT INTO projects (
          id,
          name,
          repo_path,
          host_id,
          default_backend,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        project.id,
        project.name,
        project.repoPath,
        project.hostId,
        project.defaultBackend,
        project.createdAt,
        project.updatedAt,
      );

    return project;
  }

  update(id: string, fields: Partial<Pick<Project, "name" | "defaultBackend" | "updatedAt">>): Project | null {
    const current = this.getById(id);
    if (!current) {
      return null;
    }

    const next: Project = {
      ...current,
      ...fields,
      updatedAt: fields.updatedAt ?? current.updatedAt,
    };

    this.db
      .query(`
        UPDATE projects
        SET name = ?, default_backend = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(next.name, next.defaultBackend, next.updatedAt, id);

    return next;
  }
}
