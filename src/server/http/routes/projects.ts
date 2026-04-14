import { Hono } from "hono";
import { fail, ok } from "../../../shared/contracts/api.ts";
import type { BindingService } from "../../services/binding-service.ts";
import type { CodexDetectionService } from "../../services/codex-detection-service.ts";
import type { AppConfig } from "../../config/types.ts";
import { AppError } from "../../services/errors.ts";

export function createBindingRoutes(
  bindingService: BindingService,
  codexDetectionService: CodexDetectionService,
  config: AppConfig,
): Hono {
  const app = new Hono();

  app.get("/bindings", (c) => {
    return c.json(ok({ items: bindingService.list() }));
  });

  app.post("/bindings", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        repoPath?: string;
        defaultBackend?: string;
      }>();

      if (!body.name || !body.repoPath || !body.defaultBackend) {
        return c.json(fail("INVALID_BINDING_BODY", "name, repoPath, and defaultBackend are required"), 400);
      }

      const binding = bindingService.create({
        name: body.name,
        repoPath: body.repoPath,
        defaultBackend: body.defaultBackend,
        hostId: config.server.hostId,
        allowlist: config.projects.allowlist,
      });

      return c.json(ok({ binding }), 201);
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.get("/bindings/:bindingId", async (c) => {
    try {
      const binding = bindingService.get(c.req.param("bindingId"));
      const codex = await codexDetectionService.detect();
      return c.json(ok({
        binding,
        health: bindingService.health(binding, codex),
      }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.patch("/bindings/:bindingId", async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        defaultBackend?: string;
      }>();

      const binding = bindingService.update(c.req.param("bindingId"), body);
      return c.json(ok({ binding }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  return app;
}
