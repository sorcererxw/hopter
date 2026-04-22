# M0 Spike Findings

This file is updated by milestone validation runs.

Current evidence shortcuts:

- latest M0 run: `storage/artifacts/validation/latest-m0.txt`
- latest M1 run: `storage/artifacts/validation/latest-m1.txt`

Current implementation constraints:

1. `hopter` should speak to `codex app-server` over `stdio`.
2. Codex detection must surface missing vs incompatible states explicitly.
3. Gateway runtime state should keep only lightweight thread references while the process is alive, not full session mirrors.
4. Bun child-process primitives cover cwd + stdin/stdout lifecycle, but the later terminal drawer still needs a PTY-capable layer for resize fidelity.
