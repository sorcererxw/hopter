import path from "node:path";

export const APP_SERVER_OFFICIAL_DOC_URL = "https://developers.openai.com/codex/app-server";
export const APP_SERVER_UPSTREAM_SOURCE_URL = "https://github.com/openai/codex/tree/main/codex-rs/app-server";
export const APP_SERVER_DOCS_ACK_ENV = "HOPTER_APP_SERVER_DOCS_REVIEWED";
export const APP_SERVER_UPSTREAM_ACK_ENV = "HOPTER_APP_SERVER_UPSTREAM_REVIEWED";

const ackValues = new Set(["1", "true", "yes", "y", "read", "reviewed"]);

const ignoredPrefixes = [
  ".git/",
  ".omx/",
  "storage/",
  "tmp/",
  "node_modules/",
  "ui/node_modules/",
  "ui/pnpm-lock.yaml",
];

const appServerPathPatterns = [
  /^AGENTS\.md$/,
  /^internal\/agents\/codex\//,
  /^scripts\/validate-app-server-/,
  /^scripts\/lib\/app-server-docs-guard\.ts$/,
  /^docs\/operations\/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS\.md$/,
  /^docs\/planning\/.*APP_SERVER.*\.md$/,
];

const appServerContentTokens = [
  "codex app-server",
  "app-server protocol",
  "app-server client",
  "app-server runtime",
  "app-server trace",
  "app_server_trace",
  "thread/start",
  "thread/resume",
  "thread/read",
  "thread/list",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "item/agentMessage/delta",
  "server_request",
  "generate-json-schema",
  "generate-ts",
];

export type AppServerScopeMatch = {
  scoped: boolean;
  reasons: string[];
};

export function normalizeRepoPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function isTruthyAck(value: string | undefined): boolean {
  if (!value) return false;
  return ackValues.has(value.trim().toLowerCase());
}

export function isIgnoredForAppServerDocsGuard(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  return ignoredPrefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

export function classifyAppServerScope(filePath: string, content = ""): AppServerScopeMatch {
  const normalized = normalizeRepoPath(filePath);
  if (isIgnoredForAppServerDocsGuard(normalized)) {
    return { scoped: false, reasons: ["ignored path"] };
  }

  const reasons: string[] = [];
  const pathMatched = appServerPathPatterns.some((pattern) => pattern.test(normalized));
  if (pathMatched) {
    reasons.push("path matches app-server connection scope");
  }

  const lowerContent = content.toLowerCase();
  for (const token of appServerContentTokens) {
    if (lowerContent.includes(token.toLowerCase())) {
      reasons.push(`content mentions ${token}`);
    }
  }

  return {
    scoped: reasons.length > 0,
    reasons,
  };
}
