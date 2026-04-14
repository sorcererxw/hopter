import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import type { WriteStream } from "node:fs";
import {
  isJsonRpcError,
  isJsonRpcNotification,
  isJsonRpcServerRequest,
  isJsonRpcSuccess,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from "./json-rpc.ts";

type ApprovalHandler = (request: {
  id: string | number;
  method: string;
  params: unknown;
}) => Promise<unknown> | unknown;

type NotificationHandler = (notification: {
  method: string;
  params: unknown;
}) => Promise<void> | void;

type ExitHandler = () => Promise<void> | void;

type AppServerClientOptions = {
  cwd: string;
  transcriptPath?: string;
  approvalHandler?: ApprovalHandler;
  notificationHandler?: NotificationHandler;
  onExit?: ExitHandler;
  stderrPath?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

async function readStreamLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed !== "") {
        await onLine(trimmed);
      }
    }
  }

  const finalChunk = buffer.trim();
  if (finalChunk !== "") {
    await onLine(finalChunk);
  }
}

function appendJsonl(stream: WriteStream | null, payload: unknown): void {
  if (!stream || stream.writableEnded || stream.destroyed) {
    return;
  }

  stream.write(`${JSON.stringify(payload)}\n`);
}

export class CodexAppServerClient {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly pending = new Map<string | number, PendingRequest>();
  private readonly completedTurns = new Map<string, () => void>();
  private readonly transcript: WriteStream | null;
  private readonly stderrTranscript: WriteStream | null;
  private nextId = 1;

  private constructor(
    proc: ReturnType<typeof Bun.spawn>,
    transcript: WriteStream | null,
    stderrTranscript: WriteStream | null,
    private readonly approvalHandler?: ApprovalHandler,
    private readonly notificationHandler?: NotificationHandler,
    private readonly onExit?: ExitHandler,
  ) {
    this.proc = proc;
    this.transcript = transcript;
    this.stderrTranscript = stderrTranscript;
  }

