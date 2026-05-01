<!-- /autoplan restore point: /Users/sorcererxw/.gstack/projects/sorcererxw-orchd/master-autoplan-restore-20260429-213718.md -->
# Hopter CLI Interaction Experience Plan

## Status

Proposed implementation plan. Generated from `/autoplan` intake on 2026-04-29.

## Problem

`hopter` is installed and launched from a terminal, but the CLI still behaves like a thin server wrapper. The first interaction tells the developer what commands exist, but not what Hopter will do, which URL matters, how to recover from common failures, or what to do next.

Current evidence:

- `cmd/hopter/root.go` defines only default serve behavior, `serve`, `doctor`, and `version`; the redesigned public command should be `server`.
- `hopter --help` exposes server flags globally but does not show examples, default ports, browser behavior, or common workflows.
- `hopter serve --help` repeats the same minimal flag list. The new public help should expose `hopter server`; `serve` may remain only as a hidden compatibility alias if needed.
- `hopter doctor` currently bootstraps runtime state, so it can fail because Hopter is already running. That makes doctor a partial runtime probe, not a clean static diagnosis surface.
- Runtime startup currently lets `slog` write internal operational messages into the same default terminal experience a normal user sees.
- `README.md` says install then run `hopter`, but does not document `doctor`, `--relay`, background mode, or package-manager upgrade commands.
- `.goreleaser.yml` already declares a Homebrew service, but it runs plain `hopter serve`; it should run the same canonical `hopter server` entrypoint as the root command.
- Hopter itself does not currently expose a first-class background server lifecycle, so users must keep a terminal open or rely on external service tooling.

## Target User

Primary: a developer who just installed Hopter with Homebrew or npm and runs `hopter` from a local repo or shell.

Secondary:

- Existing Hopter developer using `make dev`, hidden dev proxy support, or `go run ./cmd/hopter`.
- Developer debugging install or runtime problems with `hopter doctor`.
- Developer enabling hosted relay with `hopter --relay`.
- Homebrew user running Hopter as a background service through `brew services`.

## Goals

1. Make `hopter`, `hopter --help`, and `hopter doctor` self-explanatory in the first five minutes.
2. Keep `hopter` as the default launch command.
3. Make every common failure explain: what failed, why it likely happened, and the exact next command or action.
4. Preserve scriptability with stable exit codes and JSON output.
5. Migrate command construction from `urfave/cli/v2` to Cobra so help, examples, command grouping, flag errors, and future completions are first-class.
6. After the server starts, keep the foreground terminal useful: show a compact cheatsheet and support simple keyboard commands to inspect and adjust runtime state.
7. Support background server operation as a first-class lifecycle, both self-managed by Hopter and managed by Homebrew service.

## Non-Goals

- No new agent orchestration behavior.
- No browser IDE.
- No hosted-platform or Cloudflare worker changes.
- No broad configuration system rewrite.
- No rich full-screen TUI framework in the first slice. The runtime input loop should use raw key input for single-key shortcuts, but still avoid full-screen rendering.
- No system-level LaunchDaemon support in this slice. Homebrew service support targets the normal user-level `brew services` path.
- No built-in self-restarting supervisor for Hopter-managed background mode. `hopter server --background` detaches the server; Homebrew service remains the restart-on-failure/start-at-login path.

## Proposed Scope

### 1. Cobra command information architecture

Replace `urfave/cli/v2` command construction with Cobra so the CLI tells a clear story:

- `hopter` reuses the `server` command and starts the local server.
- `hopter server` is the explicit equivalent.
- `hopter doctor` statically validates the local install, configuration, dependencies, environment assumptions, and saved background-server state.
- `hopter version` prints version metadata.

Add:

- Root and command descriptions with examples.
- Cobra `Use`, `Short`, `Long`, `Example`, custom usage, and custom error presentation.
- `--version` support without exposing duplicate or confusing version behavior.
- Explicit examples for local-only, custom port, background, and relay.
- Default browser opening after successful interactive startup.
- Shell completion command only if it comes naturally from Cobra with minimal surface area.
- `hopter server --background`, `hopter stop`, and `hopter doctor` backed by a small local host state file, so foreground terminals can inspect and stop a background server without a separate status command.

### Command Surface

| Command | Parameters |
|---|---|
| `hopter` | Same as `hopter server`: `--port <port>`, `--background`, `--relay`, `--verbose` |
| `hopter server` | `--port <port>`, `--background`, `--relay`, `--verbose` |
| `hopter stop` | `--timeout <duration>` |
| `hopter doctor` | `--json` |
| `hopter version` | none |

Developer-only hidden parameter:

| Command | Hidden parameter |
|---|---|
| `hopter server` | `--dev-proxy-url <url>` |

Bind address is fixed to localhost for the public CLI. Do not expose `--host`, `--no-open`, `--service`, `--reset-auth`, `status`, `start`, `restart`, or `open` in the public command surface.

### 2. Startup output and runtime terminal control

Improve `printServeReady`, relay startup messages, and runtime terminal behavior so successful startup reads like a control panel, not log debris.

Target shape:

```text
Hopter is running

  Local:  http://127.0.0.1:8787
  Mode:   bundled UI

Shortcuts:
  r  print relay status
  d  print doctor suggestions
  h  show shortcuts
  q  stop Hopter
```

For relay mode:

```text
Relay requested

  Login:  https://hopter.dev/login?...
  Status: waiting for browser login
```

Rules:

- Human output goes to stdout.
- Internal structured logs do not print by default in normal user mode.
- Add an explicit debug/log option for internal logs, for example `--verbose` or `HOPTER_LOG=debug`.
- Error text goes to stderr.
- Output remains plain ASCII, no spinner dependency.
- Runtime input is enabled only when stdin is an interactive terminal.
- Non-interactive invocations keep current script behavior and do not block waiting for stdin.
- Interactive startup opens the local browser by default after the HTTP server is ready.
- Background or non-interactive server runs do not open a browser and do not enable raw-key controls.

### 3. Background server modes

Add one explicit self-managed background posture:

```bash
hopter server --background
```

Command semantics:

- `hopter server --background`: same server command, launched as a self-managed background process.
- `hopter server`: foreground process posture. In an external manager such as Homebrew service, non-interactive execution disables browser opening and raw-key controls without needing a special `--service` flag.
- `hopter stop`: read host state, validate the process/server, and request graceful shutdown.
- `hopter`: root command reuses the `server` command, so root and explicit server behavior remain aligned.

