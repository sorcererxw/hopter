import { Hono } from "hono";
import { ok } from "../../../shared/contracts/api.ts";
import type { HostHealthService } from "../../services/host-health-service.ts";
import type { CodexDetectionService } from "../../services/codex-detection-service.ts";

export function createHostRoutes(
  hostHealthService: HostHealthService,
  codexDetectionService: CodexDetectionService,
): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json(ok({ status: "ok" })));

  app.get("/host/status", async (c) => {
    const status = await hostHealthService.getStatus();
    return c.json(ok(status));
  });

  app.get("/backends", async (c) => {
    const codex = await codexDetectionService.detect();

    return c.json(ok([
      {
        id: "codex",
        label: "Codex",
        available: codex.compatible,
        status: codex.status,
        version: codex.version?.raw ?? null,
        capabilities: ["create_session", "attach_session", "approval", "interrupt", "artifacts"],
      },
    ]));
  });

  return app;
}
