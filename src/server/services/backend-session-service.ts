import path from "node:path";
import { existsSync } from "node:fs";
import type { BackendSessionHandle } from "../../shared/domain/session.ts";
import type { ProjectBinding } from "../../shared/domain/project.ts";
import type { ArtifactRef } from "../../shared/domain/artifact.ts";
import { CodexAppServerClient } from "../adapters/codex/app-server-client.ts";
import type { AppConfig } from "../config/types.ts";
import type { SessionRepository } from "../repositories/session-repository.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";
import { ArtifactService } from "../artifacts/artifact-service.ts";
import type { EventHub } from "../ws/event-hub.ts";
import {
  deriveSessionStateFromThread,
  normalizeCompletedItem,
  normalizeNotification,
  normalizeServerRequest,
  type SessionAttention,
} from "./session-normalizer.ts";
import { AppError } from "./errors.ts";

type LiveServerRequest = {
  id: string | number;
  method: string;
  params: unknown;
  createdAt: string;
};

type LiveSession = {
  sessionId: string;
  projectId: string;
  client: CodexAppServerClient;
  backendThreadId: string;
  activeTurnId: string | null;
  pendingRequest: LiveServerRequest | null;
};

export class BackendSessionService {
  private readonly liveSessions = new Map<string, LiveSession>();
  private readonly validationApprovalForwards = new Map<string, { requestId: string | number; result: unknown }>();
  private readonly validationSteerForwards = new Map<string, { threadId: string; expectedTurnId: string; text: string }>();
  private readonly validationInterruptForwards = new Map<string, { threadId: string; turnId: string }>();
  private readonly artifactService: ArtifactService;

  constructor(
    private readonly config: AppConfig,
    private readonly projectRepository: ProjectRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly eventHub?: EventHub,
  ) {
    this.artifactService = new ArtifactService(this.config.storage.artifactsDir);
  }

  private getProject(projectId: string): ProjectBinding {
    const project = this.projectRepository.getById(projectId);
    if (!project) {
      throw new AppError("BINDING_NOT_FOUND", 404, "Binding does not exist");
    }

    return project;
  }

