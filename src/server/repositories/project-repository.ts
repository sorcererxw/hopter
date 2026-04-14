import type { ProjectBinding } from "../../shared/domain/project.ts";

export class ProjectRepository {
  private readonly projects = new Map<string, ProjectBinding>();

  list(): ProjectBinding[] {
    return [...this.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getById(id: string): ProjectBinding | null {
    return this.projects.get(id) ?? null;
  }

  getByRepoPath(repoPath: string): ProjectBinding | null {
    for (const project of this.projects.values()) {
      if (project.repoPath === repoPath) {
        return project;
      }
    }

    return null;
  }

  create(project: ProjectBinding): ProjectBinding {
    this.projects.set(project.id, project);
    return project;
  }

  update(
    id: string,
    fields: Partial<Pick<ProjectBinding, "name" | "defaultBackend" | "updatedAt">>,
  ): ProjectBinding | null {
    const current = this.getById(id);
    if (!current) {
      return null;
    }

    const next: ProjectBinding = {
      ...current,
      ...fields,
      updatedAt: fields.updatedAt ?? current.updatedAt,
    };

    this.projects.set(id, next);
    return next;
  }
}
