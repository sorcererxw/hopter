package hoststate

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const stateFileName = "server.json"

type State struct {
	PID           int       `json:"pid"`
	URL           string    `json:"url"`
	BindAddr      string    `json:"bind_addr"`
	Local         bool      `json:"local"`
	SocketPath    string    `json:"socket_path,omitempty"`
	Mode          string    `json:"mode"`
	InstallSource string    `json:"install_source"`
	LogPath       string    `json:"log_path,omitempty"`
	ErrorLogPath  string    `json:"error_log_path,omitempty"`
	StartedAt     time.Time `json:"started_at"`
}

func Path() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return filepath.Join(".hopter", stateFileName)
	}
	return filepath.Join(home, ".hopter", stateFileName)
}

func LogPaths() (string, string) {
	dir := filepath.Dir(Path())
	return filepath.Join(dir, "logs", "hopter.log"), filepath.Join(dir, "logs", "hopter.err.log")
}

func Write(state State) error {
	path := Path()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func Read() (State, error) {
	data, err := os.ReadFile(Path())
	if err != nil {
		return State{}, err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return State{}, err
	}
	return state, nil
}

func RemoveForPID(pid int) error {
	state, err := Read()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if state.PID != pid {
		return nil
	}
	if err := os.Remove(Path()); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove host state: %w", err)
	}
	return nil
}
