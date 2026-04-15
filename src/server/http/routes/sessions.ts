import { Hono } from "hono";
import { fail, ok } from "../../../shared/contracts/api.ts";
import type { BackendSessionService } from "../../services/backend-session-service.ts";
import { AppError } from "../../services/errors.ts";

export function createBackendSessionRoutes(sessionService: BackendSessionService): Hono {
  const app = new Hono();

  app.get("/bindings/:bindingId/backend-sessions", (c) => {
    return c.json(ok({
      items: sessionService.listByProjectId(c.req.param("bindingId")),
    }));
  });

  app.post("/bindings/:bindingId/backend-sessions", async (c) => {
    try {
      const body = await c.req.json<{
        title?: string | null;
        prompt?: string;
      }>();

      if (!body.prompt || body.prompt.trim() === "") {
        c.status(400 as never);
        return c.json(fail("INVALID_BACKEND_SESSION_BODY", "prompt is required"));
      }

      const handle = await sessionService.createSession(c.req.param("bindingId"), {
        title: body.title ?? null,
        prompt: body.prompt,
      });

      return c.json(ok({ handle }), 201);
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }

      throw error;
    }
  });

  app.get("/backend-sessions/:handleId", async (c) => {
    try {
      const detail = await sessionService.getDetail(c.req.param("handleId"));
      return c.json(ok({
        handle: detail.session,
        attention: detail.attention,
        latestSummary: detail.latestSummary,
        artifacts: detail.artifacts,
        terminal: detail.terminal,
      }));
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }

      throw error;
    }
  });

  app.post("/backend-sessions/:handleId/attach", async (c) => {
    try {
      const attached = await sessionService.attach(c.req.param("handleId"));
      return c.json(ok(attached));
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }

      throw error;
    }
  });

  app.post("/backend-sessions/:handleId/input", async (c) => {
    try {
      const body = await c.req.json<{ text?: string }>();
      if (!body.text || body.text.trim() === "") {
        c.status(400 as never);
        return c.json(fail("INVALID_HANDLE_INPUT", "text is required"));
      }

      const result = await sessionService.input(c.req.param("handleId"), body.text);
      return c.json(ok(result));
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }

      throw error;
    }
  });

  app.post("/backend-sessions/:handleId/approve", async (c) => {
    try {
      const body = await c.req.json<{ decision?: "approve" | "reject"; note?: string | null }>();
      if (body.decision !== "approve" && body.decision !== "reject") {
        c.status(400 as never);
        return c.json(fail("INVALID_APPROVAL_DECISION", "decision must be approve or reject"));
      }

      const result = await sessionService.approve(c.req.param("handleId"), body.decision);
      return c.json(ok(result));
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }

      throw error;
    }
  });

  app.post("/backend-sessions/:handleId/interrupt", async (c) => {
    try {
      const body = await c.req.json<{ mode?: "interrupt" | "stop" }>();
      if (body.mode !== "interrupt" && body.mode !== "stop") {
        c.status(400 as never);
        return c.json(fail("INVALID_INTERRUPT_MODE", "mode must be interrupt or stop"));
      }

      const result = await sessionService.interrupt(c.req.param("handleId"));
      return c.json(ok({ ...result, mode: body.mode }));
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }

      throw error;
    }
  });

  app.get("/backend-sessions/:handleId/artifacts", (c) => {
    try {
      const items = sessionService.listArtifacts(c.req.param("handleId"));
      return c.json(ok({ items }));
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }

      throw error;
    }
  });

  return app;
}
