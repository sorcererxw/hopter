import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

export type ValidationRun = {
  runId: string;
  rootDir: string;
  writeJson: (relativePath: string, data: unknown) => string;
  writeText: (relativePath: string, text: string) => string;
};

function sanitizeRunId(value: string): string {
  return value.replaceAll(":", "-").replaceAll(".", "-");
}

export function createValidationRun(name: string): ValidationRun {
  const now = sanitizeRunId(new Date().toISOString());
  const runId = `${name}_${now}`;
  const rootDir = path.resolve(process.cwd(), "storage/artifacts/validation", runId);
  rmSync(rootDir, { recursive: true, force: true });
  mkdirSync(rootDir, { recursive: true });

  return {
    runId,
    rootDir,
    writeJson(relativePath, data) {
      const absolutePath = path.join(rootDir, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, JSON.stringify(data, null, 2));
      return absolutePath;
    },
    writeText(relativePath, text) {
      const absolutePath = path.join(rootDir, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, text);
      return absolutePath;
    },
  };
}

export async function runCommand(command: string[], cwd: string): Promise<{
  command: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  if (typeof Bun !== "undefined") {
    const proc = Bun.spawn(command, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      command,
      cwd,
      stdout,
      stderr,
      exitCode,
    };
  }

  const [bin, ...args] = command;
  const child = spawn(bin, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  return {
    command,
    cwd,
    stdout,
    stderr,
    exitCode,
  };
}
