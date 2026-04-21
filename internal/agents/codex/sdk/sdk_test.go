package sdk

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSerializeConfigOverrides(t *testing.T) {
	overrides, err := serializeConfigOverrides(map[string]any{
		"approval_policy": "never",
		"sandbox_workspace_write": map[string]any{
			"network_access": true,
		},
		"retry_budget": 3,
		"tool_rules": map[string]any{
			"allow": []any{"git status", "git diff"},
		},
	})
	if err != nil {
		t.Fatalf("serializeConfigOverrides: %v", err)
	}

	want := []string{
		`approval_policy="never"`,
		`retry_budget=3`,
		`sandbox_workspace_write.network_access=true`,
		`tool_rules.allow=["git status", "git diff"]`,
	}
	for _, expected := range want {
		if !contains(overrides, expected) {
			t.Fatalf("overrides missing %q: %#v", expected, overrides)
		}
	}
}

func TestBuildArgsKeepsThreadOverridesAfterClientOverrides(t *testing.T) {
	runner := &execRunner{
		codexPath: "codex",
		opts: ClientOptions{
			Config: map[string]any{
				"approval_policy": "never",
			},
		},
	}

	args, err := runner.buildArgs(execRequest{
		approvalPolicy: ApprovalPolicyOnRequest,
		threadID:       "thread-1",
		images:         []string{"img.png"},
	})
	if err != nil {
		t.Fatalf("buildArgs: %v", err)
	}

	got := collectConfigValues(args, "approval_policy")
	want := []string{`approval_policy="never"`, `approval_policy="on-request"`}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("approval_policy overrides = %#v, want %#v", got, want)
	}
	if indexOf(args, "resume") > indexOf(args, "--image") {
		t.Fatalf("resume must appear before image args: %#v", args)
	}
}

func TestBuildEnvUsesOverrideMapWithoutLeakingProcessEnv(t *testing.T) {
	t.Setenv("CODEX_ENV_SHOULD_NOT_LEAK", "leak")

	runner := &execRunner{
		codexPath: "codex",
		opts: ClientOptions{
			APIKey: "test-key",
			Env: map[string]string{
				"CODEX_HOME": "/tmp/codex-home",
				"CUSTOM_ENV": "custom",
			},
		},
	}

	env := strings.Join(runner.buildEnv(), "\n")
	if strings.Contains(env, "CODEX_ENV_SHOULD_NOT_LEAK=") {
		t.Fatalf("process env leaked into override env: %s", env)
	}
	for _, expected := range []string{
		"CODEX_HOME=/tmp/codex-home",
		"CUSTOM_ENV=custom",
		"CODEX_API_KEY=test-key",
		internalOriginatorEnv + "=" + goSDKOriginator,
	} {
		if !strings.Contains(env, expected) {
			t.Fatalf("env missing %q in %s", expected, env)
		}
	}
}

func TestCreateOutputSchemaFileLifecycle(t *testing.T) {
	file, err := createOutputSchemaFile(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"answer": map[string]any{"type": "string"},
		},
	})
	if err != nil {
		t.Fatalf("createOutputSchemaFile: %v", err)
	}
	if _, err := os.Stat(file.schemaPath); err != nil {
		t.Fatalf("schema file should exist before cleanup: %v", err)
	}
	if err := file.cleanup(); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if _, err := os.Stat(file.schemaPath); !os.IsNotExist(err) {
		t.Fatalf("schema file should be removed after cleanup, stat err = %v", err)
	}
}

func TestNormalizeInputCombinesTextPartsAndImages(t *testing.T) {
	prompt, images, err := normalizeInput(PartsInput{
		TextPart{Text: "Describe file changes"},
		TextPart{Text: "Focus on impacted tests"},
		LocalImagePart{Path: "/tmp/first.png"},
		LocalImagePart{Path: "/tmp/second.jpg"},
	})
	if err != nil {
		t.Fatalf("normalizeInput: %v", err)
	}
	if prompt != "Describe file changes\n\nFocus on impacted tests" {
		t.Fatalf("prompt = %q", prompt)
	}
	if strings.Join(images, "|") != "/tmp/first.png|/tmp/second.jpg" {
		t.Fatalf("images = %#v", images)
	}
}

