import { describe, expect, test } from "bun:test";
import { AuthSessionRepository } from "../src/server/repositories/auth-session-repository.ts";
import { ProjectRepository } from "../src/server/repositories/project-repository.ts";
import { SessionRepository } from "../src/server/repositories/session-repository.ts";
import { TerminalSessionRepository } from "../src/server/repositories/terminal-session-repository.ts";

describe("repositories", () => {
  test("project repository create/list/update", () => {
    const repository = new ProjectRepository();
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
    const repository = new SessionRepository();
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

  test("auth repository expires and deletes sessions in memory", () => {
    const repository = new AuthSessionRepository();
    repository.create({
      id: "auth-1",
      userId: "local-user",
      tokenHash: "token-1",
      createdAt: "2026-04-14T00:00:00.000Z",
      expiresAt: "2026-04-14T01:00:00.000Z",
    });

    expect(repository.getByTokenHash("token-1")?.id).toBe("auth-1");
    repository.deleteExpired("2026-04-14T02:00:00.000Z");
    expect(repository.getByTokenHash("token-1")).toBeNull();
  });

  test("terminal repository stays in memory and filters by project", () => {
    const repository = new TerminalSessionRepository();
    repository.create({
      id: "terminal-1",
      projectId: "project-1",
      cwd: "/tmp/orchd",
      shell: "/bin/zsh",
      status: "open",
      createdAt: "2026-04-14T00:00:00.000Z",
      closedAt: null,
    });
    repository.create({
      id: "terminal-2",
      projectId: "project-2",
      cwd: "/tmp/other",
      shell: "/bin/zsh",
      status: "open",
      createdAt: "2026-04-14T00:01:00.000Z",
      closedAt: null,
    });

    expect(repository.listByProjectId("project-1").map((session) => session.id)).toEqual(["terminal-1"]);
  });
});