Implementation rule: `hopter`, `hopter server`, and `hopter server --background` must share one server startup path, for example `runServer(mode)`. The command layer selects foreground or self-managed background mode; it must not fork separate server implementations.

Shared background behavior:

- no browser auto-open
- no raw TUI / shortcut loop
- user-facing startup summary can go to stdout once, then logs go through the configured logger
- Hopter-managed background mode writes logs to Hopter's local log directory and prints the URL, PID, and log paths from the parent command
- writes a local host state file containing PID, bind URL, browser URL, start time, install source, and mode
- removes or marks the state file stale on graceful shutdown
- keeps the same HTTP server behavior as foreground serve

Homebrew service behavior:

- the formula runs `hopter server` as a normal foreground process
- the external service manager owns process lifetime
- non-interactive execution disables browser opening and raw-key controls
- internal logs are suitable for Homebrew `log_path` / `error_log_path`
- startup and shutdown are compatible with `brew services start|stop|restart hopter`

Update the GoReleaser Homebrew formula service block:

```ruby
service do
  run [opt_bin/"hopter", "server"]
  keep_alive true
  log_path var/"log/hopter.log"
  error_log_path var/"log/hopter.err.log"
end
```

Homebrew's service DSL supports `run`, `keep_alive`, `log_path`, `error_log_path`, and environment variables. Use those rather than shipping a separate plist template unless GoReleaser cannot express the needed service block.

Background mode also creates a product need for foreground inspection through doctor:

- `hopter doctor`: remains static and should include saved background-server state, URL, PID, mode, log paths, and service-oriented suggestions when install source is `homebrew_formula`.

### 4. Runtime control loop

Add a small server-lifetime control loop owned by the CLI layer. It should use raw key mode in interactive terminals so shortcuts do not require pressing Enter:

- `h` or `?`: reprint cheatsheet.
- `r`: print relay status using already-known runtime/relay state.
- `d`: print static doctor suggestions without bootstrapping another runtime.
- `q`: gracefully shut down the server, same shutdown path as `Ctrl+C`.

Constraints:

- Do not put this in backend services.
- Do not make it a full terminal UI dependency yet.
- Do not let keyboard control consume stdin in CI, scripts, pipes, or system service contexts.
- Do not enable it in background or non-interactive server runs.
- Keep all actions testable with injected input/output readers and writers.
- Always restore the terminal mode on `q`, `Ctrl+C`, server startup failure after raw mode is enabled, and panic-safe deferred cleanup paths.

### 5. Doctor as a static recovery surface

Refactor `doctor.Run` so it does not call `app.NewRuntime` and does not open Badger/task stores.

Doctor should statically check:

- executable resolution and execute bit
- config load and port validity
- configured bind address availability with `net.Listen`
- Codex binary availability and version if available
- install source and package-manager upgrade hint
- Homebrew service posture hints when the binary install source is `homebrew_formula`
- relay auth file/keyring presence and shape where detectable without starting relay

Make human output deterministic and actionable:

- Print all check rows before the final failure summary.
- Add a final "Next step" line for known failures.
- For ports already in use, explain which address failed and suggest `hopter --port <free-port>` or stopping the process on that port.
- For missing Codex, suggest installing or fixing PATH.
- For Homebrew service PATH problems, explain that launchd/Homebrew service environments do not inherit the user's shell startup files and suggest configuring a stable Codex path or running foreground mode for diagnosis.
- For relay auth problems, `hopter server --relay` should automatically replace missing, expired, or malformed local auth through the normal login flow. `doctor` should suggest deleting the displayed auth file only when automatic recovery cannot proceed.
- Keep `--json` stable, machine-readable, and without prose mixed into stdout.

### 6. Error vocabulary

Add small, explicit helpers for CLI-facing errors:

- Map known config validation errors to actionable messages.
- Map static doctor failures to recovery suggestions.
- Map runtime startup failures to user copy without leaking internal logs by default.
- Map Hopter-managed background failures to `hopter doctor`, `hopter stop`, and local log file locations.
- Map Homebrew service failures to `brew services restart hopter`, `brew services list`, `hopter doctor`, and log file locations where available.
- Keep wrapped Go errors intact for logs and tests.

This should be a small CLI-layer presentation helper, not a new error framework.

### 7. Tests and validation

Add or update focused tests:

- Root help contains examples and expected commands.
- Serve help documents launch behavior and important flags.
- Cobra unknown command and invalid flag errors are friendly and point to `hopter --help`.
- No public `--reset-auth` flag remains; relay auth reset is handled by `--relay` recovery behavior and doctor suggestions.
- Startup ready output covers local URL, bind URL, mode, and shortcut cheatsheet.
- Runtime control loop handles `h`, `r`, `d`, and `q` through injected input/output.
- Runtime control loop is disabled for non-interactive stdin.
- Runtime control loop is disabled in explicit background and non-interactive server modes.
- Raw key mode restores terminal state on all exits.
- Background and non-interactive server modes disable auto-open and raw TUI.
- Background and service-managed server runs write a host state file and doctor reads it.
- Hopter-managed background mode supports `server --background`, `stop`, and `doctor`.
- Homebrew service block runs `hopter server`.
- Doctor human output orders checks before final failure.
- Doctor JSON output stays parseable and excludes human prose.
- Static doctor does not open the Badger task store and therefore does not fail solely because Hopter is already running.
- Known port and missing Codex failures include actionable next steps.

Validation lane:

```bash
go test ./cmd/hopter ./internal/doctor ./internal/app
go run ./cmd/hopter --help
go run ./cmd/hopter server --help
go run ./cmd/hopter doctor --json
bun scripts/validate-goreleaser.ts
```

If the live stack is already running, `doctor --json` should remain parseable and should not fail because of the task-store lock. It may still fail if the configured HTTP address is occupied, but that should be reported as a static bind-address check with a recovery hint.

## What Already Exists

| Sub-problem | Existing code | Reuse decision |
|---|---|---|
| Command tree | `cmd/hopter/root.go` | Replace `urfave/cli/v2` with Cobra command construction. |
| Server flags | `serveFlags()` | Port flag definitions to Cobra/pflag and keep names stable while exposing the public command as `server`. |
| Startup ready output | `printServeReady()` | Reuse; make output clearer and include UI mode. |
| Relay login flow | `maybeStartRelay()` and related helpers | Reuse; improve terminal copy only. |
| Doctor checks | `internal/doctor/doctor.go` | Refactor to static checks and actionable result metadata. |
| Config defaults | `internal/app/config.go` | Reuse; avoid config rewrite. |
| Background lifecycle | `cmd/hopter` | Add `server --background` and `stop`; doctor reads saved state; share one server startup path. |
| Homebrew service packaging | `.goreleaser.yml` | Update service command to `server`; keep log paths. |
| Tests | `cmd/hopter/root_test.go`, `internal/app/config_test.go` | Extend focused tests around Cobra commands, runtime input, doctor output, and failure messages. |

