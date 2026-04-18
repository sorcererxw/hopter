package terminal

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

type PTYRuntime struct {
	cmd    *exec.Cmd
	pty    *os.File
	exitCh chan error
}

func StartPTY(ctx context.Context, shellPath, cwd string, cols, rows uint16) (*PTYRuntime, error) {
	if shellPath == "" {
		return nil, fmt.Errorf("shell path is required")
	}
	if cols == 0 {
		cols = 120
	}
	if rows == 0 {
		rows = 32
	}

	cmd := exec.CommandContext(ctx, shellPath, "-l", "-i")
	cmd.Dir = cwd
	cmd.Env = os.Environ()

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return nil, fmt.Errorf("start pty: %w", err)
	}

	runtime := &PTYRuntime{
		cmd:    cmd,
		pty:    f,
		exitCh: make(chan error, 1),
	}
	go func() {
		runtime.exitCh <- cmd.Wait()
		close(runtime.exitCh)
	}()

	return runtime, nil
}

func (r *PTYRuntime) ShellPath() string {
	if r == nil || r.cmd == nil {
		return ""
	}
	return r.cmd.Path
}

func (r *PTYRuntime) ShellPID() int {
	if r == nil || r.cmd == nil || r.cmd.Process == nil {
		return 0
	}
	return r.cmd.Process.Pid
}

func (r *PTYRuntime) ShellProcessGroup() int {
	pid := r.ShellPID()
	if pid == 0 {
		return 0
	}
	pgrp, err := unix.Getpgid(pid)
	if err != nil {
		return 0
	}
	return pgrp
}

func (r *PTYRuntime) ShellName() string {
	return filepath.Base(r.ShellPath())
}

func (r *PTYRuntime) Read(p []byte) (int, error) {
	if r == nil || r.pty == nil {
		return 0, io.EOF
	}
	return r.pty.Read(p)
}

func (r *PTYRuntime) Write(p []byte) (int, error) {
	if r == nil || r.pty == nil {
		return 0, io.ErrClosedPipe
	}
	return r.pty.Write(p)
}

func (r *PTYRuntime) Resize(cols, rows uint16) error {
	if r == nil || r.pty == nil {
		return io.ErrClosedPipe
	}
	return pty.Setsize(r.pty, &pty.Winsize{Cols: cols, Rows: rows})
}

func (r *PTYRuntime) Kill() error {
	if r == nil || r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	return r.cmd.Process.Kill()
}

func (r *PTYRuntime) Close() error {
	if r == nil || r.pty == nil {
		return nil
	}
	return r.pty.Close()
}

func (r *PTYRuntime) ExitCh() <-chan error {
	if r == nil {
		ch := make(chan error)
		close(ch)
		return ch
	}
	return r.exitCh
}

func (r *PTYRuntime) ForegroundProcessGroup() (int, error) {
	if r == nil || r.pty == nil {
		return 0, io.ErrClosedPipe
	}
	return unix.IoctlGetInt(int(r.pty.Fd()), unix.TIOCGPGRP)
}
