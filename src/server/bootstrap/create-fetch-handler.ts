import { parse } from "cookie";
import type { ServerWebSocket } from "bun";
import { createApp } from "./create-app.ts";
import type { AppConfig } from "../config/types.ts";
import type { AuthService } from "../services/auth-service.ts";
import type { CodexDetectionService } from "../services/codex-detection-service.ts";
import type { HostHealthService } from "../services/host-health-service.ts";
import type { ProjectService } from "../services/project-service.ts";
import type { SessionService } from "../services/session-service.ts";
import type { EventHub } from "../ws/event-hub.ts";

export type WsData = {
  unsub?: () => void;
};

type Options = {
  config: AppConfig;
  authService: AuthService;
  projectService: ProjectService;
  sessionService: SessionService;
  codexDetectionService: CodexDetectionService;
  hostHealthService: HostHealthService;
  eventHub: EventHub;
};

export function createFetchHandler(options: Options) {
  const app = createApp({
    config: options.config,
    authService: options.authService,
    projectService: options.projectService,
    sessionService: options.sessionService,
    codexDetectionService: options.codexDetectionService,
    hostHealthService: options.hostHealthService,
  });

  return {
    fetch(request: Request, server: Bun.Server<WsData>) {
      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        if (options.authService.isEnabled()) {
          const rawCookie = request.headers.get("cookie");
          const token = rawCookie ? parse(rawCookie)[options.config.auth.cookieName] ?? null : null;
          if (!options.authService.getUserForToken(token)) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        if (server.upgrade(request, { data: {} })) {
          return;
        }

        return new Response("Upgrade failed", { status: 426 });
      }

      return app.fetch(request);
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        ws.data.unsub = options.eventHub.subscribe((event) => {
          ws.send(JSON.stringify(event));
        });
      },
      close(ws: ServerWebSocket<WsData>) {
        ws.data.unsub?.();
      },
    },
  };
}
