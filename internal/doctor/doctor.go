package doctor

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/sorcererxw/hopter/internal/app"
	"github.com/sorcererxw/hopter/internal/hoststate"
)

type Check struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Detail     string `json:"detail,omitempty"`
	Suggestion string `json:"suggestion,omitempty"`
}

type Report struct {
	Checks []Check `json:"checks"`
}

func Run(version string, installSource string) (Report, error) {
	report := Report{}

	executablePath, err := os.Executable()
	if err != nil {
		report.addFail("resolve executable", err.Error(), "Run hopter from an installed binary or rebuild the local command.")
		return report, report.err()
	}
	resolvedPath, err := filepath.EvalSymlinks(executablePath)
	if err != nil {
		report.addFail("resolve executable", fmt.Sprintf("%s: %v", executablePath, err), "Reinstall Hopter or check the symlink target.")
		return report, report.err()
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		report.addFail("stat executable", err.Error(), "Reinstall Hopter or check file permissions.")
		return report, report.err()
	}
	report.addPass("resolve executable", resolvedPath)

	if info.Mode()&0o111 == 0 {
		report.addFail("check executable mode", "binary is not marked executable", "Run chmod +x on the binary or reinstall Hopter.")
		return report, report.err()
	}
	report.addPass("check executable mode", info.Mode().String())

	cfg, err := app.LoadConfig(version, installSource)
	if err != nil {
		report.addFail("load config", err.Error(), "Check Hopter flags and environment variables.")
		return report, report.err()
	}
	report.addPass("load config", fmt.Sprintf("addr=%s ui_mode=%s", cfg.HTTP.Addr(), cfg.UI.Mode()))
	report.addPass("install source", cfg.InstallSource)

	checkBind(&report, cfg)
	checkCodex(&report)
	checkRelayAuth(&report, cfg)
	checkHostState(&report)

	return report, report.err()
}

func checkBind(report *Report, cfg app.Config) {
	listener, err := net.Listen("tcp", cfg.HTTP.Addr())
	if err != nil {
		report.addWarn("bind configured address", err.Error(), "If Hopter is already running, this is expected. Otherwise run hopter stop or choose another port with --port.")
		return
	}
	_ = listener.Close()
	report.addPass("bind configured address", cfg.HTTP.Addr())
}

func checkCodex(report *Report) {
	path, err := exec.LookPath("codex")
	if err != nil {
		report.addFail("codex binary", "codex is not available on PATH", "Install Codex or add it to PATH. Homebrew services may need an absolute Codex path because launchd does not read shell startup files.")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "--version").CombinedOutput()
	if err != nil {
		report.addWarn("codex version", strings.TrimSpace(string(output)), "Codex is present but version probing failed; run codex --version in a terminal.")
		return
	}
	report.addPass("codex binary", path)
	if text := strings.TrimSpace(string(output)); text != "" {
		report.addPass("codex version", text)
	}
}

func checkRelayAuth(report *Report, cfg app.Config) {
	if strings.TrimSpace(cfg.Relay.AuthPath) == "" {
		report.addWarn("relay auth", "no relay auth path configured", "Run hopter server --relay to start the login flow.")
		return
	}
	if _, err := os.Stat(cfg.Relay.AuthPath); err == nil {
		report.addPass("relay auth", cfg.Relay.AuthPath)
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		report.addWarn("relay auth", err.Error(), "Check relay auth file permissions or run hopter server --relay to refresh login.")
		return
	}
	report.addWarn("relay auth", "not logged in", "Run hopter server --relay to start the login flow.")
}

func checkHostState(report *Report) {
	state, err := hoststate.Read()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			report.addWarn("server state", "no saved server state", "Run hopter or hopter server --background to start Hopter.")
			return
		}
		report.addWarn("server state", err.Error(), "Delete "+hoststate.Path()+" if the state file is corrupt.")
		return
	}
	detail := fmt.Sprintf("pid=%d url=%s mode=%s started_at=%s", state.PID, state.URL, state.Mode, state.StartedAt.Format(time.RFC3339))
	if !state.Local && strings.TrimSpace(state.SocketPath) != "" {
		detail = fmt.Sprintf("pid=%d local=false socket=%s mode=%s started_at=%s", state.PID, state.SocketPath, state.Mode, state.StartedAt.Format(time.RFC3339))
	}
	if stateReady(state, 150*time.Millisecond) {
		report.addPass("server state", detail)
		return
	}
	report.addWarn("server state", detail+" stale_or_offline", "Run hopter stop to clean up stale state, then start Hopter again.")
}

func tcpReady(addr string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func unixReady(path string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("unix", path, timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func stateReady(state hoststate.State, timeout time.Duration) bool {
	if !state.Local && strings.TrimSpace(state.SocketPath) != "" {
		return unixReady(state.SocketPath, timeout)
	}
	return tcpReady(state.BindAddr, timeout)
}

func (r *Report) err() error {
	for _, check := range r.Checks {
		if check.Status == "FAIL" {
			return fmt.Errorf("one or more doctor checks failed")
		}
	}
	return nil
}

func (r *Report) addPass(name, detail string) {
	r.Checks = append(r.Checks, Check{Name: name, Status: "PASS", Detail: detail})
}

func (r *Report) addWarn(name, detail, suggestion string) {
	r.Checks = append(r.Checks, Check{Name: name, Status: "WARN", Detail: detail, Suggestion: suggestion})
}

func (r *Report) addFail(name, detail, suggestion string) {
	r.Checks = append(r.Checks, Check{Name: name, Status: "FAIL", Detail: detail, Suggestion: suggestion})
}