## Initial Architecture Sketch

```text
user terminal
    |
    v
cmd/hopter/main.go
    |
    v
cmd/hopter/root.go
    |-- Cobra root + server command help
    |-- runServe()
    |-- printServeReady()
    |-- runtime control loop
    |-- background/service-managed state writer
    |-- background stop command
    |-- relay status output
    |
    +--> cmd/hopter/doctor.go
             |
             v
        internal/doctor.Run()
             |
             v
        internal/app.LoadConfig()
        static bind/dependency/install checks
```

## NOT In Scope

| Deferred item | Rationale |
|---|---|
| Full-screen TUI framework | Raw-key host shortcuts give the user cheatsheet and dynamic control without adding Bubble Tea/tcell-style rendering complexity yet. |
| Runtime control over browser internals | First slice can print relay/status/doctor suggestions and quit foreground mode. Changing sessions/projects from terminal risks duplicating browser UI. |
| Cloud relay behavior changes | This pass changes CLI wording and recovery only. Hosted relay service semantics stay out of scope. |
| Full docs site rewrite | README and contributor notes may be touched, but this is not a docs redesign. |

## Acceptance Criteria

- A new user can run `hopter --help` and understand the top three workflows without opening source code.
- A normal `hopter` run does not print internal structured logs by default.
- After server startup, an interactive terminal opens the browser by default, shows a shortcut cheatsheet, and accepts raw single-key `h`, `r`, `d`, and `q`.
- `hopter server --background` detaches Hopter into the background without browser auto-open or TUI, then prints URL, PID, and log paths.
- `hopter stop` operates through the state file and graceful shutdown path.
- Homebrew service runs `hopter server`; non-interactive execution disables browser auto-open and TUI.
- `hopter doctor` reports static install/config/dependency checks plus saved background-server state and recovery suggestions.
- `hopter doctor` performs static checks only and gives concrete recovery suggestions.
- `hopter doctor --json` remains valid JSON on pass and fail.
- Startup output gives the browser URL, bind URL when different, UI mode, and shortcut cheatsheet.
- Tests cover human output and JSON/scriptability separately.
- Focused validation evidence is recorded after implementation.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | Phase 0 | Create a plan file because the user invoked `/autoplan` without an existing plan file. | Mechanical | Bias toward action | `/autoplan` needs a concrete artifact to review and update. The repo already stores feature plans in `docs/planning/`. | Waiting for the user to draft a plan first. |
| 2 | Phase 0 | Treat this as CLI Tool plus Documentation DX scope. | Mechanical | Explicit over clever | The request names Hopter CLI interaction, and code evidence is `cmd/hopter/*`, README install flow, and terminal output. | Treating this as backend-only. |
| 3 | Phase 0 | Skip `/office-hours` prerequisite and proceed with standard review. | Mechanical | Bias toward action | The user explicitly invoked `/autoplan`; the task has enough code evidence for an initial plan. Premises still require confirmation before deeper phases. | Starting an interactive prerequisite workflow. |
| 4 | Phase 1 | Replace `urfave/cli/v2` with Cobra as part of the plan baseline. | User-confirmed premise | User direction | User explicitly wants Cobra, and Cobra's documented command/examples/flag model matches the desired CLI polish. | Keeping `urfave/cli/v2`. |
| 5 | Phase 1 | Add an interactive server-lifetime control loop with shortcut cheatsheet. | User-confirmed premise | Completeness | User wants runtime state adjustment after server startup. Raw-key host controls give the requested TUI-like feel without jumping to a full-screen framework. | Static startup output only. |
| 6 | Phase 1 | Make `doctor` static-only with recovery suggestions. | User-confirmed premise | Explicit over clever | User clarified doctor should not bootstrap runtime. Static checks avoid false failures from the single-runtime lock. | Runtime bootstrap inside doctor. |
| 7 | Phase 1 | Add first-run browser opening and existing-instance commands to the plan. | Taste | Completeness | Codex correctly flagged that explaining a URL is weaker than removing the URL step. This stays aligned with browser-first product strategy. | Only improving startup copy. |
| 8 | Phase 1 | Bound runtime terminal control to host-level actions only. | Mechanical | Explicit over clever | The terminal loop should show status/doctor suggestions and quit. It must not become a second session/project UI. | Session/project manipulation from terminal shortcuts. |
| 9 | Phase 1 | Treat relay shortcuts as deferred unless relay mode is active. | Mechanical | Pragmatic | Relay is active in code but still strategically sensitive. Showing relay controls outside relay mode makes deferred hosted behavior feel core. | Always showing relay status in the cheatsheet. |
| 10 | Phase 2 | Treat terminal output as UI scope and require explicit states. | Mechanical | Completeness | Startup, ready, degraded, error, and shutdown states are user-visible UI. | Skipping design review because there is no browser component. |
| 11 | Phase 3 | Keep Cobra migration as one coherent CLI slice, not an opportunistic refactor. | Taste | User direction | The user explicitly requested Cobra. The plan must offset framework churn with clear acceptance tests and stable command behavior. | Minimal urfave patch only. |
| 12 | Phase 3.5 | Promote install-to-browser-open and first-session success as DX metrics. | Mechanical | User outcome | Help text is not the end goal. A developer should get from install to browser and first Codex-backed session fast. | Measuring help text quality only. |
| 13 | Final gate | Open browser by default after successful interactive startup. | User-confirmed premise | User outcome | User explicitly chose default browser opening. This removes the URL-copy step and matches the browser-first product wedge. | Print URL only by default. |
| 14 | Final gate | Use raw single-key shortcuts instead of line-oriented input. | User-confirmed premise | User direction | User explicitly chose no-Enter shortcuts. Implementation must add terminal mode cleanup tests to make this safe. | Requiring Enter for shortcuts. |
| 15 | Final gate | Support Homebrew service without a public `--service` flag. | User-confirmed premise | Completeness | User needs Homebrew service support but said `--service` is unnecessary. The formula should run `hopter server`; non-interactive execution disables browser opening and TUI. | Public `--service` flag. |
| 16 | Final gate | Support Hopter-managed background server lifecycle through `server`. | User-confirmed premise | Completeness | User clarified that Hopter server itself should support background mode, then removed `start/restart/open/status`. `server --background`, `stop`, and `doctor` keep server logic unified. | Separate `start`, `restart`, `open`, and `status` commands. |

