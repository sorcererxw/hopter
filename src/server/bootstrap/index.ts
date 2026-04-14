import { mkdirSync } from "node:fs";
import { loadConfig } from "../config/load-config.ts";
import { openDatabase } from "../db/database.ts";
import { ProjectRepository } from "../repositories/project-repository.ts";
import { AuthSessionRepository } from "../repositories/auth-session-repository.ts";
import { SessionRepository } from "../repositories/session-repository.ts";
import { ProjectService } from "../services/project-service.ts";
import { CodexDetectionService } from "../services/codex-detection-service.ts";
import { HostHealthService } from "../services/host-health-service.ts";
import { AuthService } from "../services/auth-service.ts";
import { SessionService } from "../services/session-service.ts";
import { EventHub } from "../ws/event-hub.ts";
import { createFetchHandler } from "./create-fetch-handler.ts";

const config = loadConfig();
const eventHub = new EventHub();

mkdirSync(config.storage.rootDir, { recursive: true });
mkdirSync(config.storage.artifactsDir, { recursive: true });

const db = openDatabase(config);
const projectRepository = new ProjectRepository(db);
const sessionRepository = new SessionRepository(db);
const authSessionRepository = new AuthSessionRepository(db);
const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
const projectService = new ProjectService(projectRepository, eventHub);
const authService = new AuthService(authSessionRepository, config.auth.password, config.auth.sessionTtlDays);
const hostHealthService = new HostHealthService(config, codexDetectionService, eventHub);
const sessionService = new SessionService(config, projectRepository, sessionRepository, eventHub);

await sessionService.recoverPersistedSessions();

const { fetch, websocket } = createFetchHandler({
  config,
  authService,
  projectService,
  sessionService,
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
