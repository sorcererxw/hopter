import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArtifactRef } from "../../shared/domain/artifact.ts";

type ArtifactIndex = {
  artifacts: ArtifactRef[];
};

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export class ArtifactService {
  constructor(private readonly artifactsRoot: string) {
    mkdirSync(this.artifactsRoot, { recursive: true });
  }

  private get globalIndexPath(): string {
    return path.join(this.artifactsRoot, "artifact-index.json");
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.artifactsRoot, "sessions", sessionId);
  }

  private sessionIndexPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "index.json");
  }

  private writeSessionArtifacts(sessionId: string, artifacts: ArtifactRef[]): void {
    mkdirSync(this.sessionDir(sessionId), { recursive: true });
    writeFileSync(this.sessionIndexPath(sessionId), JSON.stringify({ artifacts }, null, 2));
  }

  private writeGlobalArtifacts(artifacts: ArtifactRef[]): void {
    mkdirSync(this.artifactsRoot, { recursive: true });
    writeFileSync(this.globalIndexPath, JSON.stringify({ artifacts }, null, 2));
  }

  private readSessionArtifacts(sessionId: string): ArtifactRef[] {
    const index = readJsonFile<ArtifactIndex>(this.sessionIndexPath(sessionId), { artifacts: [] });
    return index.artifacts;
  }

  private readGlobalArtifacts(): ArtifactRef[] {
    const index = readJsonFile<ArtifactIndex>(this.globalIndexPath, { artifacts: [] });
    return index.artifacts;
  }

  recordTextArtifact(sessionId: string, kind: string, label: string, content: string): ArtifactRef {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const artifactPath = path.join(this.sessionDir(sessionId), `${id}.txt`);
    mkdirSync(this.sessionDir(sessionId), { recursive: true });
    writeFileSync(artifactPath, content, "utf8");

    const artifact: ArtifactRef = {
      id,
      sessionId,
      kind,
      label,
      path: artifactPath,
      contentType: "text/plain; charset=utf-8",
      sizeBytes: Buffer.byteLength(content, "utf8"),
      inlineContent: true,
      createdAt,
    };

    const sessionArtifacts = [artifact, ...this.readSessionArtifacts(sessionId)];
    this.writeSessionArtifacts(sessionId, sessionArtifacts);

    const globalArtifacts = [artifact, ...this.readGlobalArtifacts()];
    this.writeGlobalArtifacts(globalArtifacts);

    return artifact;
  }

  recordFileArtifact(sessionId: string, kind: string, label: string, filePath: string, contentType: string): ArtifactRef {
    const id = crypto.randomUUID();
    const stats = statSync(filePath);
    const artifact: ArtifactRef = {
      id,
      sessionId,
      kind,
      label,
      path: filePath,
      contentType,
      sizeBytes: stats.size,
      inlineContent: contentType.startsWith("text/") || contentType.includes("json"),
      createdAt: new Date().toISOString(),
    };

    const sessionArtifacts = [artifact, ...this.readSessionArtifacts(sessionId)];
    this.writeSessionArtifacts(sessionId, sessionArtifacts);

    const globalArtifacts = [artifact, ...this.readGlobalArtifacts()];
    this.writeGlobalArtifacts(globalArtifacts);

    return artifact;
  }

  listBySessionId(sessionId: string): ArtifactRef[] {
    return this.readSessionArtifacts(sessionId);
  }

  getById(artifactId: string): ArtifactRef | null {
    return this.readGlobalArtifacts().find((artifact) => artifact.id === artifactId) ?? null;
  }
}
