import { accessSync, constants } from "node:fs";
import path from "node:path";

export type CodexVersion = {
  raw: string;
  parsed: {
    major: number;
    minor: number;
    patch: number;
  } | null;
};

export type CodexDetection = {
  detected: boolean;
  path: string | null;
  version: CodexVersion | null;
  compatible: boolean;
  status: "available" | "missing" | "incompatible";
  reason: string | null;
};

function resolveBinary(binaryName: string, cwd: string): string | null {
  const candidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.resolve(cwd, entry, binaryName));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function parseSemver(raw: string): CodexVersion {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return {
      raw,
      parsed: null,
    };
  }

  return {
    raw,
    parsed: {
      major: Number.parseInt(match[1], 10),
      minor: Number.parseInt(match[2], 10),
      patch: Number.parseInt(match[3], 10),
    },
  };
}

function compareSemver(a: NonNullable<CodexVersion["parsed"]>, b: NonNullable<CodexVersion["parsed"]>): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }

  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }

  return a.patch - b.patch;
}

export class CodexDetectionService {
  constructor(
    private readonly minVersion: string,
    private readonly cwd: string = process.cwd(),
  ) {}

  async detect(): Promise<CodexDetection> {
    const resolvedPath = resolveBinary("codex", this.cwd);
    if (!resolvedPath) {
      return {
        detected: false,
        path: null,
        version: null,
        compatible: false,
        status: "missing",
        reason: "Codex CLI was not found on PATH.",
      };
    }

    const proc = Bun.spawn([resolvedPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const rawVersion = stdout.trim() || stderr.trim();
    const version = parseSemver(rawVersion);
    const minVersion = parseSemver(this.minVersion);

    if (!version.parsed || !minVersion.parsed) {
      return {
        detected: true,
        path: resolvedPath,
        version,
        compatible: false,
        status: "incompatible",
        reason: "Codex version output could not be parsed.",
      };
    }

    const compatible = compareSemver(version.parsed, minVersion.parsed) >= 0;

    return {
      detected: true,
      path: resolvedPath,
      version,
      compatible,
      status: compatible ? "available" : "incompatible",
      reason: compatible ? null : `Codex ${version.raw} is below required version ${this.minVersion}.`,
    };
  }
}
