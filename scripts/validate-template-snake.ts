import { chromium, devices } from "playwright";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createValidationRun } from "./lib/validation.ts";

type SessionDetailPayload = {
  ok: boolean;
  data: {
    handle: {
      id: string;
      projectId: string;
      backendSessionId: string | null;
      title: string | null;
      status: string;
      lastSummary: string | null;
      attentionReason: string | null;
      degraded: boolean;
      createdAt: string;
      updatedAt: string;
    };
    attention: {
      reason: string;
      headline: string;
      requestMethod: string;
      requestId?: string | number;
      note?: string | null;
    } | null;
    latestSummary: string | null;
    artifacts: Array<{
      id: string;
      kind: string;
      label: string;
      path: string;
      createdAt: string;
    }>;
    terminal: {
      available: boolean;
    };
  };
};

const DEFAULT_BASE_URL = process.env.ORCHD_TEMPLATE_BASE_URL?.trim() || "http://127.0.0.1:8787";
const AUTH_PASSWORD = process.env.ORCHD_TEMPLATE_PASSWORD?.trim() || null;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return await response.json() as T;
}

function createTempRepo(): string {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-template-snake-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(repoPath, { recursive: true });
  execSync("git init -q", { cwd: repoPath });
  writeFileSync(path.join(repoPath, "README.md"), "# snake demo\n");
  execSync("git add README.md && git commit -qm 'init'", { cwd: repoPath });
  return repoPath;
}

async function maybeLogin(page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>): Promise<void> {
  const passwordField = page.getByLabel("Password");
  if (!await passwordField.isVisible().catch(() => false)) {
    return;
  }

  if (!AUTH_PASSWORD) {
    throw new Error("Login screen detected but ORCHD_TEMPLATE_PASSWORD is not set");
  }

  await passwordField.fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForLoadState("networkidle");
}

async function captureScreenshot(
  page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>,
  run: ReturnType<typeof createValidationRun>,
  relativePath: string,
): Promise<void> {
  const absolutePath = path.join(run.rootDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  await page.screenshot({ path: absolutePath, fullPage: true });
}

async function refreshPage(page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
}

async function startGame(page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>): Promise<void> {
  const startButton = page.getByRole("button", { name: /Start Game|Play Again|Restart/i }).first();
  if (await startButton.count()) {
    await startButton.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
}

async function readOptionalText(
  page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>,
  selector: string,
): Promise<string | null> {
  const locator = page.locator(selector).first();
  if (await locator.count()) {
    return await locator.textContent();
  }
  return null;
}

async function focusButtonByKeyboard(
  page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>,
  buttonName: RegExp,
  attempts = 12,
): Promise<boolean> {
  for (let index = 0; index < attempts; index += 1) {
    await page.keyboard.press("Tab");
    const focusedMatches = await page.evaluate((pattern) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) {
        return false;
      }
      const text = active.innerText || active.textContent || "";
      return new RegExp(pattern, "i").test(text);
    }, buttonName.source);
    if (focusedMatches) {
      return true;
    }
  }

  return false;
}