  private getSession(sessionId: string): BackendSessionHandle {
    const session = this.sessionRepository.getById(sessionId);
    if (!session) {
      throw new AppError("BACKEND_SESSION_HANDLE_NOT_FOUND", 404, "Backend session handle does not exist");
    }

    return session;
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.config.storage.artifactsDir, "sessions", sessionId);
  }

  private rawEventsPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "raw-events.jsonl");
  }

  private stderrPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "stderr.jsonl");
  }

  private async createClient(session: BackendSessionHandle, project: ProjectBinding): Promise<CodexAppServerClient> {
    return CodexAppServerClient.start({
      cwd: project.repoPath,
      transcriptPath: this.rawEventsPath(session.id),
      stderrPath: this.stderrPath(session.id),
      notificationHandler: async ({ method, params }) => {
        await this.handleNotification(session.id, method, params);
      },
      approvalHandler: async ({ id, method, params }) => {
        await this.handleServerRequest(session.id, id, method, params);
      },
      onExit: async () => {
        const current = this.sessionRepository.getById(session.id);
        if (!current) {
          return;
        }

        const updated = this.sessionRepository.update({
          ...current,
          degraded: true,
          status: "degraded",
          attentionReason: current.attentionReason ?? "live_attachment_lost",
          updatedAt: new Date().toISOString(),
        });
        this.eventHub?.emit({
          scope: "session",
          scopeId: session.id,
          type: "session.degraded",
          payload: {
            sessionId: session.id,
            reason: updated.attentionReason,
          },
        });
        this.liveSessions.delete(session.id);
      },
    });
  }

  private updateSession(
    sessionId: string,
    updater: (session: BackendSessionHandle) => BackendSessionHandle,
  ): BackendSessionHandle {
    const current = this.getSession(sessionId);
    const next = updater(current);
    return this.sessionRepository.update(next);
  }

  private async handleNotification(sessionId: string, method: string, params: unknown): Promise<void> {
    const patch = normalizeNotification(method, params);
    const live = this.liveSessions.get(sessionId);

    if (method === "turn/started") {
      live!.activeTurnId = patch.activeTurnId ?? null;
    } else if (method === "turn/completed") {
      if (live) {
        live.activeTurnId = null;
        live.pendingRequest = null;
      }
    } else if (method === "item/completed") {
      const item = (params as { item: { type: string } }).item;
      const itemPatch = normalizeCompletedItem(item as never);
      await this.applyPatch(sessionId, itemPatch);
    }

    await this.applyPatch(sessionId, patch);
  }

  private async handleServerRequest(
    sessionId: string,
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<void> {
    const live = this.liveSessions.get(sessionId);
    if (!live) {
      return;
    }

    live.pendingRequest = {
      id,
      method,
      params,
      createdAt: new Date().toISOString(),
    };

    const patch = normalizeServerRequest(method, id);
    await this.applyPatch(sessionId, patch);
  }

  private async applyPatch(
    sessionId: string,
    patch: {
      status?: string;
      lastSummary?: string | null;
      attention?: SessionAttention | null;
      degraded?: boolean;
      lastEventAt?: string;
      artifactText?: { kind: string; label: string; content: string } | null;
    },
  ): Promise<void> {
    const next = this.updateSession(sessionId, (session) => ({
      ...session,
      status: patch.status ?? session.status,
      lastSummary: patch.lastSummary !== undefined ? patch.lastSummary : session.lastSummary,
      attentionReason: patch.attention !== undefined
        ? patch.attention?.reason ?? null
        : session.attentionReason,
      degraded: patch.degraded ?? session.degraded,
      lastEventAt: patch.lastEventAt ?? session.lastEventAt,
      updatedAt: new Date().toISOString(),
    }));

    this.eventHub?.emit({
      scope: "session",
      scopeId: sessionId,
      type: "session.updated",
      payload: {
        sessionId,
        projectId: next.projectId,
        status: next.status,
        degraded: next.degraded,
        attentionReason: next.attentionReason,
        latestSummary: next.lastSummary,
      },
    });
    this.eventHub?.emit({
      scope: "project",
      scopeId: next.projectId,
      type: "session.updated",
      payload: {
        sessionId,
        projectId: next.projectId,
      },
    });
    this.eventHub?.emit({
      scope: "dashboard",
      scopeId: null,
      type: "session.updated",
      payload: {
        sessionId,
        projectId: next.projectId,
      },
    });

    if (patch.artifactText?.content.trim()) {
      const artifact = this.artifactService.recordTextArtifact(
        sessionId,
        patch.artifactText.kind,
        patch.artifactText.label,
        patch.artifactText.content,
      );
      this.eventHub?.emit({
        scope: "session",
        scopeId: sessionId,
        type: "artifact.created",
        payload: {
          sessionId,
          artifactId: artifact.id,
          artifactType: artifact.kind,
        },
      });
    }
  }

  listByProjectId(projectId: string): BackendSessionHandle[] {
    return this.sessionRepository.listByProjectId(projectId);
  }

  async createSession(
    projectId: string,
    input: { title?: string | null; prompt: string },
  ): Promise<BackendSessionHandle> {
    const project = this.getProject(projectId);
    const now = new Date().toISOString();
    const provisional: BackendSessionHandle = {
      id: crypto.randomUUID(),
      projectId,
      backend: "codex",
      backendSessionId: null,
      title: input.title?.trim() || null,
      status: "starting",
      lastSummary: null,
      attentionReason: null,
      degraded: false,
      lastEventAt: now,
      createdAt: now,
      updatedAt: now,
    };

    this.sessionRepository.create(provisional);
    const client = await this.createClient(provisional, project);
    const rawTraceArtifact = this.artifactService.recordFileArtifact(
      provisional.id,
      "raw_trace",
      "Raw app-server transcript",
      this.rawEventsPath(provisional.id),
      "application/x-ndjson",
    );
    this.eventHub?.emit({
      scope: "session",
      scopeId: provisional.id,
      type: "artifact.created",
      payload: {
        sessionId: provisional.id,
        artifactId: rawTraceArtifact.id,
        artifactType: rawTraceArtifact.kind,
      },
    });

    try {
      const started = await client.startThread({
        cwd: project.repoPath,
        approvalPolicy: "untrusted",
        sandbox: "workspace-write",
      }) as { thread: { id: string; path: string | null } };

      const session = this.updateSession(provisional.id, (current) => ({
        ...current,
        backendSessionId: started.thread.id,
        status: "running",
        updatedAt: new Date().toISOString(),
      }));

      this.liveSessions.set(session.id, {
        sessionId: session.id,
        projectId,
        client,
        backendThreadId: started.thread.id,
        activeTurnId: null,
        pendingRequest: null,
      });

      this.eventHub?.emit({
        scope: "session",
        scopeId: session.id,
        type: "session.created",
        payload: {
          sessionId: session.id,
          projectId,
        },
      });

      await client.startTurn(started.thread.id, input.prompt);
      return this.getSession(session.id);
    } catch (error) {
      await client.stop();
      this.updateSession(provisional.id, (current) => ({
        ...current,
        degraded: true,
        status: "degraded",
        attentionReason: "launch_failed",
        updatedAt: new Date().toISOString(),
      }));
      throw error;
    }
  }

  async attach(sessionId: string): Promise<{ attached: true }> {
    const session = this.getSession(sessionId);
    if (!session.backendSessionId) {
      throw new AppError("BACKEND_SESSION_ATTACH_UNAVAILABLE", 409, "Backend session handle does not have a thread id");
    }

    if (this.liveSessions.has(sessionId)) {
      return { attached: true };
    }

    const project = this.getProject(session.projectId);
    const client = await this.createClient(session, project);

    try {
      await client.resumeThread({
        threadId: session.backendSessionId,
        cwd: project.repoPath,
      });

      const threadRead = await client.readThread(session.backendSessionId, true) as {
        thread: { turns: Array<{ items: Array<{ type: string }>; status: string }> };
      };
      const patch = deriveSessionStateFromThread(threadRead.thread);
      await this.applyPatch(sessionId, patch);

      this.liveSessions.set(sessionId, {
        sessionId,
        projectId: session.projectId,
        client,
        backendThreadId: session.backendSessionId,
        activeTurnId: null,
        pendingRequest: null,
      });

      this.eventHub?.emit({
        scope: "session",
        scopeId: sessionId,
        type: "session.attached",
        payload: {
          sessionId,
        },
      });

      return { attached: true };
    } catch (error) {
      await client.stop();
      this.updateSession(sessionId, (current) => ({
        ...current,
        degraded: true,
        status: "degraded",
        attentionReason: "attach_failed",
        updatedAt: new Date().toISOString(),
      }));
      throw new AppError("BACKEND_SESSION_ATTACH_FAILED", 502, `Failed to attach to backend session: ${String(error)}`);
    }
  }

  async getDetail(sessionId: string): Promise<{
    session: BackendSessionHandle;
    attention: SessionAttention | null;
    latestSummary: string | null;
    artifacts: ArtifactRef[];
    terminal: { available: true };
  }> {
    const session = this.getSession(sessionId);
    const live = this.liveSessions.get(sessionId);
    const attention = live?.pendingRequest
      ? normalizeServerRequest(live.pendingRequest.method, live.pendingRequest.id).attention ?? null
      : session.attentionReason
      ? ({
          reason: session.attentionReason as SessionAttention["reason"],
          headline: session.attentionReason === "approval_required"
            ? "Codex needs approval to continue"
            : "Codex needs additional input to continue",
          requestMethod: live?.pendingRequest?.method ?? "persisted",
        } satisfies SessionAttention)
      : null;

    return {
      session,
      attention,
      latestSummary: session.lastSummary,
      artifacts: this.artifactService.listBySessionId(sessionId),
      terminal: {
        available: true,
      },
    };
  }

  async input(sessionId: string, text: string): Promise<{ accepted: true }> {
    const session = this.getSession(sessionId);
    const live = this.liveSessions.get(sessionId);

    if (!live) {
      await this.attach(sessionId);
    }

    const attachedLive = this.liveSessions.get(sessionId);
    if (!attachedLive) {
      throw new AppError("BACKEND_SESSION_NOT_ATTACHED", 409, "Backend session is not live-attached");
    }

    if (attachedLive.pendingRequest?.method === "item/tool/requestUserInput") {
      const questions = (attachedLive.pendingRequest.params as { questions?: Array<{ id?: string }> }).questions ?? [];
      const answers = Object.fromEntries(
        questions.map((question, index) => [
          question.id ?? `q${index + 1}`,
          { answers: [text] },
        ]),
      );
      await attachedLive.client.respondToServerRequest(attachedLive.pendingRequest.id, { answers });
      attachedLive.pendingRequest = null;
      await this.applyPatch(sessionId, {
        status: "running",
        attention: null,
      });
      return { accepted: true };
    }

    if (attachedLive.activeTurnId) {
      await attachedLive.client.steerTurn(attachedLive.backendThreadId, attachedLive.activeTurnId, text);
      return { accepted: true };
    }

    await attachedLive.client.startTurn(attachedLive.backendThreadId, text);
    return { accepted: true };
  }

  private approvalPayload(method: string, decision: "approve" | "reject"): unknown {
    if (method === "mcpServer/elicitation/request") {
      return {
        action: decision === "approve" ? "accept" : "decline",
        content: null,
        _meta: null,
      };
    }

    if (method === "item/fileChange/requestApproval") {
      return { decision: decision === "approve" ? "accept" : "decline" };
    }

    if (method === "item/permissions/requestApproval") {
      return decision === "approve"
        ? { permissions: {}, scope: "session" }
        : { permissions: {}, scope: "turn" };
    }

    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      return { decision: decision === "approve" ? "approved" : "denied" };
    }

    return { decision: decision === "approve" ? "accept" : "decline" };
  }

  async approve(sessionId: string, decision: "approve" | "reject"): Promise<{ accepted: true }> {
    const live = this.liveSessions.get(sessionId);
    if (!live?.pendingRequest) {
      throw new AppError("BACKEND_SESSION_APPROVAL_UNAVAILABLE", 409, "No approval request is currently pending");
    }

    await live.client.respondToServerRequest(
      live.pendingRequest.id,
      this.approvalPayload(live.pendingRequest.method, decision),
    );
    live.pendingRequest = null;

    await this.applyPatch(sessionId, {
      status: "running",
      attention: null,
    });

    return { accepted: true };
  }

  async injectPendingApprovalForValidation(
    sessionId: string,
    method = "item/commandExecution/requestApproval",
  ): Promise<void> {
    const session = this.getSession(sessionId);

    if (!this.liveSessions.has(sessionId)) {
      this.liveSessions.set(sessionId, {
        sessionId,
        projectId: session.projectId,
        client: {
          respondToServerRequest: async (requestId: string | number, result: unknown) => {
            this.validationApprovalForwards.set(sessionId, {
              requestId,
              result,
            });
          },
        } as unknown as CodexAppServerClient,
        backendThreadId: session.backendSessionId ?? `validation-${sessionId}`,
        activeTurnId: null,
        pendingRequest: null,
      });
    }

    const live = this.liveSessions.get(sessionId)!;
    const originalClient = live.client;
    live.client = {
      ...originalClient,
      respondToServerRequest: async (requestId: string | number, result: unknown) => {
        this.validationApprovalForwards.set(sessionId, {
          requestId,
          result,
        });
        await originalClient.respondToServerRequest(requestId, result);
      },
    } as unknown as CodexAppServerClient;
    live.pendingRequest = {
      id: `validation-${Date.now()}`,
      method,
      params: {},
      createdAt: new Date().toISOString(),
    };

    await this.applyPatch(sessionId, normalizeServerRequest(method, live.pendingRequest.id));
  }

  getValidationApprovalForward(sessionId: string): { requestId: string | number; result: unknown } | null {
    return this.validationApprovalForwards.get(sessionId) ?? null;
  }

  injectActiveTurnForValidation(sessionId: string): string {
    const session = this.getSession(sessionId);
    const turnId = `validation-turn-${Date.now()}`;

    if (!this.liveSessions.has(sessionId)) {
      this.liveSessions.set(sessionId, {
        sessionId,
        projectId: session.projectId,
        client: {} as CodexAppServerClient,
        backendThreadId: session.backendSessionId ?? `validation-${sessionId}`,
        activeTurnId: null,
        pendingRequest: null,
      });
    }

    const live = this.liveSessions.get(sessionId)!;
    const backendThreadId = live.backendThreadId;
    live.activeTurnId = turnId;
    live.client = {
      steerTurn: async (threadId: string, expectedTurnId: string, text: string) => {
        this.validationSteerForwards.set(sessionId, {
          threadId,
          expectedTurnId,
          text,
        });
      },
      interruptTurn: async (threadId: string, interruptTurnId: string) => {
        this.validationInterruptForwards.set(sessionId, {
          threadId,
          turnId: interruptTurnId,
        });
      },
      stop: async () => {},
    } as unknown as CodexAppServerClient;
    live.backendThreadId = backendThreadId;

    return turnId;
  }

  getValidationSteerForward(sessionId: string): { threadId: string; expectedTurnId: string; text: string } | null {
    return this.validationSteerForwards.get(sessionId) ?? null;
  }

  getValidationInterruptForward(sessionId: string): { threadId: string; turnId: string } | null {
    return this.validationInterruptForwards.get(sessionId) ?? null;
  }

  async interrupt(sessionId: string): Promise<{ interrupted: true }> {
    const live = this.liveSessions.get(sessionId);
    if (!live?.activeTurnId) {
      throw new AppError("BACKEND_SESSION_INTERRUPT_UNAVAILABLE", 409, "No active turn is currently running");
    }

    await live.client.interruptTurn(live.backendThreadId, live.activeTurnId);
    return { interrupted: true };
  }

  listArtifacts(sessionId: string): ArtifactRef[] {
    this.getSession(sessionId);
    return this.artifactService.listBySessionId(sessionId);
  }

  getArtifact(artifactId: string): ArtifactRef {
    const artifact = this.artifactService.getById(artifactId);
    if (!artifact) {
      throw new AppError("ARTIFACT_NOT_FOUND", 404, "Artifact does not exist");
    }

    return artifact;
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.liveSessions.values()].map(async (live) => {
        if (typeof live.client.stop === "function") {
          await live.client.stop();
        }
      }),
    );
    this.liveSessions.clear();
  }
}
