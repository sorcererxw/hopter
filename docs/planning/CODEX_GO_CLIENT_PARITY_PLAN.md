# Codex Go Client Parity Plan

## Status

Proposed implementation plan.

This document defines how `orchd` should add a Go-native Codex client that is capability-complete with the official TypeScript SDK while staying idiomatic in Go.

It is not a plan to port `orchd` to TypeScript.

## Why this exists

The official Codex TypeScript SDK is now the clearest reference implementation for the high-level embedded-agent experience:

- `Codex`
- `startThread()`
- `resumeThread()`
- `thread.run()`
- `thread.runStreamed()`
- structured input
- structured output
- turn-scoped cancellation
- CLI config/env bridging

At the same time, `orchd` is already committed to a Go-first runtime:

- the Go server is the only Codex client
- browser never talks to Codex directly
- runtime stays Go-first
- distribution stays as a single Go artifact where possible

So the right move is:

1. read the TypeScript SDK source as the behavior spec
2. implement the same capabilities in Go
3. keep the Go API shaped like Go, not like TypeScript in disguise

## Source review summary

The official TypeScript SDK under `openai/codex/sdk/typescript` establishes these important facts.

### 1. The SDK is a CLI wrapper, not a separate network protocol

The SDK:

- spawns `codex exec --experimental-json`
- writes prompt text to stdin
- reads structured JSONL events from stdout
- maps those events into a high-level thread/turn API

This matters because the stable parity target is CLI behavior and event semantics, not Node-specific abstractions.

### 2. The SDK surface is intentionally small

High-level surface:

- `Codex.startThread(options?)`
- `Codex.resumeThread(id, options?)`
- `Thread.run(input, turnOptions?)`
- `Thread.runStreamed(input, turnOptions?)`
- `Thread.id`

The SDK does not expose a giant helper universe. Good. We should not invent one.

### 3. Thread continuity is implicit

The TypeScript implementation stores a thread id after the first `thread.started` event and then uses `codex exec resume <thread-id>` for later turns.

That means thread continuity is a behavior contract, not a separate state store.

### 4. Turn execution has two modes

- buffered mode: `run()` returns `{ items, finalResponse, usage }`
- streamed mode: `runStreamed()` returns an async event stream

Those are both first-class. Go parity must support both.

### 5. Input normalization is part of the SDK contract

The TypeScript SDK accepts:

- plain string input
- structured input entries:
  - `{ type: "text", text: string }`
  - `{ type: "local_image", path: string }`

Text segments are concatenated with blank lines. Images are forwarded as repeated `--image` flags.

### 6. Structured output is implemented via a temp schema file

`TurnOptions.outputSchema` is written to a temporary JSON file, then passed via `--output-schema`, and the temp directory is always cleaned up.

That cleanup behavior is part of parity.

### 7. Config/env plumbing is real SDK behavior, not incidental glue

The TypeScript SDK supports:

- `apiKey`
- `baseUrl`
- `config` object flattened into repeated `--config key=value`
- thread-level overrides that take precedence over client-level config
- full environment override
- explicit Codex binary path override

This is part of the public contract and must be mirrored.

### 8. Cancellation is turn-scoped

`TurnOptions.signal` is passed to the spawned process. Aborting before execution or during iteration must fail the turn.

In Go this should be `context.Context`.

## Product fit inside `orchd`

`orchd` currently has a low-level Go-side Codex bridge under `internal/codex/` built around `codex app-server`.

That low-level bridge is still useful for current control-plane behavior:

- thread listing
- thread reading
- session hydration
- optimistic session state
- control-plane integration with Connect + SSE

But it is not the same thing as official SDK parity.

The TypeScript SDK parity layer should therefore be added as a new high-level execution package, not forced into the existing `app-server` transport wrapper.

## Goal

Add a Go-native Codex client that is fully aligned with the official TypeScript SDK in capability and behavior:

- same thread lifecycle
- same turn lifecycle
- same input modes
- same output schema behavior
- same execution options
- same event union
- same error/cancellation behavior

while using idiomatic Go APIs:

