import { Hono } from "hono";
import { fail, ok } from "../../../shared/contracts/api.ts";
import type { ProjectService } from "../../services/project-service.ts";
import type { CodexDetectionService } from "../../services/codex-detection-service.ts";
import type { AppConfig } from "../../config/types.ts";
import { AppError } from "../../services/errors.ts";

export function createProjectRoutes(
  projectService: ProjectService,
  codexDetectionService: CodexDetectionService,
  config: AppConfig,
): Hono {
  const app = new Hono();

  app.get("/projects", (c) => {
    return c.json(ok({ items: projectService.list() }));
  });

  app.post("/projects", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        repoPath?: string;
        defaultBackend?: string;
      }>();

      if (!body.name || !body.repoPath || !body.defaultBackend) {
        return c.json(fail("INVALID_PROJECT_BODY", "name, repoPath, and defaultBackend are required"), 400);
      }

      const project = projectService.create({
        name: body.name,
        repoPath: body.repoPath,
        defaultBackend: body.defaultBackend,
        hostId: config.server.hostId,
        allowlist: config.projects.allowlist,
      });

      return c.json(ok({ project }), 201);
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.get("/projects/:projectId", async (c) => {
    try {
      const project = projectService.get(c.req.param("projectId"));
      const codex = await codexDetectionService.detect();
      return c.json(ok({
        project,
        health: projectService.health(project, codex),
      }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.patch("/projects/:projectId", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        defaultBackend?: string;
      }>();

      const project = projectService.update(c.req.param("projectId"), body);
      return c.json(ok({ project }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  return app;
}
