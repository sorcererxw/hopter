import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectBinding, ProjectBindingHealth } from "../../shared/domain/project.ts";
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

export class BindingService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly eventHub?: EventHub,
  ) {}

  list(): ProjectBinding[] {
    return this.repository.list();
  }

  get(projectId: string): ProjectBinding {
    const project = this.repository.getById(projectId);
    if (!project) {
      throw new AppError("BINDING_NOT_FOUND", 404, "Binding does not exist");
    }

    return project;
  }

  create(input: CreateProjectInput): ProjectBinding {
    const name = input.name.trim();
    if (!name) {
      throw new AppError("BINDING_NAME_REQUIRED", 400, "Binding name is required");
    }

    if (input.defaultBackend !== "codex") {
      throw new AppError("BINDING_BACKEND_UNSUPPORTED", 400, "Only the codex backend is supported in v1");
    }

    const repoPath = normalizeRepoPath(input.repoPath);

    if (!existsSync(repoPath)) {
      throw new AppError("BINDING_PATH_NOT_FOUND", 400, "Binding path does not exist");
    }

    if (!statSync(repoPath).isDirectory()) {
      throw new AppError("BINDING_PATH_NOT_DIRECTORY", 400, "Binding path must be a directory");
    }

    if (!hasGitMetadata(repoPath)) {
      throw new AppError("BINDING_PATH_NOT_REPO", 400, "Binding path must point at a git repository");
    }

    if (input.allowlist && !insideAllowlist(repoPath, input.allowlist)) {
      throw new AppError("BINDING_PATH_NOT_ALLOWED", 403, "Binding path is outside the configured allowlist");
    }

    if (this.repository.getByRepoPath(repoPath)) {
      throw new AppError("BINDING_PATH_DUPLICATE", 409, "A binding already exists for this repo path");
    }

    const now = new Date().toISOString();
    const project: ProjectBinding = {
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

  update(projectId: string, input: UpdateProjectInput): ProjectBinding {
    const current = this.get(projectId);
    if (input.defaultBackend && input.defaultBackend !== "codex") {
      throw new AppError("BINDING_BACKEND_UNSUPPORTED", 400, "Only the codex backend is supported in v1");
    }
    const next = this.repository.update(projectId, {
      name: input.name?.trim() || current.name,
      defaultBackend: input.defaultBackend || current.defaultBackend,
      updatedAt: new Date().toISOString(),
    });

    if (!next) {
      throw new AppError("BINDING_NOT_FOUND", 404, "Binding does not exist");
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

  health(project: ProjectBinding, codex: CodexDetection): ProjectBindingHealth {
    const repoExists = existsSync(project.repoPath);
    const backendAvailable = project.defaultBackend === "codex" ? codex.compatible : false;

    return {
      status: repoExists && backendAvailable ? "healthy" : repoExists || backendAvailable ? "degraded" : "unhealthy",
      repoExists,
      backendAvailable,
    };
  }
}
