import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { fail, ok } from "../../../shared/contracts/api.ts";
import type { BackendSessionService } from "../../services/backend-session-service.ts";
import { AppError } from "../../services/errors.ts";

export function createArtifactRoutes(sessionService: BackendSessionService): Hono {
  const app = new Hono();

  app.get("/artifacts/:artifactId", async (c) => {
    try {
      const artifact = sessionService.getArtifact(c.req.param("artifactId"));
      if (artifact.inlineContent) {
        const content = await readFile(artifact.path, "utf8");
        return c.json(ok({
          artifact,
          content,
        }));
      }

      return c.json(ok({
        artifact,
        downloadUrl: `/api/artifacts/${artifact.id}/file`,
      }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.get("/artifacts/:artifactId/file", async (c) => {
    try {
      const artifact = sessionService.getArtifact(c.req.param("artifactId"));
      const body = await readFile(artifact.path);
      return new Response(body, {
        headers: {
          "content-type": artifact.contentType,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  return app;
}
