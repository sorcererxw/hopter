import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { createValidationRun, runCommand } from "./lib/validation.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";

async function findAvailablePort() {
  const preferred = process.env.HOPTER_TERMINAL_PORT?.trim();
  if (preferred) {
    return Number.parseInt(preferred, 10);
  }

  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to resolve available port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

type Project = {
  id: string;
  rootPath: string;
};

type TerminalLookup = {
  terminal?: {
    id: string;
  };
};

async function rpc<T>(
  baseUrl: string,
  service: string,
  method: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}/rpc/${service}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${service}/${method} returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function listProjects(baseUrl: string) {
  return rpc<{ projects?: Project[] }>(
    baseUrl,
    "hopter.v1.ProjectService",
    "ListProjects",
    {},
  );
}

async function createSession(
  baseUrl: string,
  projectId: string,
  prompt: string,
  title: string,
) {
  return rpc<{ session?: { id: string } }>(
    baseUrl,
    "hopter.v1.SessionService",
    "CreateSession",
    {
      projectId,
      backendKey: "codex",
      prompt,
      title,
    },
  );
}

async function getTerminalSession(
  baseUrl: string,
  sessionId: string,
  browserInstanceId: string,
  tabId: string,
) {
  return rpc<TerminalLookup>(
    baseUrl,
    "hopter.v1.TerminalService",
    "GetTerminalSession",
    {
      sessionId,
      browserInstanceId,
      tabId,
    },
  );
}

async function waitForSessionPage(page: Page, sessionId: string) {
  await page.goto(`/sessions/${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="workspace-topbar-terminal"]', {
    timeout: 20_000,
  });
}

async function waitForTerminalOutput(
  page: Page,
  token: string,
  timeoutMs = 20_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await page
      .getByTestId("session-terminal-surface")
      .textContent()
      .catch(() => "");
    if (text?.includes(token)) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitForTerminalLive(page: Page, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await page
      .getByTestId("session-terminal-header")
      .textContent()
      .catch(() => "");
    if (text?.includes("Live")) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitForHttp(
  url: string,
  timeoutMs = 20_000,
  intervalMs = 500,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {}
    await Bun.sleep(intervalMs);
  }
  return false;
}

async function main() {
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const run = createValidationRun("terminal_browser");
  const checks: ValidationCheck[] = [];
  mkdirSync(path.join(run.rootDir, "screenshots"), { recursive: true });

  try {
    const uiBuild = await runCommand(
      ["pnpm", "--dir", "ui", "build"],
      process.cwd(),
    );
    run.writeJson("commands/ui-build.json", uiBuild);
    checks.push({
      name: "ui production build",
      status: uiBuild.exitCode === 0 ? "pass" : "fail",
      detail:
        uiBuild.exitCode === 0
          ? "ui/dist built successfully"
          : (uiBuild.stderr || uiBuild.stdout || "ui build failed").trim(),
    });

    const buildDir = path.join(run.rootDir, "bin");
    mkdirSync(buildDir, { recursive: true });
    const binaryPath = path.join(buildDir, "hopter");
    const goBuild = await runCommand(
      ["go", "build", "-o", binaryPath, "./cmd/hopter"],
      process.cwd(),
    );
    run.writeJson("commands/go-build.json", goBuild);
    checks.push({
      name: "go build ./cmd/hopter",
      status: goBuild.exitCode === 0 ? "pass" : "fail",
      detail:
        goBuild.exitCode === 0
          ? `built ${binaryPath}`
          : (goBuild.stderr || goBuild.stdout || "go build failed").trim(),
    });

    if (uiBuild.exitCode !== 0 || goBuild.exitCode !== 0) {
      throw new Error(
        "UI or Go build failed before terminal validation could run",
      );
    }

    const server = Bun.spawn([binaryPath], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOPTER_HOST: "127.0.0.1",
        HOPTER_PORT: String(port),
        HOPTER_TERMINAL_DETACH_TTL_MS: "2000",
        HOPTER_TERMINAL_PROMPT_POLL_MS: "200",
      },
    });

    try {
      const healthy = await waitForHttp(`${baseUrl}/healthz`);
      checks.push({
        name: "Go origin health",
        status: healthy ? "pass" : "fail",
        detail: healthy ? "health returned 200" : "health probe failed",
      });

      if (!healthy) {
        throw new Error(`Go server failed to become healthy at ${baseUrl}`);
      }

      const projectResponse = await listProjects(baseUrl);
      const project = (projectResponse.projects ?? [])[0];
      checks.push({
        name: "project available for terminal validation",
        status: project ? "pass" : "fail",
        detail: project
          ? project.rootPath
          : "no project returned from ProjectService",
      });

      if (!project) {
        throw new Error("No project returned for terminal validation");
      }

      const created = await createSession(
        baseUrl,
        project.id,
        "Reply with exactly TERMINAL-VALIDATION-ACK.",
        `Terminal validation ${new Date().toISOString()}`,
      );
      const sessionId = created.session?.id;
      if (!sessionId) {
        throw new Error(
          "SessionService.CreateSession did not return a session id",
        );
      }
      run.writeText("session-id.txt", `${sessionId}\n`);

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          baseURL: baseUrl,
          viewport: { width: 1440, height: 1100 },
        });
        await waitForSessionPage(page, sessionId);
        await page.screenshot({
          path: path.join(
            run.rootDir,
            "screenshots/session-before-terminal.png",
          ),
          fullPage: true,
        });

        await page.getByTestId("workspace-topbar-terminal").click();
        await page.waitForSelector('[data-testid="session-terminal-drawer"]', {
          timeout: 20_000,
        });
        await page.waitForSelector('[data-testid="session-terminal-header"]', {
          timeout: 20_000,
        });
        await page.waitForSelector('[data-testid="session-terminal-surface"]', {
          timeout: 20_000,
        });

        const drawerText = await page
          .getByTestId("session-terminal-drawer")
          .textContent()
          .catch(() => "");

        checks.push({
          name: "terminal drawer opens from session topbar",
          status: drawerText ? "pass" : "fail",
          detail:
            drawerText?.includes("Starting terminal...") ||
            drawerText?.includes("Live")
              ? "drawer rendered terminal state"
              : "drawer did not render expected terminal copy",
        });

        const headerText = await page
          .getByTestId("session-terminal-header")
          .textContent()
          .catch(() => "");
        const browserInstanceId = await page.evaluate(() =>
          window.localStorage.getItem("hopter.browserInstanceId"),
        );
        const tabId = await page.evaluate(() =>
          window.sessionStorage.getItem("hopter.tabId"),
        );
        if (!browserInstanceId || !tabId) {
          throw new Error(
            "Terminal browser identity was not available in storage",
          );
        }
        const firstTerminalLookup = await getTerminalSession(
          baseUrl,
          sessionId,
          browserInstanceId,
          tabId,
        );
        const firstTerminalId = firstTerminalLookup.terminal?.id;
        if (!firstTerminalId) {
          throw new Error(
            "TerminalService.GetTerminalSession did not return a terminal id after open",
          );
        }
        checks.push({
          name: "terminal header renders shell context",
          status:
            headerText?.includes("shell") || headerText?.includes("Live")
              ? "pass"
              : "fail",
          detail: headerText || "header was empty",
        });

        const liveReady = await waitForTerminalLive(page);
        checks.push({
          name: "terminal stream reaches live state",
          status: liveReady ? "pass" : "fail",
          detail: liveReady
            ? "header reached Live state"
            : "terminal never reached Live before interactive checks",
        });

        const outputToken = `TERM-OUTPUT-${Date.now()}`;
        let outputSeen = false;
        if (liveReady) {
          await page.keyboard.type(`printf '${outputToken}\\n'`);
          await page.keyboard.press("Enter");
          outputSeen = await waitForTerminalOutput(page, outputToken);
        }
        checks.push({
          name: "terminal accepts input and renders output",
          status: outputSeen ? "pass" : "fail",
          detail: outputSeen
            ? outputToken
            : "terminal output token was not observed",
        });

        const drawerBoxBeforeResize = await page
          .getByTestId("session-terminal-drawer")
          .boundingBox();
        const resizeBox = await page
          .getByTestId("session-terminal-resize-handle")
          .boundingBox();
        if (drawerBoxBeforeResize && resizeBox) {
          await page.mouse.move(
            resizeBox.x + resizeBox.width / 2,
            resizeBox.y + resizeBox.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(
            resizeBox.x + resizeBox.width / 2,
            resizeBox.y - 120,
            { steps: 8 },
          );
          await page.mouse.up();
        }
        await page.waitForTimeout(300);
        const drawerBoxAfterResize = await page
          .getByTestId("session-terminal-drawer")
          .boundingBox();
        const resized =
          Boolean(drawerBoxBeforeResize && drawerBoxAfterResize) &&
          drawerBoxAfterResize!.height > drawerBoxBeforeResize!.height + 40;
        checks.push({
          name: "terminal drawer resizes",
          status: resized ? "pass" : "fail",
          detail:
            drawerBoxBeforeResize && drawerBoxAfterResize
              ? `${Math.round(drawerBoxBeforeResize.height)} -> ${Math.round(drawerBoxAfterResize.height)}`
              : "failed to read drawer bounds for resize validation",
        });

        await page.screenshot({
          path: path.join(run.rootDir, "screenshots/session-terminal-open.png"),
          fullPage: true,
        });

        await page.getByLabel("Hide terminal").click();
        await page.waitForTimeout(500);

        const drawerVisibleAfterHide = await page
          .locator('[data-testid="session-terminal-drawer"]')
          .isVisible()
          .catch(() => false);

        checks.push({
          name: "terminal drawer hides when closed",
          status: !drawerVisibleAfterHide ? "pass" : "fail",
          detail: !drawerVisibleAfterHide
            ? "drawer hidden after close action"
            : "drawer remained visible",
        });

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(
          '[data-testid="workspace-topbar-terminal"]',
          {
            timeout: 20_000,
          },
        );
        const drawerVisibleAfterRefresh = await page
          .locator('[data-testid="session-terminal-drawer"]')
          .isVisible()
          .catch(() => false);

        checks.push({
          name: "refresh keeps terminal closed by default",
          status: !drawerVisibleAfterRefresh ? "pass" : "fail",
          detail: !drawerVisibleAfterRefresh
            ? "refresh did not auto-open terminal drawer"
            : "refresh reopened terminal drawer unexpectedly",
        });

        await page.getByTestId("workspace-topbar-terminal").click();
        await page.waitForSelector('[data-testid="session-terminal-drawer"]', {
          timeout: 20_000,
        });
        const liveAfterRefresh = await waitForTerminalLive(page);
        const outputSeenAfterRefresh =
          liveAfterRefresh && (await waitForTerminalOutput(page, outputToken));
        const refreshTerminalLookup = await getTerminalSession(
          baseUrl,
          sessionId,
          browserInstanceId,
          tabId,
        );
        const refreshTerminalId = refreshTerminalLookup.terminal?.id;
        checks.push({
          name: "same-tab refresh reattaches terminal output",
          status: outputSeenAfterRefresh ? "pass" : "fail",
          detail: outputSeenAfterRefresh
            ? outputToken
            : "terminal output token was not replayed after refresh",
        });
        checks.push({
          name: "same-tab refresh reuses the same terminal id",
          status:
            Boolean(refreshTerminalId) && refreshTerminalId === firstTerminalId
              ? "pass"
              : "fail",
          detail:
            refreshTerminalId && refreshTerminalId === firstTerminalId
              ? refreshTerminalId
              : `expected ${firstTerminalId}, got ${refreshTerminalId ?? "missing"}`,
        });

        const longRunningToken = `TERM-LONG-${Date.now()}`;
        await page.keyboard.type(`sleep 5; printf '${longRunningToken}\\n'`);
        await page.keyboard.press("Enter");
        await page.getByLabel("Hide terminal").click();
        await page.waitForTimeout(5000);
        await page.getByTestId("workspace-topbar-terminal").click();
        await page.waitForSelector('[data-testid="session-terminal-drawer"]', {
          timeout: 20_000,
        });
        const longRunningTokenSeen = await waitForTerminalOutput(
          page,
          longRunningToken,
          7_000,
        );
        checks.push({
          name: "detached running command survives past detach TTL",
          status: longRunningTokenSeen ? "pass" : "fail",
          detail: longRunningTokenSeen
            ? longRunningToken
            : "running command output never arrived after detach/reopen",
        });

        const settleToken = `TERM-SETTLE-${Date.now()}`;
        await page.keyboard.type(`printf '${settleToken}\\n'`);
        await page.keyboard.press("Enter");
        const settleTokenSeen = await waitForTerminalOutput(
          page,
          settleToken,
          5_000,
        );
        checks.push({
          name: "terminal returns to prompt after long-running command",
          status: settleTokenSeen ? "pass" : "fail",
          detail: settleTokenSeen
            ? settleToken
            : "terminal did not confirm prompt-ready state after long-running command",
        });

        await page.getByLabel("Hide terminal").click();
        await page.waitForTimeout(5000);
        await page.getByTestId("workspace-topbar-terminal").click();
        await page.waitForSelector('[data-testid="session-terminal-drawer"]', {
          timeout: 20_000,
        });
        const liveAfterExpiry = await waitForTerminalLive(page);
        const oldOutputSeenAfterExpiry = await waitForTerminalOutput(
          page,
          settleToken,
          3_000,
        );
        const expiredTerminalLookup = await getTerminalSession(
          baseUrl,
          sessionId,
          browserInstanceId,
          tabId,
        );
        const expiredTerminalId = expiredTerminalLookup.terminal?.id;
        checks.push({
          name: "detached prompt terminal expires and reopens clean",
          status:
            liveAfterExpiry &&
            !oldOutputSeenAfterExpiry &&
            Boolean(expiredTerminalId) &&
            expiredTerminalId !== firstTerminalId
              ? "pass"
              : "fail",
          detail:
            liveAfterExpiry &&
            !oldOutputSeenAfterExpiry &&
            expiredTerminalId &&
            expiredTerminalId !== firstTerminalId
              ? `expired ${firstTerminalId}, reopened ${expiredTerminalId}`
              : `expected new live terminal id after TTL, got ${expiredTerminalId ?? "missing"} live=${liveAfterExpiry} replay=${oldOutputSeenAfterExpiry}`,
        });

        await page.screenshot({
          path: path.join(run.rootDir, "screenshots/session-after-refresh.png"),
          fullPage: true,
        });

        await browser.close();
      } finally {
        await browser.close().catch(() => {});
      }
    } finally {
      server.kill();
      run.writeText(
        "server-stdout.txt",
        await new Response(server.stdout).text(),
      );
      run.writeText(
        "server-stderr.txt",
        await new Response(server.stderr).text(),
      );
    }
  } catch (error) {
    checks.push({
      name: "terminal browser validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const overallStatus = combineValidationStatus(
    checks.map((check) => check.status),
  );
  run.writeJson("report.json", {
    runId: run.runId,
    status: overallStatus,
    checks,
    baseUrl,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("Terminal browser validation", checks, [
      "This lane validates that a session page can open the terminal drawer from the topbar and that refresh does not auto-open it.",
    ]),
  );
  writeFileSync(
    path.resolve(
      process.cwd(),
      "storage/artifacts/validation/latest-go-terminal.txt",
    ),
    `${run.rootDir}\n`,
  );
  writeFileSync(
    path.resolve(
      process.cwd(),
      "storage/artifacts/validation/latest-terminal.txt",
    ),
    `${run.rootDir}\n`,
  );
  console.log(`Terminal validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
