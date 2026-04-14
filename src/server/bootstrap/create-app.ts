import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { fail } from "../../shared/contracts/api.ts";
import type { AppConfig } from "../config/types.ts";
import type { AuthService } from "../services/auth-service.ts";
import type { CodexDetectionService } from "../services/codex-detection-service.ts";
import type { HostHealthService } from "../services/host-health-service.ts";
import type { ProjectService } from "../services/project-service.ts";
import type { SessionService } from "../services/session-service.ts";
import { createAuthMiddleware } from "../http/middleware/auth.ts";
import { createAuthRoutes } from "../http/routes/auth.ts";
import { createHostRoutes } from "../http/routes/host.ts";
import { createProjectRoutes } from "../http/routes/projects.ts";
import { createSessionRoutes } from "../http/routes/sessions.ts";
import { createArtifactRoutes } from "../http/routes/artifacts.ts";

type CreateAppOptions = {
  config: AppConfig;
  authService: AuthService;
  projectService: ProjectService;
  sessionService: SessionService;
  codexDetectionService: CodexDetectionService;
  hostHealthService: HostHealthService;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function resolveWebRoot(config: AppConfig): Promise<string> {
  const distDir = config.storage.webDistDir;
  if (existsSync(path.join(distDir, "index.html"))) {
    return distDir;
  }

  await mkdir(config.storage.webSourceDir, { recursive: true });
  return config.storage.webSourceDir;
}

async function serveStaticAsset(config: AppConfig, requestPath: string): Promise<Response | null> {
  const webRoot = await resolveWebRoot(config);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\//, "");
  const assetPath = path.join(webRoot, relativePath);

  if (!existsSync(assetPath)) {
    if (requestPath === "/" || !path.extname(requestPath)) {
      const indexPath = path.join(webRoot, "index.html");
      const indexBody = await readFile(indexPath);
      return new Response(indexBody, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    return null;
  }

  const body = await readFile(assetPath);
  return new Response(body, {
    headers: {
      "content-type": CONTENT_TYPES[path.extname(assetPath)] ?? "application/octet-stream",
    },
  });
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  app.use("*", createAuthMiddleware(options.authService, options.config.auth.cookieName));

  app.route(
    "/api/auth",
    createAuthRoutes(
      options.authService,
      options.config.auth.cookieName,
      options.config.server.accessMode === "self_managed_remote" || options.config.server.trustProxy,
    ),
  );
  app.route("/api", createHostRoutes(options.hostHealthService, options.codexDetectionService));
  app.route("/api", createProjectRoutes(options.projectService, options.codexDetectionService, options.config));
  app.route("/api", createSessionRoutes(options.sessionService));
  app.route("/api", createArtifactRoutes(options.sessionService));

  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json(fail("ROUTE_NOT_FOUND", "Route does not exist"), 404);
    }

    const asset = await serveStaticAsset(options.config, c.req.path);
    return asset ?? c.newResponse("Not found", 404);
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json(fail("INTERNAL_SERVER_ERROR", "Unexpected server error"), 500);
  });

  return app;
}