- `context.Context` instead of `AbortSignal`
- concrete structs instead of class-heavy ergonomics
- `error` returns instead of exception flow
- channels or iterator-style streaming instead of async generators

## Non-goals

- rewriting `orchd` around the SDK package first
- exposing a public OSS Go module in the first pass
- reproducing the TypeScript SDK's Node package binary discovery logic
- making the Go API look source-compatible with TypeScript
- replacing the existing `app-server` bridge until parity is proven

## Required parity surface

### Client-level capabilities

The Go client must support:

- start new thread
- resume existing thread by id
- explicit Codex binary path override
- API key override
- base URL override
- config override object
- environment override map

### Thread-level capabilities

The Go thread must support:

- run one buffered turn
- run one streamed turn
- expose thread id after first start event
- continue the same thread across multiple turns
- resume an existing thread id and continue it

### Input capabilities

The Go client must accept:

- plain string input
- text input parts
- local image input parts

### Turn options

The Go client must support:

- output schema
- turn cancellation via `context.Context`

### Thread execution options

The Go client must support:

- model
- sandbox mode
- working directory
- additional directories
- skip git repo check
- model reasoning effort
- network access enabled
- web search mode
- legacy web search enabled boolean
- approval policy

### Event parity

The streamed API must expose all event kinds modeled by the TypeScript SDK:

- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `item.started`
- `item.updated`
- `item.completed`
- `error`

### Item parity

The Go item model must represent all item kinds currently modeled by the TypeScript SDK:

- `agent_message`
- `reasoning`
- `command_execution`
- `file_change`
- `mcp_tool_call`
- `web_search`
- `todo_list`
- `error`

## Go API design

### Package layout

Create a dedicated high-level package:

```text
/internal/codex/sdk
  client.go
  thread.go
  exec.go
  options.go
  events.go
  items.go
  schema.go
  config.go
  errors.go
```

Keep the current `app-server` wrapper in place, but gradually rename it for clarity in a follow-up if needed:

```text
/internal/codex
  client.go
  manager.go
```

The new package should not depend on the current `Manager`.

### Public Go types

Suggested API:

```go
type Client struct { ... }

func New(opts ClientOptions) (*Client, error)
func (c *Client) StartThread(opts ThreadOptions) *Thread
func (c *Client) ResumeThread(id string, opts ThreadOptions) *Thread

type Thread struct { ... }

func (t *Thread) ID() string
func (t *Thread) Run(ctx context.Context, input Input, opts RunOptions) (Turn, error)
func (t *Thread) RunStreamed(ctx context.Context, input Input, opts RunOptions) (*TurnStream, error)
```

Where:

- `Run()` is the buffered convenience API
- `RunStreamed()` is the source-of-truth execution path
- `Run()` internally drains `RunStreamed()`

That preserves the TypeScript behavioral model while still reading like Go.

### Input model

Use a Go sum-type-by-interface pattern, but keep construction simple:

```go
type Input interface {
	isInput()
}

type TextInput string

type UserInputPart interface {
	isUserInputPart()
}

type TextPart struct {
	Text string
}

type LocalImagePart struct {
	Path string
}

type PartsInput []UserInputPart
```

Normalization rules:

- `TextInput` maps directly to prompt text
- `PartsInput` concatenates `TextPart` values with `\n\n`
- `LocalImagePart` values become repeated `--image` flags

These normalization rules must be tested exactly.

### Options model

Use explicit Go option structs, not variadic functional options for the first pass.

```go
type ClientOptions struct {
	CodexPath string
	BaseURL   string
	APIKey    string
	Config    map[string]any
	Env       map[string]string
}

type ThreadOptions struct {
	Model                 string
	SandboxMode           SandboxMode
	WorkingDirectory      string
	AdditionalDirectories []string
	SkipGitRepoCheck      bool
	ModelReasoningEffort  ModelReasoningEffort
	NetworkAccessEnabled  *bool
	WebSearchMode         WebSearchMode
	WebSearchEnabled      *bool
	ApprovalPolicy        ApprovalPolicy
}

type RunOptions struct {
	OutputSchema map[string]any
}
```

Notes:

