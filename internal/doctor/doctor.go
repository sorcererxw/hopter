package doctor

import (
	"fmt"
	"net"
	"os"
	"path/filepath"

	"orchd/internal/app"
)

type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type Report struct {
	Checks []Check `json:"checks"`
}

func Run(version string, installSource string) (Report, error) {
	report := Report{}

	executablePath, err := os.Executable()
	if err != nil {
		report.addFail("resolve executable", err.Error())
		return report, err
	}
	resolvedPath, err := filepath.EvalSymlinks(executablePath)
	if err != nil {
		report.addFail("resolve executable", fmt.Sprintf("%s: %v", executablePath, err))
		return report, err
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		report.addFail("stat executable", err.Error())
		return report, err
	}
	report.addPass("resolve executable", resolvedPath)

	if info.Mode()&0o111 == 0 {
		err := fmt.Errorf("binary is not marked executable")
		report.addFail("check executable mode", err.Error())
		return report, err
	}
	report.addPass("check executable mode", info.Mode().String())

	cfg, err := app.LoadConfig(version, installSource)
	if err != nil {
		report.addFail("load config", err.Error())
		return report, err
	}
	report.addPass("load config", fmt.Sprintf("addr=%s ui_mode=%s", cfg.HTTP.Addr(), cfg.UI.Mode()))
	report.addPass("install source", cfg.InstallSource)

	runtime, err := app.NewRuntime(cfg)
	if err != nil {
		report.addFail("bootstrap runtime", err.Error())
		return report, err
	}
	report.addPass("bootstrap runtime", "core services initialized")

	listener, err := net.Listen("tcp", cfg.HTTP.Addr())
	if err != nil {
		report.addFail("bind configured address", err.Error())
		return report, err
	}
	_ = listener.Close()
	report.addPass("bind configured address", cfg.HTTP.Addr())

	backends := runtime.Workspace.ListBackends()
	requiredAvailable := true
	for _, backend := range backends {
		switch {
		case backend.Key == "codex" && backend.Available:
			report.addPass("backend codex", "available on PATH")
		case backend.Key == "codex" && !backend.Available:
			requiredAvailable = false
			report.addFail("backend codex", backend.Reason)
		case backend.Available:
			report.addPass("backend "+backend.Key, "available on PATH")
		default:
			report.addWarn("backend "+backend.Key, backend.Reason)
		}
	}

	if !requiredAvailable {
		return report, fmt.Errorf("required backend checks failed")
	}

	return report, nil
}

func (r *Report) addPass(name, detail string) {
	r.Checks = append(r.Checks, Check{Name: name, Status: "PASS", Detail: detail})
}

func (r *Report) addWarn(name, detail string) {
	r.Checks = append(r.Checks, Check{Name: name, Status: "WARN", Detail: detail})
}

func (r *Report) addFail(name, detail string) {
	r.Checks = append(r.Checks, Check{Name: name, Status: "FAIL", Detail: detail})
}
