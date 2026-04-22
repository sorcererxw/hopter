package gitops

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const maxGitOutputBytes = 32 * 1024

type gitCommand struct {
	args    []string
	timeout time.Duration
	step    string
}

type commandOutput struct {
	stdout string
	stderr string
}

type commandError struct {
	Step     string
	ExitCode int
	Stdout   string
	Stderr   string
}

func (e *commandError) Error() string {
	if e.Stderr != "" {
		return fmt.Sprintf("%s failed: %s", e.Step, e.Stderr)
	}
	return fmt.Sprintf("%s failed", e.Step)
}

type runner struct{}

func newRunner() *runner {
	return &runner{}
}

func (r *runner) run(ctx context.Context, root string, spec gitCommand) (commandOutput, error) {
	timeout := spec.timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := append([]string{"-C", root}, spec.args...)
	cmd := exec.CommandContext(runCtx, "git", args...)
	cmd.Stdin = nil
	cmd.Env = append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_ASKPASS=",
		"SSH_ASKPASS=",
		"GIT_LITERAL_PATHSPECS=1",
	)

	var stdout, stderr limitedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	out := commandOutput{
		stdout: stdout.String(),
		stderr: stderr.String(),
	}
	if runCtx.Err() == context.DeadlineExceeded {
		return out, &commandError{
			Step:     spec.step,
			ExitCode: -1,
			Stdout:   truncateDiagnostic(out.stdout),
			Stderr:   "git command timed out",
		}
	}
	if err != nil {
		exitCode := -1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
		return out, &commandError{
			Step:     spec.step,
			ExitCode: exitCode,
			Stdout:   truncateDiagnostic(out.stdout),
			Stderr:   truncateDiagnostic(out.stderr),
		}
	}
	return out, nil
}

type limitedBuffer struct {
	buf bytes.Buffer
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := maxGitOutputBytes - b.buf.Len()
	if remaining > 0 {
		if len(p) > remaining {
			_, _ = b.buf.Write(p[:remaining])
		} else {
			_, _ = b.buf.Write(p)
		}
	}
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	return truncateDiagnostic(b.buf.String())
}

func truncateDiagnostic(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= maxGitOutputBytes {
		return value
	}
	return value[:maxGitOutputBytes] + "\n[truncated]"
}