## Phase 0 Intake

Base branch: `master`.

UI scope: yes, narrowly. CLI terminal output is user-visible interaction design, but no browser UI component scope is currently planned.

DX scope: yes. Hopter is a developer tool, and this plan changes CLI commands, flags, terminal output, docs, and error recovery.

Loaded review tracks:

- CEO review
- Design review for terminal information hierarchy, startup states, and cheatsheet control states
- Engineering review
- Developer experience review

## Phase 1 CEO Review, Premise Gate Draft

### 0A. Premise Challenge

| Premise | Evidence | Risk if wrong | Initial recommendation |
|---|---|---|---|
| The CLI is a meaningful first-run surface, not just an implementation detail. | README install flow ends with `hopter`; current help and startup output are the first user touchpoints. | Users hit friction before reaching the browser workspace. | Accept. |
| Improve user-facing CLI output before adding many product commands. | Current commands are few; confusion is in help, startup, doctor, relay messages, and log noise. | Adding commands may make a small product feel larger without reducing first-run failure. | Accept, but include runtime shortcuts. |
| Keep `hopter` as the default launch command. | README and current root action already use this. | Moving launch behind `hopter serve` breaks the simplest install path. | Accept. |
| Cobra is the right CLI framework baseline. | User explicitly requested it; official Cobra docs support command examples, POSIX flags, custom errors, and modern Go CLI structure. | Framework migration touches the command tree and tests, but it pays for long-term CLI quality. | Accept. |
| Doctor should be static-only. | Current runtime bootstrap creates a lock failure when Hopter is already running. | If doctor starts runtime, the recovery command can itself trip over normal runtime state. | Accept. |
| A running server should keep listening for terminal input. | User wants TUI-like cheatsheet and dynamic runtime adjustment after startup. | If scoped too broadly, terminal control duplicates browser UI; raw mode also risks damaging shell state if not restored. | Accept raw-key host controls with terminal restore tests. |

### 0B. Existing Code Leverage Map

| User problem | Existing leverage | Plan impact |
|---|---|---|
| "How do I start Hopter?" | Root action calls `runServe`; README says `hopter`. | Make root help and startup output teach this path. |
| "Which URL do I open?" | `localBrowserURL()` and `printServeReady()`. | Preserve logic; improve output labels and mode. |
| "Why did it fail?" | `doctor.Run()` and existing config errors. | Refactor doctor to static checks, deterministic human output, JSON, and next steps. |
| "Can I automate this?" | `doctor --json`, command writer injection after Cobra migration. | Keep JSON clean and test stdout/stderr separation. |
| "How do I use relay?" | `--relay`, OAuth URL generation, relay status messages. | Improve copy and recovery without changing relay semantics. |
| "What can I do while server is running?" | `runServe()` already owns server lifetime and signal shutdown. | Add CLI-owned input loop with shortcuts and graceful shutdown. |
| "How do I run Hopter in the background?" | `.goreleaser.yml` already has a Homebrew service block, but Hopter itself has no direct background lifecycle. | Add `hopter server --background`, `hopter stop`, and `hopter doctor`; Homebrew service runs `hopter server`. |

### 0C. Dream State Diagram

```text
CURRENT
  install -> run hopter -> terse terminal output + internal logs -> browser if user understands URL
       \-> failure -> mixed stdout/stderr or runtime doctor lock -> user guesses next step

THIS PLAN
  install -> run hopter -> clear local URL + bind + mode + cheatsheet
       \-> browser opens by default
       \-> running terminal accepts raw-key h/o/r/d/q
       \-> hopter server --background detaches local server in background
       \-> brew services starts hopter server in background
       \-> foreground hopter doctor/stop inspect or stop the background host
       \-> help -> Cobra examples for local/dev/relay/debug
       \-> static doctor -> named problem + cause + recovery suggestion

12-MONTH IDEAL
  install -> run hopter -> browser opens or deep link is obvious
       \-> doctor statically detects environment, Codex, relay auth, update ownership
       \-> docs and CLI share examples generated from one source
       \-> support asks for one doctor JSON artifact, not a screenshot
```

### 0C-bis. Implementation Alternatives

| Approach | Effort | Risk | Pros | Cons | Recommendation |
|---|---:|---:|---|---|---|
| A. Polish current `urfave/cli/v2` app and doctor output | 1-2 days human, ~30-45 min CC | Low | Minimal diff. | Does not match user's framework direction and keeps weaker help/error affordances. | Reject. |
| B. Migrate to Cobra, add static doctor, user-friendly output, browser auto-open, raw-key host shortcuts, Hopter-managed background lifecycle, and Homebrew service support | 5-7 days human, ~3-4 hr CC | Medium | Matches user direction, supports foreground, self-managed background, and Homebrew-managed run postures, removes URL friction. | Touches command setup, terminal mode handling, process detach, service packaging, state file, and tests. Must keep one shared server startup path. | Choose B. |
| C. Cobra plus full-screen TUI framework | 1-2 weeks human, ~3-5 hr CC | High | Richest terminal control. | Too much terminal product surface; risks fighting browser-first positioning. | Defer. |

### 0D. Mode-Specific Analysis

Selected mode: SELECTIVE EXPANSION.

Accepted in baseline:

- Improve root/server/doctor/version help and examples.
- Migrate command construction to Cobra.
- Improve startup and relay status output while hiding internal logs by default.
- Open browser by default after interactive startup.
- Add raw-key runtime shortcuts for interactive terminals.
- Add `server --background`, `stop`, and host state file support read by doctor, with one shared server startup implementation.
- Make doctor static-only, deterministic, and actionable.
- Preserve JSON/scriptability.
- Add focused tests and validation evidence.

Potential expansion to decide later:

- Add an explicit browser-opening command only if users repeatedly ask for it after `status` prints the URL.

Deferred:

- Interactive setup wizard.
- Full-screen TUI framework.
- Full docs redesign.

### 0E. Temporal Interrogation

| Time | What should happen |
|---|---|
| Hour 1 | User sees clearer Cobra help and understands `hopter` starts a local browser control plane. |
| Hour 2 | User sees no internal log noise, browser opens automatically, gets a shortcut cheatsheet, and can quit/status-check from the terminal without pressing Enter. |
| Hour 6+ | User can run Hopter in foreground, Hopter-managed background mode, or Homebrew service mode, then use `hopter doctor` and `hopter stop` to inspect and control it. User can diagnose invalid port, missing Codex, relay auth, service PATH, and bind failures without source diving. |
| Month 1 | Support and docs can ask users for `hopter doctor --json` as the single debug artifact. |
| Month 6 | CLI remains small; richer product work stays in the browser control plane. |

