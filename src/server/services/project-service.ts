import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Project, ProjectHealth } from "../../shared/domain/project.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";
import type { CodexDetection } from "./codex-detection-service.ts";
import { AppError } from "./errors.ts";
import type { EventHub } from "../ws/event-hub.ts";

type CreateProjectInput = {
  name: string;
  repoPath: string;
  defaultBackend: string;
  hostId: string;
  allowlist: string[] | null;
};

type UpdateProjectInput = {
  name?: string;
  defaultBackend?: string;
};

function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath.trim());
}

function hasGitMetadata(repoPath: string): boolean {
  return existsSync(path.join(repoPath, ".git"));
}

function insideAllowlist(repoPath: string, allowlist: string[]): boolean {
  return allowlist.some((allowedPath) => {
    const relative = path.relative(allowedPath, repoPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly eventHub?: EventHub,
  ) {}

  list(): Project[] {
    return this.repository.list();
  }

  get(projectId: string): Project {
    const project = this.repository.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", 404, "Project does not exist");
    }

    return project;
  }

  create(input: CreateProjectInput): Project {
    const name = input.name.trim();
    if (!name) {
      throw new AppError("PROJECT_NAME_REQUIRED", 400, "Project name is required");
    }

    if (input.defaultBackend !== "codex") {
      throw new AppError("PROJECT_BACKEND_UNSUPPORTED", 400, "Only the codex backend is supported in v1");
    }

    const repoPath = normalizeRepoPath(input.repoPath);

    if (!existsSync(repoPath)) {
      throw new AppError("PROJECT_PATH_NOT_FOUND", 400, "Project path does not exist");
    }

    if (!statSync(repoPath).isDirectory()) {
      throw new AppError("PROJECT_PATH_NOT_DIRECTORY", 400, "Project path must be a directory");
    }

    if (!hasGitMetadata(repoPath)) {
      throw new AppError("PROJECT_PATH_NOT_REPO", 400, "Project path must point at a git repository");
    }

    if (input.allowlist && !insideAllowlist(repoPath, input.allowlist)) {
      throw new AppError("PROJECT_PATH_NOT_ALLOWED", 403, "Project path is outside the configured allowlist");
    }

    if (this.repository.getByRepoPath(repoPath)) {
      throw new AppError("PROJECT_PATH_DUPLICATE", 409, "A project already exists for this repo path");
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      repoPath,
      hostId: input.hostId,
      defaultBackend: input.defaultBackend,
      createdAt: now,
      updatedAt: now,
    };

    const created = this.repository.create(project);
    this.eventHub?.emit({
      scope: "project",
      scopeId: created.id,
      type: "project.created",
      payload: {
        projectId: created.id,
        name: created.name,
      },
    });
    this.eventHub?.emit({
      scope: "dashboard",
      scopeId: null,
      type: "project.created",
      payload: {
        projectId: created.id,
      },
    });
    return created;
  }

  update(projectId: string, input: UpdateProjectInput): Project {
    const current = this.get(projectId);
    if (input.defaultBackend && input.defaultBackend !== "codex") {
      throw new AppError("PROJECT_BACKEND_UNSUPPORTED", 400, "Only the codex backend is supported in v1");
    }
    const next = this.repository.update(projectId, {
      name: input.name?.trim() || current.name,
      defaultBackend: input.defaultBackend || current.defaultBackend,
      updatedAt: new Date().toISOString(),
    });

    if (!next) {
      throw new AppError("PROJECT_NOT_FOUND", 404, "Project does not exist");
    }

    this.eventHub?.emit({
      scope: "project",
      scopeId: next.id,
      type: "project.updated",
      payload: {
        projectId: next.id,
        name: next.name,
      },
    });
    return next;
  }

  health(project: Project, codex: CodexDetection): ProjectHealth {
    const repoExists = existsSync(project.repoPath);
    const backendAvailable = project.defaultBackend === "codex" ? codex.compatible : false;

    return {
      status: repoExists && backendAvailable ? "healthy" : repoExists || backendAvailable ? "degraded" : "unhealthy",
      repoExists,
      backendAvailable,
    };
  }
}
