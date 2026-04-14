import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/server/db/migrate.ts";
import { ProjectRepository } from "../src/server/repositories/project-repository.ts";
import { SessionRepository } from "../src/server/repositories/session-repository.ts";

describe("repositories", () => {
  test("project repository create/list/update", () => {
    const db = new Database(":memory:");
    runMigrations(db, `${process.cwd()}/src/server/db/migrations`);

    const repository = new ProjectRepository(db);
    repository.create({
      id: "project-1",
      name: "orchd",
      repoPath: "/tmp/orchd",
      hostId: "host_local",
      defaultBackend: "codex",
      createdAt: "2026-04-14T00:00:00.000Z",
      updatedAt: "2026-04-14T00:00:00.000Z",
    });

    expect(repository.list()).toHaveLength(1);
    const updated = repository.update("project-1", {
      name: "orchd-renamed",
      updatedAt: "2026-04-14T00:01:00.000Z",
    });

    expect(updated?.name).toBe("orchd-renamed");
    expect(repository.getByRepoPath("/tmp/orchd")?.id).toBe("project-1");
  });

  test("session repository create/list/update", () => {
    const db = new Database(":memory:");
    runMigrations(db, `${process.cwd()}/src/server/db/migrations`);

    db.query(`
      INSERT INTO projects (id, name, repo_path, host_id, default_backend, created_at, updated_at)
      VALUES ('project-1', 'orchd', '/tmp/orchd', 'host_local', 'codex', '2026-04-14T00:00:00.000Z', '2026-04-14T00:00:00.000Z')
    `).run();

    const repository = new SessionRepository(db);
    repository.create({
      id: "session-1",
      projectId: "project-1",
      backend: "codex",
      backendSessionId: "thread-1",
      title: "Initial session",
      status: "running",
      lastSummary: null,
      attentionReason: null,
      degraded: false,
      lastEventAt: null,
      createdAt: "2026-04-14T00:00:00.000Z",
      updatedAt: "2026-04-14T00:00:00.000Z",
    });

    const session = repository.getById("session-1");
    expect(session?.backendSessionId).toBe("thread-1");

    repository.update({
      ...session!,
      status: "completed",
      updatedAt: "2026-04-14T00:05:00.000Z",
    });

    expect(repository.listByProjectId("project-1")[0]?.status).toBe("completed");
  });
});
