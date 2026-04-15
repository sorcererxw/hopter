import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { AppConfig } from "../config/types.ts";
import { AppError } from "./errors.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";

export type HostDirectoryEntry = {
  name: string;
  path: string;
  isRepo: boolean;
  hasChildren: boolean;
};

export type HostDirectoryList = {
  currentPath: string;
  parentPath: string | null;
  roots: string[];
  entries: HostDirectoryEntry[];
};

export class HostFilesystemService {
  constructor(
    private readonly config: AppConfig,
    private readonly projectRepository: ProjectRepository,
  ) {}

  private unique(items: string[]) {
    return [...new Set(items)];
  }

  private existingCanonicalDirectories(items: string[]) {
    return this.unique(
      items
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => existsSync(item))
        .map((item) => realpathSync(item))
        .filter((item) => {
          try {
            return statSync(item).isDirectory();
          } catch {
            return false;
          }
        }),
    );
  }

  roots(): string[] {
    const configured = this.config.projects.allowlist;
    if (configured && configured.length > 0) {
      return this.existingCanonicalDirectories(configured);
    }

    return this.existingCanonicalDirectories([homedir(), process.cwd()]);
  }

  recentRepos(): Array<{ path: string; name: string }> {
    return this.projectRepository.list().map((project) => ({ path: project.repoPath, name: project.name }));
  }

  canonicalizeDirectory(inputPath: string): string {
    const trimmed = inputPath.trim();
    if (!trimmed) {
      throw new AppError("HOST_PATH_REQUIRED", 400, "A host path is required");
    }

    if (!existsSync(trimmed)) {
      throw new AppError("HOST_PATH_NOT_FOUND", 404, "That host path does not exist");
    }

    const canonical = realpathSync(trimmed);
    if (!statSync(canonical).isDirectory()) {
      throw new AppError("HOST_PATH_NOT_DIRECTORY", 400, "That host path is not a directory");
    }

    return canonical;
  }

  private ensureAllowed(targetPath: string): void {
    const roots = this.roots();
    if (roots.length === 0) {
      throw new AppError("HOST_DIRECTORY_ROOTS_UNAVAILABLE", 500, "No readable host directory roots are configured");
    }

    const allowed = roots.some((root) => {
      const relative = path.relative(root, targetPath);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });

    if (!allowed) {
      throw new AppError("HOST_PATH_NOT_ALLOWED", 403, "That host path is outside the readable roots");
    }
  }

  listDirectory(inputPath?: string): HostDirectoryList {
    const roots = this.roots();
    const targetPath = this.canonicalizeDirectory(inputPath ?? roots[0] ?? "");
    this.ensureAllowed(targetPath);

    const entries = readdirSync(targetPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const entryPath = path.join(targetPath, entry.name);
        const canonical = realpathSync(entryPath);
        let hasChildren = false;
        try {
          hasChildren = readdirSync(canonical, { withFileTypes: true }).some((child) => child.isDirectory());
        } catch {
          hasChildren = false;
        }

        return {
          name: entry.name,
          path: canonical,
          isRepo: existsSync(path.join(canonical, ".git")),
          hasChildren,
        } satisfies HostDirectoryEntry;
      })
      .sort((a, b) => {
        if (a.isRepo !== b.isRepo) {
          return a.isRepo ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    const parentCandidate = path.dirname(targetPath);
    const parentPath = parentCandidate !== targetPath
      ? (() => {
          try {
            const canonicalParent = realpathSync(parentCandidate);
            this.ensureAllowed(canonicalParent);
            return canonicalParent;
          } catch {
            return null;
          }
        })()
      : null;

    return {
      currentPath: targetPath,
      parentPath,
      roots,
      entries,
    };
  }
}
