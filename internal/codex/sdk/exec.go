package sdk

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

const internalOriginatorEnv = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE"
const goSDKOriginator = "codex_sdk_go"

type execRequest struct {
	input                 string
	threadID              string
	images                []string
	model                 string
	sandboxMode           SandboxMode
	workingDirectory      string
	additionalDirectories []string
	skipGitRepoCheck      bool
	outputSchemaFile      string
	modelReasoningEffort  ModelReasoningEffort
	networkAccessEnabled  *bool
	webSearchMode         WebSearchMode
	webSearchEnabled      *bool
	approvalPolicy        ApprovalPolicy
}

type execStream struct {
	lines <-chan string
	done  <-chan error
}

func (s *execStream) wait() error {
	return <-s.done
}

type execRunner struct {
	codexPath string
	opts      ClientOptions
}

func newExecRunner(opts ClientOptions) (*execRunner, error) {
	path := strings.TrimSpace(opts.CodexPath)
	if path == "" {
		var err error
		path, err = exec.LookPath("codex")
		if err != nil {
			return nil, fmt.Errorf("resolve codex binary: %w", err)
		}
	}
	return &execRunner{codexPath: path, opts: opts}, nil
}

func (r *execRunner) buildArgs(req execRequest) ([]string, error) {
	args := []string{"exec", "--experimental-json"}
	overrides, err := serializeConfigOverrides(r.opts.Config)
	if err != nil {
		return nil, err
	}
	for _, override := range overrides {
		args = append(args, "--config", override)
	}
	if r.opts.BaseURL != "" {
		raw, _ := json.Marshal(r.opts.BaseURL)
		args = append(args, "--config", "openai_base_url="+string(raw))
	}
	if req.model != "" {
		args = append(args, "--model", req.model)
	}
	if req.sandboxMode != "" {
		args = append(args, "--sandbox", string(req.sandboxMode))
	}
	if req.workingDirectory != "" {
		args = append(args, "--cd", req.workingDirectory)
	}
	for _, dir := range req.additionalDirectories {
		args = append(args, "--add-dir", dir)
	}
	if req.skipGitRepoCheck {
		args = append(args, "--skip-git-repo-check")
	}
	if req.outputSchemaFile != "" {
		args = append(args, "--output-schema", req.outputSchemaFile)
	}
	if req.modelReasoningEffort != "" {
		args = append(args, "--config", `model_reasoning_effort="`+string(req.modelReasoningEffort)+`"`)
	}
	if req.networkAccessEnabled != nil {
		args = append(args, "--config", "sandbox_workspace_write.network_access="+boolString(*req.networkAccessEnabled))
	}
	if req.webSearchMode != "" {
		args = append(args, "--config", `web_search="`+string(req.webSearchMode)+`"`)
	} else if req.webSearchEnabled != nil {
		if *req.webSearchEnabled {
			args = append(args, "--config", `web_search="live"`)
		} else {
			args = append(args, "--config", `web_search="disabled"`)
		}
	}
	if req.approvalPolicy != "" {
		args = append(args, "--config", `approval_policy="`+string(req.approvalPolicy)+`"`)
	}
	if req.threadID != "" {
		args = append(args, "resume", req.threadID)
	}
	for _, image := range req.images {
		args = append(args, "--image", image)
	}
	return args, nil
}

func (r *execRunner) buildEnv() []string {
	envMap := map[string]string{}
	if r.opts.Env != nil {
		for key, value := range r.opts.Env {
			envMap[key] = value
		}
	} else {
		for _, entry := range os.Environ() {
			key, value, ok := strings.Cut(entry, "=")
			if ok {
				envMap[key] = value
			}
		}
	}
	if _, ok := envMap[internalOriginatorEnv]; !ok {
		envMap[internalOriginatorEnv] = goSDKOriginator
	}
	if r.opts.APIKey != "" {
		envMap["CODEX_API_KEY"] = r.opts.APIKey
	}
	keys := make([]string, 0, len(envMap))
	for key := range envMap {
		keys = append(keys, key)
	}
	sortStrings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+envMap[key])
	}
	return env
}

func (r *execRunner) run(ctx context.Context, req execRequest) (*execStream, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	args, err := r.buildArgs(req)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, r.codexPath, args...)
	cmd.Env = r.buildEnv()

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	go func() {
		_, _ = io.WriteString(stdin, req.input)
		_ = stdin.Close()
	}()

	lineCh := make(chan string)
	doneCh := make(chan error, 1)

	go func() {
		defer close(lineCh)
		defer close(doneCh)

		scanner := bufio.NewScanner(stdout)
		buf := make([]byte, 0, 1024*64)
		scanner.Buffer(buf, 1024*1024*10)

		for scanner.Scan() {
			select {
			case lineCh <- scanner.Text():
			case <-ctx.Done():
				_ = cmd.Wait()
				doneCh <- ctx.Err()
				return
			}
		}

		scanErr := scanner.Err()
		waitErr := cmd.Wait()
		if ctx.Err() != nil {
			doneCh <- ctx.Err()
			return
		}
		if scanErr != nil {
			doneCh <- scanErr
			return
		}
		if waitErr != nil {
			doneCh <- buildExecError(r.codexPath, args, stderr.String(), waitErr)
			return
		}
		doneCh <- nil
	}()

	return &execStream{lines: lineCh, done: doneCh}, nil
}

func buildExecError(path string, args []string, stderr string, runErr error) error {
	var exitErr *exec.ExitError
	if !errors.As(runErr, &exitErr) {
		return runErr
	}
	code := exitErr.ExitCode()
	return &ExecError{
		Command: append([]string{path}, args...),
		Stderr:  stderr,
		Code:    code,
	}
}

func boolString(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

func sortStrings(values []string) {
	for i := 0; i < len(values); i++ {
		for j := i + 1; j < len(values); j++ {
			if values[j] < values[i] {
				values[i], values[j] = values[j], values[i]
			}
		}
	}
}
