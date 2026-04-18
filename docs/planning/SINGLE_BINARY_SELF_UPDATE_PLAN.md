# Single-Binary Self-Update Plan

## Status

Proposed implementation plan.

## Decision

`orchd` will support a **single-binary self-update path** for direct installs while preserving the foreground terminal session.

That means:

- the shipped product artifact remains **one `orchd` binary**
- direct installs and `unknown` installs are treated as **self-managed**
- package-manager installs remain **version-aware only**
- the running foreground `orchd` process does **not** hand off to a second helper binary
- the running foreground `orchd` process performs a **self-reexec** into the newly downloaded binary
- the shell must **not** regain the prompt during a successful update

This plan intentionally accepts the reliability boundary of a single-process reexec model in exchange for keeping the product lightweight and preserving the single-binary distribution shape.

## Product expectations locked in

### Distribution

- product distribution remains one binary: `orchd`
- no second shipped `orchd-updater` helper
- no packaged `.app`, `.pkg`, or multi-file runtime is introduced for the update path

### UI entry point

- the update entry lives in the **homepage sidebar**
- exact location: the **top rail row**, rightmost component
- the entry appears **only when** the backend has confirmed that a newer version is available

### Update behavior

- direct installs: clicking update executes the self-update flow
- package-managed installs: clicking update opens a popup with the correct host-side upgrade command
- `unknown` installs are intentionally treated as self-managed

### Terminal behavior

- user may have launched `orchd` directly in a foreground terminal
- during a successful self-update:
  - the shell must not regain the prompt
  - the terminal session must continue running `orchd`
  - the browser waits for the new version to come back healthy and then refreshes

## Why this plan exists

The product wants three things at once:

1. stay a small self-hosted tool
2. avoid packaging a second updater runtime
3. let direct installs evolve without forcing users to manually replace the binary every time

The chosen mechanism is a compromise that fits those constraints:

- **single shipped binary**
- **foreground terminal preserved**
- **package-manager ownership respected**

## Core mechanism

The direct-install update path is:

1. running `orchd` checks a signed update manifest
2. if a newer version exists, the UI exposes an update entry
3. user clicks update
4. `orchd` downloads the new binary to a staging path
5. `orchd` verifies:
   - manifest signature
   - artifact checksum
   - local preflight/doctor run
6. `orchd` atomically swaps the binary on disk
7. `orchd` calls `exec(...)` on the current binary path
8. the process image is replaced by the new version
9. the foreground shell session stays attached to the same running process slot
10. the browser waits for health recovery and exact target-version match, then refreshes

This is **not** a proxy/supervisor handoff.

The old process does **not** stay alive as an agent that launches another process.
Instead, the old process is replaced in place by the new program image.

## Reliability boundary

This plan improves safety substantially, but it does **not** guarantee that a bad new binary can never take down the running process.

### What can be protected well

Failures before `exec(...)` can usually leave the old process alive:

- manifest fetch failure
- manifest signature failure
- artifact checksum mismatch
- staging write failure
- preflight failure
- direct `exec(...)` syscall failure

### What cannot be guaranteed in this model

If the new program image starts successfully and then crashes extremely early:

- startup panic
- configuration bootstrap fatal
- runtime initialization bug
- early listener bind failure with fatal exit

then the old process is already gone and there is no separate supervisor to resurrect it automatically.

This is an inherent tradeoff of the single-process self-reexec model.

## Install-source policy

The updater needs two concepts:

- `install_source`: where this copy appears to come from
- `update_policy`: whether `orchd` is allowed to apply updates itself

In the current implementation direction, `install_source` should come primarily from **build-time injected metadata** in the binary, not from runtime path guessing.

### Install sources

- `direct`
- `unknown`
- `homebrew_formula`
- `homebrew_cask`
- `apt`
- `dnf`
- `winget`
- `nix`
- `macports`
- `snap`
- `flatpak`

### Policies

- `self_managed`
- `package_managed`
- `store_managed`

### Mapping

- `direct` -> `self_managed`
- `unknown` -> `self_managed`
- `snap` / `flatpak` -> `store_managed`
- all other package-manager detections -> `package_managed`

### Source priority

Priority order:

1. build-time injected `installSource`
2. runtime override via `ORCHD_INSTALL_SOURCE` for debugging and validation
3. fallback `direct`

This plan intentionally does **not** optimize for hand-moved binaries or unusual local copying flows.

## Version source of truth

The updater compares:

1. **current version**
2. **latest version in a signed manifest**

### Current version

`orchd` knows its own version from build-time injected metadata:

- `Version`
- `Commit`
- `BuildTime`
- `Channel`

Do not infer the current version from file names or install paths.

### Latest version

`orchd` fetches a signed update manifest from a fixed base URL.

Recommended default:

```text
https://updates.orchd.dev/update/v1/manifest.json
```

Recommended overrides:

- `ORCHD_UPDATE_BASE_URL`
- `ORCHD_UPDATE_CHANNEL`

## Manifest contract

Recommended JSON structure:

```json
{
  "payload": {
    "product": "orchd",
    "channel": "stable",
    "version": "0.4.2",
    "published_at": "2026-04-19T10:00:00Z",
    "notes_url": "https://orchd.dev/releases/0.4.2",
    "min_upgradable_version": "0.3.0",
    "artifacts": {
      "darwin-arm64": {
        "url": "https://updates.orchd.dev/artifacts/0.4.2/orchd-darwin-arm64",
        "sha256": "5b7f...",
        "size_bytes": 18432000
      }
    }
  },
  "signature": "base64-signature"
}
```

Rules:

- sign the payload, not the artifact
- verify signature before trusting the version or URLs
- pick artifact by `GOOS-GOARCH`
- compare versions with a semver-compatible strategy

## Security model

System protections like permissions and Gatekeeper may block some bad outcomes on macOS, but they are **not** the primary defense.

`orchd` must assume that:

- a non-sandboxed local CLI can often download and execute files in writable locations
- OS-level blocking is not a sufficient trust model for self-update

Required updater defenses:

- signed manifest
- embedded public key verification
- SHA-256 artifact verification
- platform/architecture match check
- local preflight before apply
- only allow `ApplyUpdate` for `self_managed` policy

## Preflight design

Downloaded binaries must be validated locally before swapping the current binary.

Recommended command:

```text
orchd doctor
```

For automated update preflight, prefer:

```text
orchd doctor --json
```

### Preflight should verify

- binary can start
- platform and architecture match expectations
- configuration parses
- state/update directories are accessible
- critical runtime bootstrap succeeds

### Preflight should not do

- bind the real production service port
- start the full long-running server path
- mutate business/session state

### Preflight outcome

- success: update may proceed
- failure: update stops and the old process keeps running

## Foreground process model

The direct-install update path is built around `exec(...)`.

Practical meaning:

- the same foreground process slot keeps running
- shell keeps waiting
- `stdin`, `stdout`, and `stderr` remain attached to the same terminal
- PID typically stays the same
- in-memory Go state does **not** survive

Because in-memory state does not survive, anything required after the reexec must be:

- rebuilt from disk
- passed through args/env
- or intentionally discarded

## Browser refresh rules

After apply begins, the browser must not blindly refresh on a timer.

The browser refreshes only after both are true:

1. `/healthz` has recovered
2. the reported running version equals the target version

This prevents false-positive refreshes into:

- the old version
- a half-initialized process
- a short-lived crash loop

## Global singleton update behavior

Updates are host-level operations, not page-local operations.

Rules:

- only one update operation may be active per host
- all tabs observe the same update state
- once update begins, the update entry becomes a shared status display, not a clickable second trigger

## Proposed backend states

- `idle`
- `checking`
- `available`
- `downloading`
- `verifying`
- `preflight_running`
- `ready_to_apply`
- `reexecing`
- `failed_pre_exec`
- `failed_post_exec_unknown`

Interpretation:

- `failed_pre_exec`: old process is still alive
- `failed_post_exec_unknown`: new process never reached a confirmed healthy version after reexec; exact cause may be unknown to the old process because it is already gone

## Package-manager behavior

Package-managed installs still use the same manifest to detect newer versions, but they do not apply updates internally.

### Allowed

- version awareness
- release notes link
- command hint popup

### Disallowed

- internal artifact download-and-swap flow
- self-managed reexec
- bypassing package-manager ownership

### Example command hints

- Homebrew formula: `brew upgrade orchd`
- Homebrew cask: `brew upgrade --cask orchd`
- APT: `sudo apt update && sudo apt upgrade orchd`
- DNF: `sudo dnf upgrade orchd`
- MacPorts: `sudo port selfupdate && sudo port upgrade orchd`
- winget: `winget upgrade orchd`

## Proposed API surface

The update plan expects `HostService` to grow:

- `GetUpdateStatus`
- `CheckForUpdate`
- `ApplyUpdate`

Expected data concepts:

- current version
- install source
- update policy
- update state
- available version
- target version
- release notes URL
- command hint for package-managed installs
- last checked timestamp
- failure reason

## Suggested module layout

New backend modules:

- `internal/update/coordinator.go`
- `internal/update/manifest.go`
- `internal/update/manifest_client.go`
- `internal/update/verifier.go`
- `internal/update/preflight.go`
- `internal/update/reexec.go`
- `internal/update/policy.go`
- `internal/installsource/detect.go`

Existing files expected to change:

- `idl/orchd/v1/host.proto`
- `internal/core/models.go`
- `internal/rpc/host_service.go`
- relevant frontend rail/sidebar components

## Validation requirements

This plan is not complete until there is evidence for:

1. direct-install update available state appears in the rail row
2. direct-install update downloads, verifies, and runs preflight
3. direct-install update reexecs without dropping the foreground shell prompt
4. browser refreshes only after health recovery and exact target-version match
5. package-managed install shows command popup instead of executing internal update
6. a preflight failure leaves the old process running

Evidence should be recorded under the repo's validation artifact flow, not only described in prose.

## Open decisions intentionally left for implementation

- exact install-source detection order and marker-file design
- exact update staging path
- exact backup/rollback file naming strategy
- exact `doctor` command coverage
- exact manifest canonicalization and signature algorithm

These are implementation details. The product behavior and trust boundaries above are the locked decisions.
