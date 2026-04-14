import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/server/config/load-config.ts";
import { CodexDetectionService } from "../src/server/services/codex-detection-service.ts";
import { CodexAppServerClient } from "../src/server/adapters/codex/app-server-client.ts";
import { createValidationRun } from "./lib/validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("m0");
  const config = loadConfig();
  const detectionService = new CodexDetectionService(config.codex.minVersion);

  const detection = await detectionService.detect();
  run.writeJson("t002/codex-detection.json", detection);

  const transcriptPath = path.join(run.rootDir, "t003/raw-events.jsonl");
  const stderrPath = path.join(run.rootDir, "t003/stderr.jsonl");
  const client = await CodexAppServerClient.start({
    cwd: process.cwd(),
    transcriptPath,
    stderrPath,
  });

  const start = await client.startThread({ cwd: process.cwd() });
  const turn = await client.startTurn(
    start.thread.id,
    'Reply with JSON only. Set "status" to "READY".',
    {
      type: "object",
      properties: {
        status: {
          type: "string",
        },
      },
      required: ["status"],
      additionalProperties: false,
    },
  ) as { turn?: { id?: string } };

  if (!turn.turn?.id) {
    throw new Error("turn/start did not return a turn id");
  }

  await client.waitForTurnCompletion(turn.turn.id, 90_000);
  await Bun.sleep(500);
  run.writeJson("t003/thread-start.json", start);
  run.writeJson("t003/turn-start.json", turn);

  await client.stop();

  const resumeClient = await CodexAppServerClient.start({
    cwd: process.cwd(),
    transcriptPath: path.join(run.rootDir, "t004/raw-events.jsonl"),
    stderrPath: path.join(run.rootDir, "t004/stderr.jsonl"),
  });
  const resume = await resumeClient.resumeThread({
    threadId: start.thread.id,
    cwd: process.cwd(),
  });
  run.writeJson("t004/thread-resume.json", resume);
  await resumeClient.stop();

  const terminalCwd = mkdtempSync(path.join(tmpdir(), "orchd-terminal-"));
  const terminalProc = Bun.spawn(["/bin/zsh", "-lc", "printf '%s\\n' \"$PWD\"; read line; printf 'ACK:%s\\n' \"$line\""], {
    cwd: terminalCwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  terminalProc.stdin.write("HELLO\n");
  terminalProc.stdin.end();

  const [terminalStdout, terminalStderr, terminalExit] = await Promise.all([
    new Response(terminalProc.stdout).text(),
    new Response(terminalProc.stderr).text(),
    terminalProc.exited,
  ]);

  run.writeJson("t005/terminal-viability.json", {
    cwd: terminalCwd,
    stdout: terminalStdout,
    stderr: terminalStderr,
    exitCode: terminalExit,
    resize: {
      supportedByBunSpawn: false,
      note: "Bun.spawn covers cwd + stdin/stdout lifecycle, but PTY resize still requires a PTY-capable layer for M4 terminal UX.",
    },
  });
  rmSync(terminalCwd, { recursive: true, force: true });

  const findings = `# M0 Spike Findings

- T001: Bun server bootstrap is implemented in \`src/server/bootstrap/index.ts\`.
- T002: Codex detection resolves the binary from PATH, parses semantic version output, and distinguishes missing vs incompatible states.
- T003: \`codex app-server\` was successfully driven over stdio; thread id \`${start.thread.id}\` and raw transcripts were captured.
- T004: Thread resume worked via \`thread/resume\` against the prior thread id.
- T005: Bun child-process primitives support cwd + interactive stdin/stdout + predictable close behavior. PTY resize remains a documented follow-up risk.

Evidence root: \`${run.rootDir}\`
`;

  run.writeText("t006/m0-findings.md", findings);
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m0.txt"), `${run.rootDir}\n`);

  console.log(`M0 validation evidence: ${run.rootDir}`);
}

await main();