func TestThreadRunSetsThreadIDAndAggregatesTurn(t *testing.T) {
	script := writeExecutable(t, "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread_1\"}'\nprintf '%s\\n' '{\"type\":\"turn.started\"}'\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"Hi!\"}}'\nprintf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":42,\"cached_input_tokens\":12,\"output_tokens\":5}}'\n")

	client, err := New(ClientOptions{CodexPath: script})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	thread := client.StartThread(ThreadOptions{})
	turn, err := thread.Run(context.Background(), TextInput("Hello, world!"), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if thread.ID() != "thread_1" {
		t.Fatalf("thread ID = %q", thread.ID())
	}
	if turn.FinalResponse != "Hi!" {
		t.Fatalf("final response = %q", turn.FinalResponse)
	}
	if turn.Usage == nil || turn.Usage.CachedInputTokens != 12 || turn.Usage.InputTokens != 42 || turn.Usage.OutputTokens != 5 {
		t.Fatalf("usage = %#v", turn.Usage)
	}
	if len(turn.Items) != 1 {
		t.Fatalf("items len = %d", len(turn.Items))
	}
}

func TestThreadRunReturnsTurnFailedError(t *testing.T) {
	script := writeExecutable(t, "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread_1\"}'\nprintf '%s\\n' '{\"type\":\"turn.failed\",\"error\":{\"message\":\"rate limit exceeded\"}}'\n")

	client, err := New(ClientOptions{CodexPath: script})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	thread := client.StartThread(ThreadOptions{})
	_, err = thread.Run(context.Background(), TextInput("fail"), RunOptions{})
	if err == nil || !strings.Contains(err.Error(), "rate limit exceeded") {
		t.Fatalf("Run error = %v, want turn failure", err)
	}
}

func TestThreadRunStreamedReturnsEventsAndSetsThreadID(t *testing.T) {
	script := writeExecutable(t, "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread_1\"}'\nprintf '%s\\n' '{\"type\":\"turn.started\"}'\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"Hi!\"}}'\nprintf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":42,\"cached_input_tokens\":12,\"output_tokens\":5}}'\n")

	client, err := New(ClientOptions{CodexPath: script})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	thread := client.StartThread(ThreadOptions{})
	stream, err := thread.RunStreamed(context.Background(), TextInput("Hello"), RunOptions{})
	if err != nil {
		t.Fatalf("RunStreamed: %v", err)
	}

	var got []string
	for event := range stream.Events {
		got = append(got, event.EventType())
	}
	for err := range stream.Err {
		if err != nil {
			t.Fatalf("stream error: %v", err)
		}
	}

	want := []string{"thread.started", "turn.started", "item.completed", "turn.completed"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("event sequence = %#v, want %#v", got, want)
	}
	if thread.ID() != "thread_1" {
		t.Fatalf("thread ID = %q", thread.ID())
	}
}

func TestThreadRunReturnsStreamError(t *testing.T) {
	script := writeExecutable(t, "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread_1\"}'\nprintf '%s\\n' '{\"type\":\"error\",\"message\":\"stream disconnected before completion\"}'\n")

	client, err := New(ClientOptions{CodexPath: script})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	thread := client.StartThread(ThreadOptions{})
	_, err = thread.Run(context.Background(), TextInput("fail"), RunOptions{})
	if err == nil || !errors.Is(err, ErrStreamFailed) {
		t.Fatalf("Run error = %v, want ErrStreamFailed", err)
	}
}

func TestThreadRunCanceledBeforeExecution(t *testing.T) {
	script := writeExecutable(t, "#!/bin/sh\ncat >/dev/null\nsleep 1\n")

	client, err := New(ClientOptions{CodexPath: script})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	thread := client.StartThread(ThreadOptions{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err = thread.Run(ctx, TextInput("cancel"), RunOptions{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run error = %v, want context.Canceled", err)
	}
}

func TestThreadRunCanceledDuringExecution(t *testing.T) {
	script := writeExecutable(t, "#!/bin/sh\ncat >/dev/null\nsleep 5\nprintf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"cached_input_tokens\":0,\"output_tokens\":1}}'\n")

	client, err := New(ClientOptions{CodexPath: script})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	thread := client.StartThread(ThreadOptions{})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_, err = thread.Run(ctx, TextInput("cancel"), RunOptions{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run error = %v, want context.Canceled", err)
	}
}

func TestThreadRunReturnsExecErrorOnNonZeroExit(t *testing.T) {
	script := writeExecutable(t, "#!/bin/sh\ncat >/dev/null\necho 'boom' 1>&2\nexit 2\n")

	client, err := New(ClientOptions{CodexPath: script})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	thread := client.StartThread(ThreadOptions{})
	_, err = thread.Run(context.Background(), TextInput("fail"), RunOptions{})
	var execErr *ExecError
	if !errors.As(err, &execErr) {
		t.Fatalf("Run error = %v, want *ExecError", err)
	}
	if execErr.Code != 2 {
		t.Fatalf("exit code = %d, want 2", execErr.Code)
	}
	if !strings.Contains(execErr.Stderr, "boom") {
		t.Fatalf("stderr = %q, want boom", execErr.Stderr)
	}
}

func collectConfigValues(args []string, key string) []string {
	var values []string
	for i := 0; i < len(args); i++ {
		if args[i] == "--config" && i+1 < len(args) && strings.HasPrefix(args[i+1], key+"=") {
			values = append(values, args[i+1])
		}
	}
	return values
}

func indexOf(args []string, value string) int {
	for i, arg := range args {
		if arg == value {
			return i
		}
	}
	return -1
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func writeExecutable(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codex-mock")
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}