### 0F. Mode Selection Confirmation

SELECTIVE EXPANSION is the right review mode. The user has expanded the baseline to Cobra plus runtime terminal control, so the review should boil the lake inside `cmd/hopter`, `internal/doctor`, first-run docs, and the narrow server-lifetime control loop while deferring full-screen terminal-product ambitions.

## Phase 1 CEO Review

### 0.5 Dual Voices

Claude subagent: unavailable. The subagent did not return within the review window and was shut down.

CODEX SAYS (CEO, strategy challenge): Codex found 12 strategic concerns. The strongest points:

- The active product success criterion is browser-based session continuity, not prettier help text.
- The plan should eliminate the URL step where possible: auto-open browser for foreground startup, detect an existing instance, and expose saved server URL through `hopter doctor`.
- Cobra is a user-confirmed implementation direction, but not by itself a product strategy. The migration must pay for itself with help quality, error quality, completion, and future command structure.
- Terminal shortcuts risk becoming a second control plane. Keep them host-level only.
- Static `doctor` is useful, but a passing doctor must not imply the browser/Codex control loop is healthy.
- App-server version compatibility is a strategic dependency and should be checked or warned about.

CEO DUAL VOICES, CONSENSUS TABLE:

```text
Dimension                            Claude  Codex       Consensus
──────────────────────────────────── ─────── ─────────── ─────────────────────────────────────
1. Premises valid?                   N/A     Mixed       PARTIAL, user-confirmed but sharpened
2. Right problem to solve?           N/A     Mixed       DISAGREE, activation must include browser open/session success
3. Scope calibration correct?        N/A     Too broad   DISAGREE, terminal loop needs hard boundary
4. Alternatives sufficiently explored?N/A    No          DISAGREE, minimal urfave patch was dismissed too fast
5. Competitive/market risks covered? N/A     No          DISAGREE, Codex/GitHub/Cursor remote-agent surfaces matter
6. 6-month trajectory sound?         N/A     Risky       DISAGREE, terminal shortcuts can age badly
```

Source: `codex-only`. Consensus confirmed: 0/6. Disagreements surfaced at final gate: 5.

### 1. Architecture Review

Examined `cmd/hopter/root.go`, `cmd/hopter/doctor.go`, `internal/doctor/doctor.go`, `internal/app/config.go`, and `internal/app/bootstrap.go`.

Findings:

| Issue | Severity | Auto-decision | Rationale |
|---|---|---|---|
| Cobra migration touches all command construction and tests. | Medium | Keep, but require stable command behavior tests. | User explicitly wants Cobra. The plan is valid if framework churn buys cleaner help/errors and does not change runtime semantics. |
| Runtime input loop can become a second product surface. | High | Bound to host lifecycle actions only. | Browser remains primary for sessions/projects. Terminal controls are for the running host: relay info, doctor suggestions, quit. |
| Static doctor should not call `app.NewRuntime`. | High | Required. | Current doctor can fail on Badger lock when Hopter is already running. That is a recovery tool causing a recovery problem. |
| App-server/Codex compatibility is missing from doctor. | High | Add static Codex/app-server compatibility check where available. | Hopter depends on Codex app-server. The CLI should warn if Codex is missing or too old for known Hopter expectations. |

Architecture delta:

```text
main.go
  -> newRootCommand(version, installSource)
      -> server command / default RunE
          -> LoadConfigWithOptions
          -> NewRuntime
          -> start HTTP server
          -> print ready panel
          -> optional interactive host control loop
      -> doctor command
          -> static doctor.Run
      -> version command
      -> background stop command and doctor-backed host state discovery
```

### 2. Error & Rescue Registry

| Error path | Trigger | User sees | Rescue | Test |
|---|---|---|---|---|
| Invalid port | `--port 0`, negative, or >65535 where Cobra/config rejects | `Port must be between 1 and 65535.` | Use `hopter --port 8788`. | Cobra/config unit test |
| Port occupied | Static bind check fails | `Port 8787 is already in use.` | Stop existing process or run `hopter --port <free-port>`. | Doctor static test with listener |
| Missing Codex | `codex` absent from PATH | `Codex is not available on PATH.` | Install Codex or fix PATH. | Doctor path injection test |
| Already running | Existing Hopter serves configured port | `Hopter appears to already be running.` | Run `hopter doctor`, open the printed URL, or stop the existing process. | Existing-instance detection test |
| Relay auth absent/stale | `--relay` without usable credential | Login URL and waiting state | Browser login replaces missing, expired, or malformed local auth. | Relay output test |
| Non-interactive stdin | CI or pipe | No shortcut loop, no hang | Normal server lifecycle. | Input mode test |
| Unknown command | `hopter serbe` | Friendly error plus help hint | Run `hopter --help`. | Cobra command test |

### 3. Security & Threat Model

Examined CLI changes against the product boundary: local Go server, localhost dev auth, browser-first control plane, optional relay.

No new network trust boundary is introduced by Cobra or static doctor. Risks are local:

- automatic and shortcut-driven browser opening should only open a URL derived from trusted local config, not arbitrary user input.
- `doctor --json` must not leak secrets. Relay checks should report presence/shape, not token values.
- Runtime shortcuts must not expose session/project mutations from the terminal. That would duplicate browser authorization assumptions.
- Verbose logs must remain opt-in, because default terminal output may contain local paths, command details, or diagnostics that users paste into support channels.

### 4. Data Flow & Interaction Edge Cases

| Flow | Happy path | Shadow paths | Plan requirement |
|---|---|---|---|
| `hopter` startup | Server starts, ready panel prints, browser opens by default when interactive | bind failure, runtime bootstrap failure, non-interactive stdin, opener failure, background/service mode | Friendly error, no internal logs, no input-loop hang, URL fallback |
| `hopter server --background` | Detaches server into background | existing instance, log path unwritable, child exits before ready, PID reuse | Clear parent result, state file, log paths, stale/offline recovery |
| `hopter stop` | Controls Hopter-managed background server | stale state, PID reused, already stopped, shutdown timeout | Honest state reporting and graceful shutdown |
| `hopter server` under Homebrew service | Server starts under Homebrew service | no TTY, minimal PATH, log file writable/unwritable, Codex absent from launchd PATH | No auto-open/TUI, useful logs, state file, service recovery suggestions |
| `hopter doctor` | Reads static config and saved state file | stale state, server offline, port changed | Honest stale/offline output and cleanup suggestion without runtime bootstrap |
| Runtime shortcut `q` | Graceful shutdown via same path as signal | repeated `q`, shutdown timeout, raw terminal cleanup | Idempotent shutdown, restored terminal mode, and clear exiting line |
| `doctor --json` | Valid JSON report | failures, warnings, partial checks | Always JSON on stdout, exit non-zero only for fail |
| `doctor` human | Check table then summary | multiple failures | Show highest-priority next step, no mixed stderr race |

