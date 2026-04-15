import { existsSync, mkdirSync } from "node:fs";
import type { AppConfig } from "../config/types.ts";
import type { CodexDetectionService } from "./codex-detection-service.ts";
import type { EventHub } from "../ws/event-hub.ts";

export type HostStatus = {
  hostId: string;
  status: "healthy" | "degraded" | "unhealthy";
  codex: {
    detected: boolean;
    version: string | null;
    compatible: boolean;
    status: "available" | "missing" | "incompatible";
    reason: string | null;
  };
  storage: {
    artifacts: "healthy" | "missing";
  };
  accessMode: AppConfig["server"]["accessMode"];
};

export class HostHealthService {
  constructor(
    private readonly config: AppConfig,
    private readonly codexDetectionService: CodexDetectionService,
    private readonly eventHub?: EventHub,
  ) {}

  async getStatus(): Promise<HostStatus> {
    mkdirSync(this.config.storage.rootDir, { recursive: true });
    mkdirSync(this.config.storage.artifactsDir, { recursive: true });

    const codex = await this.codexDetectionService.detect();
    const artifactsExist = existsSync(this.config.storage.artifactsDir);

    const status: HostStatus["status"] = codex.compatible && artifactsExist
      ? "healthy"
      : codex.detected || artifactsExist
      ? "degraded"
      : "unhealthy";

    const result: HostStatus = {
      hostId: this.config.server.hostId,
      status,
      codex: {
        detected: codex.detected,
        version: codex.version?.raw ?? null,
        compatible: codex.compatible,
        status: codex.status,
        reason: codex.reason,
      },
      storage: {
        artifacts: artifactsExist ? "healthy" : "missing",
      },
      accessMode: this.config.server.accessMode,
    };
    this.eventHub?.emit({
      scope: "host",
      scopeId: this.config.server.hostId,
      type: "host.status.updated",
      payload: result,
    });
    return result;
  }
}