  static async start(options: AppServerClientOptions): Promise<CodexAppServerClient> {
    const proc = Bun.spawn(["codex", "app-server"], {
      cwd: options.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const transcript = options.transcriptPath
      ? (() => {
          mkdirSync(path.dirname(options.transcriptPath!), { recursive: true });
          return createWriteStream(options.transcriptPath!, { flags: "a" });
        })()
      : null;

    const stderrTranscript = options.stderrPath
      ? (() => {
          mkdirSync(path.dirname(options.stderrPath!), { recursive: true });
          return createWriteStream(options.stderrPath!, { flags: "a" });
        })()
      : null;

    const client = new CodexAppServerClient(
      proc,
      transcript,
      stderrTranscript,
      options.approvalHandler,
      options.notificationHandler,
      options.onExit,
    );
    client.bindReaders();
    await client.initialize();
    void proc.exited.then(async () => {
      if (client.onExit) {
        await client.onExit();
      }
    });
    return client;
  }

  private bindReaders(): void {
    void readStreamLines(this.proc.stdout, async (line) => {
      appendJsonl(this.transcript, {
        ts: new Date().toISOString(),
        stream: "stdout",
        line,
      });

      await this.handleMessage(line);
    });

    void readStreamLines(this.proc.stderr, async (line) => {
      appendJsonl(this.stderrTranscript, {
        ts: new Date().toISOString(),
        stream: "stderr",
        line,
      });
    });
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "orchd-spike",
        version: "0.1.0",
      },
      capabilities: null,
    });
  }

  private async handleMessage(line: string): Promise<void> {
    const message = JSON.parse(line) as JsonRpcMessage;

    if (isJsonRpcSuccess(message)) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending.resolve(message.result);
      }
      return;
    }

    if (isJsonRpcError(message)) {
      const pending = message.id !== null ? this.pending.get(message.id) : undefined;
      if (pending) {
        this.pending.delete(message.id!);
        pending.reject(new Error(message.error.message));
      }
      return;
    }

    if (isJsonRpcServerRequest(message)) {
      const result = this.approvalHandler
        ? await this.approvalHandler({
            id: message.id,
            method: message.method,
            params: message.params,
          })
        : this.defaultServerRequestResult(message.method);

      if (result !== undefined) {
        await this.write({
          jsonrpc: "2.0",
          id: message.id,
          method: "__response__",
          params: result,
        }, {
          isResponse: true,
          responseId: message.id,
          responseResult: result,
        });
      }
      return;
    }

    if (isJsonRpcNotification(message)) {
      if (this.notificationHandler) {
        await this.notificationHandler({
          method: message.method,
          params: message.params,
        });
      }
      if (message.method === "turn/completed") {
        const turnId = (message.params as { turn?: { id?: string } }).turn?.id;
        if (turnId) {
          const resolve = this.completedTurns.get(turnId);
          if (resolve) {
            this.completedTurns.delete(turnId);
            resolve();
          }
        }
      }
      return;
    }
  }

  private defaultServerRequestResult(method: string): unknown {
    switch (method) {
      case "item/commandExecution/requestApproval":
        return { decision: "accept" };
      case "item/fileChange/requestApproval":
        return { decision: "accept" };
      case "item/permissions/requestApproval":
        return {
          permissions: {},
          scope: "session",
        };
      case "execCommandApproval":
      case "applyPatchApproval":
        return { decision: "approved" };
      case "item/tool/requestUserInput":
        return {
          answers: [],
        };
      default:
        return {};
    }
  }

  private async write(
    request: JsonRpcRequest,
    responseOverride?: {
      isResponse: true;
      responseId: string | number;
      responseResult: unknown;
    },
  ): Promise<void> {
    const payload = responseOverride
      ? JSON.stringify({
          jsonrpc: "2.0",
          id: responseOverride.responseId,
          result: responseOverride.responseResult,
        })
      : JSON.stringify(request);

    appendJsonl(this.transcript, {
      ts: new Date().toISOString(),
      stream: "stdin",
      line: payload,
    });

    this.proc.stdin.write(`${payload}\n`);
    this.proc.stdin.flush();
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    await this.write(payload);
    return promise;
  }

  async startThread(options: {
    cwd: string;
    approvalPolicy?: "never" | "on-request" | "untrusted";
    sandbox?: "danger-full-access" | "workspace-write";
  }): Promise<{
    thread: {
      id: string;
      path: string | null;
      cwd: string;
    };
  }> {
    const result = await this.request("thread/start", {
      cwd: options.cwd,
      approvalPolicy: options.approvalPolicy ?? "never",
      sandbox: options.sandbox ?? "danger-full-access",
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    return result as {
      thread: {
        id: string;
        path: string | null;
        cwd: string;
      };
    };
  }

  async resumeThread(options: { threadId: string; cwd: string; path?: string | null }): Promise<unknown> {
    return this.request("thread/resume", {
      threadId: options.threadId,
      cwd: options.cwd,
      ...(options.path ? { path: options.path } : {}),
      persistExtendedHistory: false,
    });
  }

  async readThread(threadId: string, includeTurns: boolean): Promise<unknown> {
    return this.request("thread/read", {
      threadId,
      includeTurns,
    });
  }

  async startTurn(
    threadId: string,
    text: string,
    outputSchema?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
      ...(outputSchema ? { outputSchema } : {}),
    });
  }

  async waitForTurnCompletion(turnId: string, timeoutMs = 30_000): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.completedTurns.delete(turnId);
        reject(new Error(`Timed out waiting for turn completion: ${turnId}`));
      }, timeoutMs);

      this.completedTurns.set(turnId, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async steerTurn(threadId: string, expectedTurnId: string, text: string): Promise<unknown> {
    return this.request("turn/steer", {
      threadId,
      expectedTurnId,
      input: [
        {
          type: "text",
          text,
          text_elements: [],
        },
      ],
    });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.request("turn/interrupt", {
      threadId,
      turnId,
    });
  }

  async respondToServerRequest(id: string | number, result: unknown): Promise<void> {
    await this.write({
      jsonrpc: "2.0",
      id,
      method: "__response__",
      params: result,
    }, {
      isResponse: true,
      responseId: id,
      responseResult: result,
    });
  }

  async stop(): Promise<void> {
    this.proc.kill();
    await this.proc.exited;
    this.transcript?.end();
    this.stderrTranscript?.end();
  }
}
