# Runtime Artifacts and Validation

## Purpose

This document collects the runtime artifact locations and validation workflow that the UI implementation work depends on.

The live runtime artifacts are produced outside the repository.
That is fine.

What matters is that the contract for reading them lives in the repository, not only in someone's shell history.

## Runtime artifact locations

The local dev loop writes machine state and timeline logs here:

- state: `~/.hopter/devlogs/<repo-slug>/state.json`
- timeline: `~/.hopter/devlogs/<repo-slug>/timeline.jsonl`

The repo slug is derived from the checkout path that launched `make dev`.
For a checkout whose directory is named `hopter`, that resolves to a path like:

- state: `~/.hopter/devlogs/hopter-<repo-path-hash>/state.json`
- timeline: `~/.hopter/devlogs/hopter-<repo-path-hash>/timeline.jsonl`

These files are the authority for the live stack state.
Do not rely only on terminal memory when validating the running app.

## What each artifact is for

### State file

Path:

- `~/.hopter/devlogs/<repo-slug>/state.json`

Use it to check:

- current dev-loop status
- logs directory
- repo root
- session id
- last known error
- process id

### Timeline log

Path:

- `~/.hopter/devlogs/<repo-slug>/timeline.jsonl`

Use it to check:

- Vite updates
- Go watcher events
- build failures
- browser-facing errors during the current live loop

## Validation workflow

When validating live UI work, prefer this sequence:

1. `make reset`
2. `make dev`
3. `make verify-live`

Then inspect:

- `~/.hopter/devlogs/<repo-slug>/state.json`
- `~/.hopter/devlogs/<repo-slug>/timeline.jsonl`

## Minimum evidence expected

A UI task is not complete unless the implementation is mapped to validation evidence.

At minimum, report:

1. commands run
2. whether the live loop was healthy
3. what the state file reported
4. what the timeline log reported
5. any screenshots or layout checks used for desktop and phone-like layouts

## External agent note

If an external agent is working from a prompt, point it at this file instead of hard-coding the runtime paths in the prompt body.

The runtime files remain outside the repository.
The instructions for using them should live here.
