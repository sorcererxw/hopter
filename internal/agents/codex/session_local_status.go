package codex

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	osExec "os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var localCodexRunningMarkerTTL = 2 * time.Minute
var listLocalCodexExecProcesses = listLocalCodexExecProcessesDefault
var signalLocalCodexExecProcess = signalLocalCodexExecProcessDefault

type localCodexSessionRuntime struct {
	Cwd       string
	Path      string
	Running   bool
	Source    string
	StartedAt time.Time
}

type localCodexExecProcess struct {
	Command string
	PID     int
}

func localCodexSessionRunning(sessionID string) bool {
	status := localCodexSessionRuntimeStatus(sessionID)
	return status.Running
}

func localCodexSessionRuntimeStatus(sessionID string) localCodexSessionRuntime {
	path := localCodexSessionFile(sessionID)
	if path == "" {
		return localCodexSessionRuntime{}
	}
	status := parseLocalCodexSessionRuntime(path)
	if status.Running {
		if strings.EqualFold(status.Source, "exec") {
			status.Running = localCodexExecProcessActive(status)
		} else if time.Since(status.fileModTime()) > localCodexRunningMarkerTTL {
			status.Running = false
		}
	}
	return status
}

func parseLocalCodexSessionRuntime(path string) localCodexSessionRuntime {
	status := localCodexSessionRuntime{Path: path}
	file, err := os.Open(path)
	if err != nil {
		return status
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	const maxScanTokenSize = 4 << 20
	scanner.Buffer(make([]byte, 0, 64*1024), maxScanTokenSize)
	for scanner.Scan() {
		line := scanner.Text()
		readLocalCodexSessionMeta(line, &status)
		if !strings.Contains(line, "function_call") && !strings.Contains(line, "command_execution") {
			continue
		}
		switch {
		case strings.Contains(line, `"type":"command_execution"`) &&
			strings.Contains(line, `"status":"in_progress"`):
			status.Running = true
		case strings.Contains(line, `"type":"command_execution"`) &&
			(strings.Contains(line, `"status":"completed"`) ||
				strings.Contains(line, `"status":"failed"`)):
			status.Running = false
		case strings.Contains(line, `"type":"function_call"`) &&
			strings.Contains(line, `"name":"exec_command"`):
			status.Running = true
		case strings.Contains(line, "Process running with session ID"):
			status.Running = true
		case strings.Contains(line, "Process exited with code"),
			strings.Contains(line, "Process exited with signal"),
			strings.Contains(line, `"type":"function_call_output"`):
			status.Running = false
		}
	}
	return status
}

func readLocalCodexSessionMeta(line string, status *localCodexSessionRuntime) {
	if status == nil || !strings.Contains(line, `"type":"session_meta"`) {
		return
	}
	var event struct {
		Timestamp string `json:"timestamp"`
		Payload   struct {
			Cwd       string `json:"cwd"`
			Source    string `json:"source"`
			Timestamp string `json:"timestamp"`
		} `json:"payload"`
	}
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		return
	}
	status.Cwd = strings.TrimSpace(event.Payload.Cwd)
	status.Source = strings.TrimSpace(event.Payload.Source)
	startedAt := strings.TrimSpace(event.Payload.Timestamp)
	if startedAt == "" {
		startedAt = strings.TrimSpace(event.Timestamp)
	}
	if parsed, err := time.Parse(time.RFC3339Nano, startedAt); err == nil {
		status.StartedAt = parsed
	}
}

func (s localCodexSessionRuntime) fileModTime() time.Time {
	info, err := os.Stat(s.Path)
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}

func localCodexExecProcessActive(status localCodexSessionRuntime) bool {
	_, ok := localCodexExecProcessForSession(status)
	return ok
}

func interruptLocalCodexExecSession(sessionID string) error {
	status := localCodexSessionRuntimeStatus(sessionID)
	if !status.Running {
		return fmt.Errorf("session %q has no running local codex exec process", sessionID)
	}
	process, ok := localCodexExecProcessForSession(status)
	if !ok {
		return fmt.Errorf("session %q running codex exec process not found", sessionID)
	}
	if err := signalLocalCodexExecProcess(process.PID); err != nil {
		return fmt.Errorf("interrupt codex exec pid %d: %w", process.PID, err)
	}
	return nil
}

func localCodexExecProcessForSession(status localCodexSessionRuntime) (localCodexExecProcess, bool) {
	processes, err := listLocalCodexExecProcesses()
	if err != nil {
		return localCodexExecProcess{}, false
	}
	var matches []localCodexExecProcess
	for _, process := range processes {
		if !localCodexExecProcessMatchesSession(process, status) {
			continue
		}
		matches = append(matches, process)
	}
	if len(matches) != 1 {
		return localCodexExecProcess{}, false
	}
	return matches[0], true
}

func localCodexExecProcessMatchesSession(process localCodexExecProcess, status localCodexSessionRuntime) bool {
	if !strings.Contains(process.Command, "codex exec") {
		return false
	}
	if status.Cwd != "" && !strings.Contains(process.Command, status.Cwd) {
		return false
	}
	return true
}

func listLocalCodexExecProcessesDefault() ([]localCodexExecProcess, error) {
	output, err := osExec.Command("ps", "-axo", "pid=,command=").Output()
	if err != nil {
		return nil, err
	}
	processes := make([]localCodexExecProcess, 0)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		process, ok := parseLocalCodexExecProcess(scanner.Text())
		if ok {
			processes = append(processes, process)
		}
	}
	return processes, scanner.Err()
}

func parseLocalCodexExecProcess(line string) (localCodexExecProcess, bool) {
	line = strings.TrimSpace(line)
	pidText, rest, ok := strings.Cut(line, " ")
	if !ok {
		return localCodexExecProcess{}, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(pidText))
	if err != nil {
		return localCodexExecProcess{}, false
	}
	command := strings.TrimSpace(rest)
	if !strings.Contains(command, "codex exec") {
		return localCodexExecProcess{}, false
	}
	return localCodexExecProcess{PID: pid, Command: command}, true
}

func signalLocalCodexExecProcessDefault(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(os.Interrupt)
}

func localCodexSessionFile(sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return ""
	}

	root := codexSessionsRoot()
	if root == "" {
		return ""
	}

	var match string
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || match != "" || entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if strings.Contains(name, sessionID) && strings.HasSuffix(name, ".jsonl") {
			match = path
		}
		return nil
	})
	return match
}

func codexSessionsRoot() string {
	home := strings.TrimSpace(os.Getenv("CODEX_HOME"))
	if home == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		home = filepath.Join(userHome, ".codex")
	}
	return filepath.Join(home, "sessions")
}