### 5. Code Quality Review

Primary risk is over-abstracting a small CLI. The plan should add:

- A Cobra command builder in `cmd/hopter` with injected `io.Reader`, `io.Writer`, `ErrWriter`, opener, and runtime-control dependencies for tests.
- A small doctor report schema with optional `Suggestion`, not a large error framework.
- A `hostControlLoop` or similar CLI-layer type that does not import browser/session packages beyond what `runServe` already owns.

No separate package is needed unless the command file becomes unreasonably large. A future split can happen after tests reveal real complexity.

### 6. Test Review

Test diagram:

```text
Cobra command tree
  ├─ root help
  ├─ server help
  ├─ version
  ├─ unknown command
  └─ invalid flag
  └─ stop

Server startup output
  ├─ bundled UI mode
  ├─ dev proxy mode
  ├─ bind differs from browser URL
  ├─ relay requested/login/waiting
  └─ no default internal logs

Runtime control loop
  ├─ h/? reprints shortcuts
  ├─ r prints relay status only when relay is active
  ├─ d prints static doctor suggestions
  ├─ q triggers graceful shutdown
  └─ non-interactive stdin disables loop

Background/server service mode
  ├─ server --background detaches server and reports PID/logs
  ├─ hopter stop uses graceful shutdown
  ├─ Homebrew service runs hopter server
  ├─ non-interactive server disables auto-open
  ├─ non-interactive server disables raw TUI
  ├─ writes host state file after ready
  ├─ removes/marks stale on shutdown
  ├─ stop consumes state file
  ├─ doctor reads state file
  └─ Homebrew formula service command uses server

Doctor
  ├─ executable/config/install checks
  ├─ bind-address occupied check
  ├─ Codex missing check
  ├─ JSON success/failure shape
  └─ no app.NewRuntime / no Badger lock
```

Gaps to add before implementation is complete:

- Test static doctor with a live Badger lock to prove it no longer opens the store, or inject a fake runtime opener count and assert zero calls.
- Test stdout/stderr split for doctor human output.
- Test `HOPTER_LOG=debug` or `--verbose` behavior if implemented.

### 7. Performance Review

No hot-path performance risk. Startup should avoid blocking on Codex version probing for too long. Static doctor may run `codex --version`; cap it with a short timeout, for example 2 seconds.

### 8. Observability & Debuggability Review

Default user output must be quiet. Internal logs still matter for developers:

- Add `--verbose` and/or `HOPTER_LOG=debug` to enable `slog` output.
- Keep structured logs on stderr only in verbose mode.
- When not verbose, show user-facing startup/error lines only.
- Record validation evidence path after implementation, per `AGENTS.md`.

### 9. Deployment & Rollout Review

Cobra adds a dependency and changes CLI help output. This affects Homebrew/npm users and release packaging, but no new artifact type is introduced.

Rollout requirements:

- Update `go.mod` and `go.sum`.
- Verify `scripts/validate-npm-packages.ts` still sees the same `hopter` binary entry.
- Update README examples if help/output changes.
- Keep command names and flags stable after this redesign: `hopter`, `hopter server`, `hopter doctor --json`, `--port`, `--background`, `--relay`, `--verbose`.

### 10. Long-Term Trajectory Review

The plan becomes a good 6-month foundation if it keeps the terminal as host control, not work control.

Dream state delta:

- This plan moves startup from obscure to understandable.
- It does not prove browser/Codex session success by itself.
- It should explicitly add first-run metrics and compatibility checks so the CLI supports the main wedge instead of becoming a side product.

### 11. Design & UX Review

Terminal output is UI. Required states:

| State | Must specify |
|---|---|
| Starting | One short line, no internal logs. |
| Ready | Local URL, bind URL if different, UI mode, shortcut cheatsheet. |
| Relay pending | Login URL, waiting state, what happens next. |
| Relay ready | Public URL/domain and local URL remain visible. |
| Degraded | Plain cause and next action. |
| Exiting | One shutdown line after `q` or signal. |
| Non-interactive | No cheatsheet that implies keyboard control. |

Completion Summary:

| Section | Result |
|---|---|
| Step 0 | SELECTIVE EXPANSION, user confirmed Cobra/static doctor/runtime shortcuts |
| Section 1 Arch | 4 issues found |
| Section 2 Errors | 7 error paths mapped |
| Section 3 Security | 4 local risks mapped |
| Section 4 Data/UX | 5 flows mapped |
| Section 5 Quality | 3 implementation guardrails |
| Section 6 Tests | Diagram produced, 3 critical gaps |
| Section 7 Perf | 1 timeout guardrail |
| Section 8 Observability | 4 logging requirements |
| Section 9 Deploy | 4 rollout requirements |
| Section 10 Future | Reversibility: 4/5, debt items: terminal loop boundary |
| Section 11 Design | 7 terminal states required |

Phase 1 complete. Codex: 12 concerns. Claude subagent: unavailable. Consensus: 0/6 confirmed, 5 disagreements surfaced at gate.

## Phase 2 Design Review

Design scope: terminal UI and command help, not browser UI.

Initial completeness: 6/10. The plan names desired output and shortcuts, but needs state coverage, hierarchy rules, and non-interactive behavior.

DESIGN DUAL VOICES, CONSENSUS TABLE:

```text
Dimension                            Claude  Codex       Consensus
──────────────────────────────────── ─────── ─────────── ─────────────────────────────
1. Information hierarchy right?      N/A     Partial     PARTIAL
2. Missing states covered?           N/A     No          DISAGREE, add full state matrix
3. User journey coherent?            N/A     Mixed       DISAGREE, browser open is stronger
4. Specific UI decisions?            N/A     Partial     PARTIAL
5. Terminal vs browser boundary?     N/A     Risky       DISAGREE, bound shortcuts tightly
6. Accessibility/scriptability?      N/A     Partial     PARTIAL
7. Visual slop risk?                 N/A     Low         CONFIRMED
```