- use pointers only where tri-state matters
- keep enums as typed strings
- `context.Context` carries cancellation, so `RunOptions` does not need its own signal field

### Event model

Use a discriminated-union pattern with a shared `Event` interface and concrete structs.

```go
type Event interface {
	EventType() string
}
```

Concrete types:

- `ThreadStartedEvent`
- `TurnStartedEvent`
- `TurnCompletedEvent`
- `TurnFailedEvent`
- `ItemStartedEvent`
- `ItemUpdatedEvent`
- `ItemCompletedEvent`
- `StreamErrorEvent`

`RunStreamed()` should return:

```go
type TurnStream struct {
	ThreadID string
	Events   <-chan Event
	Err      <-chan error
}
```

Channels are the simpler first pass and fit the existing codebase better than trying to mimic async generators.

### Buffered turn result

Match the TypeScript semantics:

```go
type Turn struct {
	Items         []Item
	FinalResponse string
	Usage         *Usage
}
```

Rules:

- collect every `item.completed`
- set `FinalResponse` from the last completed `agent_message`
- set `Usage` from `turn.completed`
- fail the run on `turn.failed`

## Exec runner design

The `exec` layer is where most real parity lives.

### Command line shape

Start with:

```text
codex exec --experimental-json
```

Then append flags in the same semantic order as the TypeScript SDK:

1. global `--config` overrides from client options
2. `openai_base_url` config override from `BaseURL`
3. thread-level flags like `--model`, `--sandbox`, `--cd`
4. thread-level `--config` overrides such as reasoning effort, web search, approval policy
5. `resume <thread-id>` when present
6. repeated `--image` flags

We do not need byte-for-byte argument parity, but we do need semantic parity, including override precedence.

### Environment behavior

Behavior must match TypeScript intent:

- if `Env` is provided, do not inherit the process environment implicitly
- otherwise inherit the current process environment
- always inject required SDK-owned variables
- inject `CODEX_API_KEY` when `APIKey` is set
- set originator marker unless already present

Use the same originator-value semantics, but choose a Go-specific marker:

- `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_sdk_go`

Do not reuse the TypeScript marker. We want observability that reflects reality.

### Binary resolution

Go version should use Go-native rules:

1. `ClientOptions.CodexPath` if set
2. `exec.LookPath("codex")`
3. fail with an actionable error

Do not copy the npm optional-dependency binary discovery path. That is TypeScript-specific packaging, not a runtime capability requirement.

## Config override serialization

This is one of the few places where drift will bite.

Implement the same logical serializer:

- flatten nested objects into dotted paths
- preserve arrays as TOML arrays
- reject `nil` values in emitted overrides
- reject non-finite numbers
- allow empty object only at nested positions where it serializes as `{}` if required
- thread-level overrides must be emitted after client-level overrides

Add table-driven tests that mirror the TypeScript tests.

## Structured output schema handling

Implement a helper matching TypeScript behavior:

1. validate schema is a JSON object
2. create temp dir under system temp
3. write `schema.json`
4. pass the file path via `--output-schema`
5. always cleanup, including on error and cancellation

This helper should be isolated in `schema.go`.

## Error model

Define explicit Go errors:

```go
var (
	ErrTurnFailed   = errors.New("codex turn failed")
	ErrStreamFailed = errors.New("codex stream failed")
	ErrInvalidSchema = errors.New("invalid output schema")
)
```

And a structured error type:

```go
type ExecError struct {
	Command []string
	Stderr  string
	Code    int
	Signal  string
}
```

Rules:

- process spawn failure returns a plain wrapped error
- non-zero exit after stream completion returns `*ExecError`
- malformed JSONL line returns parse error with the original line attached
- `turn.failed` becomes a wrapped `ErrTurnFailed`
- context cancellation returns `context.Canceled` or `context.DeadlineExceeded`

## Interaction with the current `app-server` client

The new SDK-parity package should initially coexist with the current low-level client.

### Phase 1 usage

Use new package for:

- turn execution parity
- isolated test coverage
- future provider-independent adapter contract design

Keep existing package for:

- thread list
- thread readback
- current `Manager` integration

### Phase 2 usage

