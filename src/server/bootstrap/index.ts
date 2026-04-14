import { mkdirSync } from "node:fs";
import { loadConfig } from "../config/load-config.ts";
import { ProjectRepository } from "../repositories/project-repository.ts";
import { AuthSessionRepository } from "../repositories/auth-session-repository.ts";
import { SessionRepository } from "../repositories/session-repository.ts";
import { BindingService } from "../services/binding-service.ts";
import { CodexDetectionService } from "../services/codex-detection-service.ts";
import { HostHealthService } from "../services/host-health-service.ts";
import { AuthService } from "../services/auth-service.ts";
import { BackendSessionService } from "../services/backend-session-service.ts";
import { EventHub } from "../ws/event-hub.ts";
import { createFetchHandler } from "./create-fetch-handler.ts";

const config = loadConfig();
const eventHub = new EventHub();

mkdirSync(config.storage.rootDir, { recursive: true });
mkdirSync(config.storage.artifactsDir, { recursive: true });

const projectRepository = new ProjectRepository();
const sessionRepository = new SessionRepository();
const authSessionRepository = new AuthSessionRepository();
const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
const bindingService = new BindingService(projectRepository, eventHub);
const authService = new AuthService(authSessionRepository, config.auth.password, config.auth.sessionTtlDays);
const hostHealthService = new HostHealthService(config, codexDetectionService, eventHub);
const backendSessionService = new BackendSessionService(config, projectRepository, sessionRepository, eventHub);

const { fetch, websocket } = createFetchHandler({
  config,
  authService,
  bindingService,
  backendSessionService,
  codexDetectionService,
  hostHealthService,
  eventHub,
});

const server = Bun.serve({
  hostname: config.server.host,
  port: config.server.port,
  fetch,
  websocket,
});

console.log(`orchd listening on http://${server.hostname}:${server.port}`);
if (config.server.host === "127.0.0.1" || config.server.host === "localhost") {
  console.log("LAN access is disabled on this process. Use ORCHD_HOST=0.0.0.0 or `bun run dev:lan`.");
}