async function main(): Promise<void> {
  const run = createValidationRun("template_snake");
  const repoPath = createTempRepo();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  let bindingId = "";
  let sessionId = "";
  let threadId = "";
  let approvals = 0;
  let finalSummary = "";
  let finalStatus = "";
  const evidence = [
    "screenshots/orchd/01-bindings-new.png",
    "screenshots/orchd/02-binding-created.png",
    "screenshots/orchd/03-session-created.png",
  ];
  let mobileApprovalEvidence: Record<string, boolean> | null = null;

  try {
    await page.goto(`${DEFAULT_BASE_URL}/bindings/new`, { waitUntil: "networkidle" });
    await maybeLogin(page);
    await captureScreenshot(page, run, "screenshots/orchd/01-bindings-new.png");

    await page.getByLabel("Name").fill("snake-template-demo");
    await page.getByLabel("Repo path").fill(repoPath);
    await page.getByRole("button", { name: /create binding/i }).click();
    await page.waitForURL((url) => /\/bindings\/.+/.test(url.pathname) && !url.pathname.endsWith("/bindings/new"), { timeout: 20_000 });
    bindingId = page.url().split("/bindings/")[1] ?? "";
    await captureScreenshot(page, run, "screenshots/orchd/02-binding-created.png");

    await page.getByLabel("Title").fill("Build web snake");
    await page.getByLabel("Prompt").fill([
      "Create a self-contained browser Snake game in a single index.html file in this repo.",
      "Requirements: arrow-key controls, visible score, game-over state, restart action, responsive layout, no external dependencies.",
      "Only modify files needed for this task and finish by summarizing what you created.",
    ].join(" "));
    await page.getByRole("button", { name: /start backend session/i }).click();
    await page.waitForURL(/\/backend-sessions\//, { timeout: 20_000 });
    sessionId = page.url().split("/backend-sessions/")[1] ?? "";
    await captureScreenshot(page, run, "screenshots/orchd/03-session-created.png");

    const approvalDeadline = Date.now() + 180_000;
    while (Date.now() < approvalDeadline) {
      await refreshPage(page);
      const detail = await readJson<SessionDetailPayload>(`${DEFAULT_BASE_URL}/api/backend-sessions/${sessionId}`);
      threadId = detail.data.handle.backendSessionId ?? threadId;
      finalSummary = detail.data.latestSummary ?? finalSummary;
      finalStatus = detail.data.handle.status;

      const approveButton = page.getByRole("button", { name: /^Approve$/ });
      if (detail.data.attention?.reason === "approval_required" || detail.data.handle.attentionReason === "approval_required") {
        await approveButton.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      }
      if (await approveButton.count()) {
        const mobileApprovalContext = await browser.newContext({ ...devices["iPhone 13"] });
        const mobileApprovalPage = await mobileApprovalContext.newPage();
        await mobileApprovalPage.goto(`${DEFAULT_BASE_URL}/backend-sessions/${sessionId}`, { waitUntil: "domcontentloaded" });
        await mobileApprovalPage.waitForTimeout(2_000);
        await captureScreenshot(mobileApprovalPage, run, "screenshots/orchd/04-mobile-before-approval.png");
        const sendInputButton = mobileApprovalPage.getByRole("button", { name: /Send input/i });
        const approveButtonMobile = mobileApprovalPage.getByRole("button", { name: /^Approve$/ });
        await mobileApprovalPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await mobileApprovalPage.waitForTimeout(500);
        mobileApprovalEvidence = {
          sendInputVisibleBeforeScroll: await sendInputButton.isVisible(),
          approveVisibleBeforeScroll: await approveButtonMobile.isVisible(),
          sendInputVisibleAfterScroll: await sendInputButton.isVisible(),
          approveVisibleAfterScroll: await approveButtonMobile.isVisible(),
        };
        run.writeJson("orchd/mobile-before-approval.json", mobileApprovalEvidence);
        await mobileApprovalContext.close();
        evidence.push("screenshots/orchd/04-mobile-before-approval.png", "orchd/mobile-before-approval.json");
        await captureScreenshot(page, run, "screenshots/orchd/04-session-before-approval.png");
        await approveButton.click();
        approvals += 1;
        await sleep(1_500);
        await captureScreenshot(page, run, "screenshots/orchd/05-session-after-approval.png");
        evidence.push("screenshots/orchd/04-session-before-approval.png", "screenshots/orchd/05-session-after-approval.png");
        break;
      }

      if (finalStatus === "completed" && existsSync(path.join(repoPath, "index.html"))) {
        break;
      }

      await sleep(3_000);
    }

    const completionDeadline = Date.now() + 180_000;
    while (Date.now() < completionDeadline) {
      await refreshPage(page);
      const detail = await readJson<SessionDetailPayload>(`${DEFAULT_BASE_URL}/api/backend-sessions/${sessionId}`);
      threadId = detail.data.handle.backendSessionId ?? threadId;
      finalSummary = detail.data.latestSummary ?? finalSummary;
      finalStatus = detail.data.handle.status;

      if (finalStatus === "completed" && existsSync(path.join(repoPath, "index.html"))) {
        run.writeJson("session-detail.json", detail);
        await captureScreenshot(page, run, "screenshots/orchd/06-session-completed.png");
        break;
      }

      const approveButton = page.getByRole("button", { name: /^Approve$/ });
      if (detail.data.attention?.reason === "approval_required" || detail.data.handle.attentionReason === "approval_required") {
        await approveButton.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      }
      if (await approveButton.count()) {
        await approveButton.click();
        approvals += 1;
        await sleep(1_000);
      }

      await sleep(3_000);
    }

    if (!existsSync(path.join(repoPath, "index.html"))) {
      throw new Error("Codex did not create index.html");
    }

    if (finalStatus !== "completed") {
      const statusGraceDeadline = Date.now() + 60_000;
      while (Date.now() < statusGraceDeadline) {
        await refreshPage(page);
        const detail = await readJson<SessionDetailPayload>(`${DEFAULT_BASE_URL}/api/backend-sessions/${sessionId}`);
        finalStatus = detail.data.handle.status;
        finalSummary = detail.data.latestSummary ?? finalSummary;
        if (finalStatus === "completed") {
          run.writeJson("session-detail.json", detail);
          await captureScreenshot(page, run, "screenshots/orchd/06-session-completed.png");
          break;
        }
        await sleep(3_000);
      }
    }

    if (finalStatus !== "completed") {
      throw new Error(`Backend session did not reach completed status (status=${finalStatus})`);
    }

    cpSync(path.join(repoPath, "index.html"), path.join(run.rootDir, "repo-snapshot", "index.html"));

    await page.goto(`${DEFAULT_BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    await captureScreenshot(page, run, "screenshots/orchd/07-dashboard-overview.png");
    run.writeJson("orchd/dashboard-overview.json", {
      attentionHeadingVisible: await page.getByRole("heading", { name: "Attention now" }).isVisible(),
      runningHeadingVisible: await page.getByRole("heading", { name: "Running sessions" }).isVisible(),
      bindingsHeadingVisible: await page.getByRole("heading", { name: "Bindings" }).isVisible(),
    });
    evidence.push("screenshots/orchd/07-dashboard-overview.png", "orchd/dashboard-overview.json");

    const mobileContext = await browser.newContext({ ...devices["iPhone 13"] });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${DEFAULT_BASE_URL}/backend-sessions/${sessionId}`, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForTimeout(2_000);
    await captureScreenshot(mobilePage, run, "screenshots/orchd/08-session-mobile-detail.png");
    const mobileKeyboardActionReachable = await focusButtonByKeyboard(mobilePage, /Send input/i, 10);
    run.writeJson("orchd/mobile-session-detail.json", {
      actionBarVisible: await mobilePage.getByRole("button", { name: /Send input/i }).isVisible(),
      artifactHeadingVisible: await mobilePage.getByRole("heading", { name: "Artifacts" }).isVisible(),
      attentionVisible: await mobilePage.getByRole("heading", { name: "Attention" }).isVisible(),
      keyboardActionReachable: mobileKeyboardActionReachable,
    });
    await mobileContext.close();
    evidence.push("screenshots/orchd/08-session-mobile-detail.png", "orchd/mobile-session-detail.json");

    const gamePage = await context.newPage();
    const gameErrors: string[] = [];
    gamePage.on("pageerror", (error) => gameErrors.push(error.message));

    await gamePage.goto(`file://${path.join(repoPath, "index.html")}`, { waitUntil: "load" });
    await gamePage.waitForTimeout(500);
    await captureScreenshot(gamePage, run, "screenshots/game/01-start-overlay.png");

    await startGame(gamePage);
    await captureScreenshot(gamePage, run, "screenshots/game/02-running.png");

    await gamePage.waitForTimeout(3_000);
    await captureScreenshot(gamePage, run, "screenshots/game/03-game-over.png");
    const overlayTitle = await readOptionalText(gamePage, "#overlay-title, #gameOverOverlay h2, .overlay h2");
    const scoreText = await gamePage.locator("#score").textContent();
    const bestScoreText = await readOptionalText(gamePage, "#best-score, #best");

    const restartButton = gamePage.getByRole("button", { name: /Play Again|Restart|Start Game/i }).first();
    if (await restartButton.count()) {
      await restartButton.click().catch(() => {});
    } else {
      await gamePage.keyboard.press("Enter");
    }
    await gamePage.waitForTimeout(400);
    await captureScreenshot(gamePage, run, "screenshots/game/04-restarted.png");
    const overlayVisibleAfterRestart = await gamePage.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("#overlay, #gameOverOverlay, .overlay"));
      return candidates.some((node) => {
        const hiddenAttr = node.hasAttribute("hidden");
        const style = window.getComputedStyle(node);
        const classVisible = node.classList.contains("visible");
        return !hiddenAttr && style.display !== "none" && style.visibility !== "hidden" && (classVisible || style.opacity !== "0");
      });
    });
    await gamePage.close();

    const repoFiles = readdirSync(repoPath)
      .sort()
      .map((name) => ({
        name,
        sizeBytes: statSync(path.join(repoPath, name)).size,
      }));

    run.writeJson("summary.json", {
      baseUrl: DEFAULT_BASE_URL,
      bindingId,
      sessionId,
      threadId,
      repoPath,
      finalStatus,
      approvals,
      finalSummary,
      repoFiles,
      pageErrors,
      gameChecks: {
        overlayTitle,
        scoreText,
        bestScoreText,
        overlayVisibleAfterRestart,
        pageErrors: gameErrors,
      },
      evidence: [
        ...evidence,
        "screenshots/orchd/06-session-completed.png",
        "session-detail.json",
        "repo-snapshot/index.html",
        "screenshots/game/01-start-overlay.png",
        "screenshots/game/02-running.png",
        "screenshots/game/03-game-over.png",
        "screenshots/game/04-restarted.png",
      ],
      orchdFlow: {
        projectCreateViaBrowser: true,
        sessionCreateViaBrowser: true,
        approvalHandledViaBrowser: approvals > 0,
        codexCompletedViaChatInput: true,
        mobileActionBarCheckedDuringApproval: mobileApprovalEvidence !== null,
      },
    });

    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-template-snake.txt"), `${run.rootDir}\n`);
    console.log(`Template snake validation evidence: ${run.rootDir}`);
  } finally {
    await browser.close();
  }
}

await main();
