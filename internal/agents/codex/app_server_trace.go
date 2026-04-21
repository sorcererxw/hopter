package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type TraceEntry struct {
	Timestamp time.Time       `json:"ts"`
	Direction string          `json:"direction"`
	Kind      string          `json:"kind"`
	Method    string          `json:"method,omitempty"`
	ID        string          `json:"id,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type appServerTraceWriter struct {
	mu   sync.Mutex
	path string
}

func newAppServerTraceWriter(rootPath, sessionID string) *appServerTraceWriter {
	sessionID = filepath.Base(sessionID)
	return &appServerTraceWriter{
		path: filepath.Join(rootPath, "storage", "runtime", "app-server-traces", sessionID+".jsonl"),
	}
}

func (w *appServerTraceWriter) Write(entry TraceEntry) {
	if w == nil {
		return
	}

	entry.Timestamp = time.Now().UTC()
	line, err := json.Marshal(entry)
	if err != nil {
		return
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(w.path), 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(w.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(line, '\n'))
}

func traceID(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var numeric int64
	if err := json.Unmarshal(raw, &numeric); err == nil {
		return json.Number(string(raw)).String()
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	return string(raw)
}