### Pass 1: Information Architecture, 7/10

What a 10 looks like: a developer sees the URL first, the current state second, and commands only after state is understood.

Decision: ready panel order is `Hopter is running`, `Local`, `Bind`, `Mode`, optional `Relay`, then `Shortcuts`. Do not lead with a command list.

### Pass 2: Interaction State Coverage, 5/10

Missing states were added in CEO Section 11. Implementation must cover starting, ready, relay pending, relay ready, degraded, exiting, and non-interactive.

### Pass 3: Error UX, 6/10

Every error must say problem, likely cause, and fix. Avoid raw wrapped errors as the only user-facing line. Raw detail can appear under verbose logs or JSON detail.

### Pass 4: Responsive/Terminal Constraints, 7/10

Terminal width varies. Keep lines under roughly 88 columns, print URLs on their own line, and avoid table layouts for dynamic error details.

### Pass 5: Accessibility, 7/10

Plain ASCII is acceptable. Do not rely on color. If color is later added, keep it opt-in or terminal-capability aware.

### Pass 6: Product Boundary, 6/10

The terminal must not control sessions/projects. Approved controls are host lifecycle, status, doctor suggestions, and quit.

### Pass 7: Specificity, 8/10

The output examples are concrete enough after this review. Implementation should snapshot-test the help and ready output.

Design Completion Summary:

| Pass | Score | Decision |
|---|---:|---|
| Information Architecture | 7/10 | URL/state before shortcuts |
| Interaction States | 5/10 | Add state matrix |
| Error UX | 6/10 | Problem/cause/fix required |
| Terminal Constraints | 7/10 | Short plain lines |
| Accessibility | 7/10 | ASCII, no color dependency |
| Product Boundary | 6/10 | Host-only shortcuts |
| Specificity | 8/10 | Snapshot output |

Phase 2 complete. Codex: 5 design concerns from CEO voice. Claude subagent: unavailable. Consensus: 1/7 confirmed, 4 disagreements surfaced at gate.

## Phase 3 Engineering Review

### Step 0 Scope Challenge

Actual code read: `cmd/hopter/root.go`, `cmd/hopter/doctor.go`, `cmd/hopter/version.go`, `cmd/hopter/main.go`, `cmd/hopter/root_test.go`, `internal/doctor/doctor.go`, `internal/app/config.go`, `internal/app/bootstrap.go`, `internal/update/service.go`.

Complexity check: this will likely touch 6-9 files and one dependency. That is acceptable because the change replaces the CLI framework and must update tests/docs together.

What already exists:

- Runtime creation and server lifecycle are already centralized in `runServe`.
- Browser URL derivation already exists in `localBrowserURL`.
- Browser opening already exists in `openBrowserURL` for relay login.
- Doctor already has a report/check shape.
- Update preflight already depends on `hopter doctor --json`, so JSON stability is not optional.

ENG DUAL VOICES, CONSENSUS TABLE:

```text
Dimension                            Claude  Codex       Consensus
──────────────────────────────────── ─────── ─────────── ─────────────────────────────
1. Architecture sound?               N/A     Partial     PARTIAL
2. Test coverage sufficient?         N/A     No          DISAGREE, broaden CLI tests
3. Performance risks addressed?      N/A     Partial     PARTIAL
4. Security threats covered?         N/A     Partial     PARTIAL
5. Error paths handled?              N/A     No          DISAGREE, add registry cases
6. Deployment risk manageable?       N/A     Partial     PARTIAL
```

### 1. Architecture

```text
cmd/hopter
  main.go
    -> newRootCommand()
       -> command options + injected IO
       -> serve RunE
          -> runServe()
             -> app.LoadConfigWithOptions()
             -> app.NewRuntime()
             -> http.Server.ListenAndServe()
             -> hostControlLoop()
       -> doctor RunE
          -> doctor.RunStatic()
       -> version RunE
       -> background stop/status RunE

internal/doctor
  -> static checks only
     -> executable
     -> config
     -> bind address
     -> codex binary/version
     -> install source/update hint
     -> relay auth presence
```

Architecture finding: `doctor.Run` should likely become `doctor.RunStatic` or keep `Run` but remove runtime bootstrap. Use options injection for bind/listen and exec lookup to test without relying on machine state.

### 2. Code Quality

Findings:

- Do not keep global mutable vars growing (`openBrowser`, `newRelayAuthStore`, `newRelaySessionManager`) if Cobra migration adds more. Prefer a command dependency struct for test injection.
- Do not introduce a generic "presenter" framework. A `Suggestion` field on doctor checks plus small CLI rendering functions is enough.
- Raw terminal mode is in scope because the user explicitly wants no-Enter shortcuts. Keep it isolated behind a small terminal-input adapter and test restoration aggressively.

### 3. Test Review

Coverage mapping:

| Codepath | Test type | Existing? | Gap |
|---|---|---:|---|
| Root command help | Go unit/snapshot | No | Add |
| Serve command help | Go unit/snapshot | No | Add |
| Cobra invalid command | Go unit | No | Add |
| Serve flag parsing | Go unit | Partial | Add Cobra coverage |
| Startup ready output | Go unit | Partial via string checks | Expand |
| Relay status output | Go unit | Partial | Expand |
| Runtime control loop | Go unit with injected reader | No | Add |
| Raw terminal cleanup | Go unit with fake terminal mode adapter | No | Add |
| Background lifecycle | Go unit/integration | Missing | Add |
| Homebrew service | Go unit/integration | Partial GoReleaser service exists | Add |
| Homebrew formula service block | `bun scripts/validate-goreleaser.ts` | Existing validation parses config | Extend/assert command |
| Non-interactive input disable | Go unit | No | Add |
| Static doctor report | Go unit | Partial | Refactor/add |
| Doctor JSON shape | Go unit/integration | Indirect update preflight | Add direct |
| Update doctor preflight | Existing update tests | Yes | Re-run after doctor schema changes |
| README examples | Docs validation | Partial | Update docs validation if needed |

Critical test artifact: `/Users/sorcererxw/.gstack/projects/sorcererxw-orchd/master-test-plan-20260429-215334.md`.

### 4. Performance

No runtime performance concern. Doctor checks that spawn external commands must use timeouts. Runtime control loop must not block HTTP server shutdown. Raw key polling must avoid busy loops.

Failure Modes Registry:

