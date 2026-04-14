import path from "node:path";
import type { AppConfig, AccessMode } from "./types.ts";

type LoadConfigOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

function readString(env: Record<string, string | undefined>, key: string, fallback?: string): string {
  const value = env[key] ?? fallback;

  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required config value: ${key}`);
  }

  return value.trim();
}

function readOptionalString(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key];
  if (!value || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function readBoolean(env: Record<string, string | undefined>, key: string, fallback: boolean): boolean {
  const value = env[key];
  if (value === undefined) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  throw new Error(`Invalid boolean config for ${key}: ${value}`);
}

function readInteger(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const value = env[key];
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer config for ${key}: ${value}`);
  }

  return parsed;
}

function readAccessMode(env: Record<string, string | undefined>, key: string, fallback: AccessMode): AccessMode {
  const value = env[key];
  if (value === undefined) {
    return fallback;
  }

  if (value === "local_only" || value === "self_managed_remote") {
    return value;
  }

  throw new Error(`Invalid access mode for ${key}: ${value}`);
}

function resolveAllowlist(raw: string | null, cwd: string): string[] | null {
  if (!raw) {
    return null;
  }

  const items = raw
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(cwd, item));

  return items.length > 0 ? items : null;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;

  const storageRoot = path.resolve(
    cwd,
    env.ORCHD_STORAGE_DIR?.trim() || "storage",
  );

  const artifactsDir = path.resolve(
    cwd,
    env.ORCHD_ARTIFACTS_DIR?.trim() || path.join(storageRoot, "artifacts"),
  );

  const webDistDir = path.resolve(cwd, "web-dist");
  const webSourceDir = path.resolve(cwd, "src/web/static");

  return {
    server: {
      host: readString(env, "ORCHD_HOST", "127.0.0.1"),
      port: readInteger(env, "ORCHD_PORT", 8787),
      trustProxy: readBoolean(env, "ORCHD_TRUST_PROXY", false),
      accessMode: readAccessMode(env, "ORCHD_ACCESS_MODE", "local_only"),
      hostId: readString(env, "ORCHD_HOST_ID", "host_local"),
    },
    storage: {
      rootDir: storageRoot,
      artifactsDir,
      validationDir: path.join(artifactsDir, "validation"),
      webDistDir,
      webSourceDir,
    },
    auth: {
      password: readOptionalString(env, "ORCHD_AUTH_PASSWORD"),
      cookieName: "orchd_session",
      sessionTtlDays: readInteger(env, "ORCHD_AUTH_SESSION_TTL_DAYS", 30),
    },
    projects: {
      allowlist: resolveAllowlist(readOptionalString(env, "ORCHD_PROJECT_PATH_ALLOWLIST"), cwd),
    },
    codex: {
      minVersion: readString(env, "ORCHD_CODEX_MIN_VERSION", "0.120.0"),
    },
  };
}
