import { Hono } from "hono";
import { fail, ok } from "../../../shared/contracts/api.ts";
import type { SessionService } from "../../services/session-service.ts";
import { AppError } from "../../services/errors.ts";

export function createSessionRoutes(sessionService: SessionService): Hono {
  const app = new Hono();

  app.get("/projects/:projectId/sessions", (c) => {
    return c.json(ok({
      items: sessionService.listByProjectId(c.req.param("projectId")),
    }));
  });

  app.post("/projects/:projectId/sessions", async (c) => {
    try {
      const body = await c.req.json<{
        title?: string | null;
        prompt?: string;
      }>();

      if (!body.prompt || body.prompt.trim() === "") {
        return c.json(fail("INVALID_SESSION_BODY", "prompt is required"), 400);
      }

      const session = await sessionService.createSession(c.req.param("projectId"), {
        title: body.title ?? null,
        prompt: body.prompt,
      });

      return c.json(ok({ session }), 201);
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.get("/sessions/:sessionId", async (c) => {
    try {
      const detail = await sessionService.getDetail(c.req.param("sessionId"));
      return c.json(ok(detail));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.post("/sessions/:sessionId/attach", async (c) => {
    try {
      const attached = await sessionService.attach(c.req.param("sessionId"));
      return c.json(ok(attached));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.post("/sessions/:sessionId/input", async (c) => {
    try {
      const body = await c.req.json<{ text?: string }>();
      if (!body.text || body.text.trim() === "") {
        return c.json(fail("INVALID_SESSION_INPUT", "text is required"), 400);
      }

      const result = await sessionService.input(c.req.param("sessionId"), body.text);
      return c.json(ok(result));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.post("/sessions/:sessionId/approve", async (c) => {
    try {
      const body = await c.req.json<{ decision?: "approve" | "reject"; note?: string | null }>();
      if (body.decision !== "approve" && body.decision !== "reject") {
        return c.json(fail("INVALID_APPROVAL_DECISION", "decision must be approve or reject"), 400);
      }

      const result = await sessionService.approve(c.req.param("sessionId"), body.decision);
      return c.json(ok(result));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.post("/sessions/:sessionId/interrupt", async (c) => {
    try {
      const body = await c.req.json<{ mode?: "interrupt" | "stop" }>();
      if (body.mode !== "interrupt" && body.mode !== "stop") {
        return c.json(fail("INVALID_INTERRUPT_MODE", "mode must be interrupt or stop"), 400);
      }

      const result = await sessionService.interrupt(c.req.param("sessionId"));
      return c.json(ok({ ...result, mode: body.mode }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.get("/sessions/:sessionId/artifacts", (c) => {
    try {
      const items = sessionService.listArtifacts(c.req.param("sessionId"));
      return c.json(ok({ items }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  return app;
}