Once the new package is stable, decide whether `Manager` should:

- keep using `app-server` for thread discovery and readback
- use the SDK-parity `exec` path for turn submission

That split is acceptable if clearly documented.

### Architecture rule

Do not create two competing session truth stores.

The new Go SDK package is an execution adapter, not a persistence layer.

## Parity matrix

| Capability | TypeScript SDK | Go parity target | Notes |
|---|---|---|---|
| Start thread | Yes | Yes | thread id learned from first event |
| Resume thread | Yes | Yes | `resume <thread-id>` |
| Buffered run | Yes | Yes | drains streamed path |
| Streamed run | Yes | Yes | source-of-truth path |
| String input | Yes | Yes | direct |
| Text parts input | Yes | Yes | joined with blank line |
| Local images | Yes | Yes | repeated `--image` |
| Output schema | Yes | Yes | temp file with cleanup |
| Thread options | Yes | Yes | all current fields |
| Client config flattening | Yes | Yes | TOML literal serializer |
| Base URL override | Yes | Yes | config bridge |
| API key override | Yes | Yes | env bridge |
| Env override | Yes | Yes | full replacement semantics |
| Binary override | Yes | Yes | Go-native path resolution |
| Cancellation | Yes | Yes | `context.Context` |
| Event union | Yes | Yes | same event kinds |
| Item union | Yes | Yes | same item kinds |
| Override precedence | Yes | Yes | thread > client |
| TS class API shape | Yes | No | intentionally Go-shaped |
| npm binary auto-discovery | Yes | No | TS packaging concern, not runtime parity |

## Implementation phases

### Phase A: Type model and exec runner

Deliver:

- option enums and structs
- config serializer
- binary resolution
- exec runner with context cancellation

Validation:

- unit tests for args assembly
- unit tests for env behavior
- unit tests for serializer edge cases

### Phase B: Thread and turn API

Deliver:

- `Client`
- `Thread`
- streamed event decoding
- buffered turn aggregation
- schema temp-file handling

Validation:

- fixture-driven tests for event decoding
- buffered turn behavior tests
- schema cleanup tests

### Phase C: Parity test suite

Deliver:

- Go tests mirroring the TypeScript SDK integration cases
- golden parity fixtures
- behavior comparison notes

Validation:

- same feature list as the current TS SDK tests covered in Go
- evidence report written under validation artifacts

### Phase D: `orchd` integration decision

Deliver:

- explicit choice on whether the current `Manager` adopts the new package for turn execution
- adapter boundary doc update

Validation:

- end-to-end local session still works
- no session truth duplication introduced

## Required tests

At minimum, mirror the TypeScript coverage for:

- thread id gets populated after first run
- repeated runs continue the same thread
- resumed thread continues prior conversation
- thread options are passed through
- client config is serialized correctly
- thread options override client config
- output schema temp file is written then removed
- text parts are joined correctly
- image parts become repeated `--image`
- working directory is passed through
- non-git working directory errors without skip flag
- cancellation before execution fails
- cancellation during execution fails
- abnormal process exit returns structured error
- `turn.failed` turns into a Go error

## Validation evidence plan

This repo does not accept "looks right" as done.

When implementation starts, record evidence under:

```text
storage/artifacts/validation/codex_go_client_parity_<timestamp>/
```

Expected evidence:

- `go_test.txt`
- `parity_matrix.md`
- `args_snapshot.json`
- `event_fixtures.jsonl`
- `summary.md`

And one repo-tracked note linking the artifact path from the validation plan or task log.

## Recommendation

Implement this as a new high-level Go package under `internal/codex/sdk`.

Do not try to mutate the current `app-server` client into the TypeScript SDK shape.

That would mix two different layers:

- low-level control-plane RPC transport
- high-level turn execution SDK

They solve different problems. Keeping them separate is the cleaner move and the one least likely to rot.

## Immediate next step

Create the package skeleton and parity tests first, before any `Manager` integration.

That gives us a clean answer to the only question that matters:

"Can the Go client actually match the official SDK behavior?"

If yes, integrate it.
If not, contain the mismatch at the package boundary instead of leaking it into the whole server.