| Failure mode | Severity | Mitigation |
|---|---|---|
| Cobra migration changes default `hopter` behavior | High | Unit test root with no args calls server action path. |
| Runtime shortcut loop blocks non-interactive runs | High | Detect terminal before starting loop; test pipe mode. |
| Background or non-interactive server accidentally opens browser or enters raw mode | High | Explicit `--background` branch, non-interactive detection, and tests. |
| Self-managed background process leaks or reports ready too early | High | Parent waits for child readiness or failure; state is written only after HTTP health is true. |
| Background service cannot find Codex because launchd PATH differs | High | Static doctor warning and documented config path. |
| Stale host state makes `hopter doctor` lie | Medium | Health-check URL and PID before reporting running. |
| `doctor --json` gains prose or logs | High | JSON parse test on success and failure. |
| Static doctor misses runtime app-server failures | Medium | Do not label doctor as end-to-end health. Add compatibility warning/check. |
| Default logs still leak internal slog output | Medium | Configure logging quiet by default; verbose test. |
| `q` shutdown races with ListenAndServe | Medium | Use existing server shutdown context and idempotent stop. |

NOT in scope:

- Full TUI rendering library.
- Terminal session/project control.
- Hosted relay semantic changes.
- Replacing the browser workspace as primary control plane.

Eng Completion Summary:

| Step | Result |
|---|---|
| Scope Challenge | Scope accepted with tighter host-only terminal boundary |
| Architecture Review | 4 issues found |
| Code Quality Review | 3 issues found |
| Test Review | Diagram produced, 8 gaps identified |
| Performance Review | 2 guardrails |

Phase 3 complete. Codex: 6 engineering concerns inferred from CEO voice. Claude subagent: unavailable. Consensus: 0/6 confirmed, 3 disagreements surfaced at gate.

## Phase 3.5 DX Review

Product type: CLI Tool plus local developer platform.

Primary persona: developer evaluating Hopter after Homebrew or npm install. They want `hopter` to get them into the browser workspace fast, not to learn a new terminal product.

Developer empathy narrative:

> I installed Hopter because I want to keep a Codex session moving from another device. I run `hopter` and need immediate confidence: is it running, where do I click, what if it fails, and how do I stop it? If the terminal dumps logs or makes me read docs before the browser opens, I start doubting the product before I see the real workspace.

Developer journey map:

| Stage | Current friction | Target |
|---|---|---|
| Discover | README is short but thin | README explains install, run, background server/stop, and doctor |
| Install | Homebrew/npm commands exist | Keep unchanged |
| Foreground first run | URL printed, no browser auto-open | Auto-open browser by default in interactive mode |
| Background run | Existing Homebrew service block runs plain serve; Hopter has no self-managed background mode | `hopter server --background`, `hopter stop`, Homebrew `hopter server`, logs, state file, `doctor` |
| Server ready | Logs can mix with user output | Quiet ready panel |
| First browser use | Outside this CLI plan | Keep as main product metric |
| Debug | Doctor can fail on runtime lock | Static doctor with suggestions |
| Relay | Flags exist, flow unclear | Relay output only when active |
| Automation | JSON exists | Preserve strict JSON |
| Upgrade | Update hints exist in backend | Surface install-source hint in doctor |

DX DUAL VOICES, CONSENSUS TABLE:

```text
Dimension                            Claude  Codex       Consensus
──────────────────────────────────── ─────── ─────────── ─────────────────────────────
1. Getting started < 5 min?          N/A     Partial     PARTIAL
2. API/CLI naming guessable?         N/A     Partial     PARTIAL
3. Error messages actionable?        N/A     No          DISAGREE, add suggestions
4. Docs findable & complete?         N/A     No          DISAGREE, README too thin
5. Upgrade path safe?                N/A     Partial     PARTIAL
6. Dev environment friction-free?    N/A     Partial     PARTIAL
```

DX Scorecard:

| Dimension | Current | Target | Required change |
|---|---:|---:|---|
| Getting started | 5/10 | 8/10 | Auto-open foreground startup, clear ready panel, README examples |
| CLI ergonomics | 5/10 | 8/10 | Cobra help/examples/errors, stable commands |
| Error quality | 4/10 | 9/10 | Problem/cause/fix suggestions |
| Scriptability | 7/10 | 9/10 | Preserve JSON, no stdin loop in non-interactive mode |
| Debuggability | 5/10 | 8/10 | Static doctor, verbose logs opt-in |
| Upgrade confidence | 5/10 | 7/10 | Install-source hints in doctor |
| Product focus | 6/10 | 8/10 | Host-only terminal controls |
| Docs | 4/10 | 8/10 | README quickstart and troubleshooting |

TTHW assessment:

- Current install-to-server URL: likely < 2 minutes after install.
- Current install-to-browser-ready: depends on user noticing/copying URL.
- Target: interactive `hopter` should get user to browser in < 2 minutes, with terminal fallback clear.

DX Implementation Checklist:

- Cobra command tree with examples.
- Auto-open browser by default after server readiness in interactive mode.
- Raw-key shortcuts with terminal mode restoration.
- `server --background` and `stop` for Hopter-managed background mode.
- Homebrew service runs `hopter server`.
- GoReleaser Homebrew service block updated and validated.
- `hopter doctor` backed by the host state file.
- Quiet default logging.
- Static doctor with suggestions and strict JSON.
- Runtime host shortcuts only in interactive mode.
- README quickstart, troubleshooting, and scriptability notes.

Phase 3.5 complete. DX overall: current 5.1/10, target 8.1/10. TTHW: <2 min server, uncertain browser success -> target <2 min browser-open. Codex: 6 DX concerns. Claude subagent: unavailable. Consensus: 0/6 confirmed, 2 disagreements surfaced at gate.

## Cross-Phase Themes

**Theme: Browser-first activation beats CLI polish alone.** Flagged by CEO, Design, Eng, and DX. The CLI should get the developer into the browser workspace faster, not become a parallel product.

**Theme: Terminal control needs a hard product boundary.** Flagged by CEO, Design, and Eng. Shortcuts are acceptable for host lifecycle, but not for session/project work.

**Theme: Doctor must not imply end-to-end health.** Flagged by CEO, Eng, and DX. Static doctor is the right recovery tool, but the plan needs separate live validation for browser/Codex session success.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/autoplan` | Scope & strategy | 1 | issues_open | 12 Codex concerns, 5 gate disagreements |
| Design Review | `/autoplan` | Terminal UI states | 1 | issues_open | 7 states required |
| Eng Review | `/autoplan` | Architecture & tests | 1 | issues_open | 8 test gaps |
| DX Review | `/autoplan` | CLI onboarding | 1 | issues_open | Current 5.1/10, target 8.1/10 |
