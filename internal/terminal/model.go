package terminal

import (
	"bytes"
	"time"
)

type Status string

const (
	StatusStarting   Status = "starting"
	StatusLive       Status = "live"
	StatusExited     Status = "exited"
	StatusTerminated Status = "terminated"
	StatusDegraded   Status = "degraded"
	StatusFailed     Status = "failed"
)

type SessionKey struct {
	BrowserInstanceID string
	TabID             string
	SessionID         string
}

type Session struct {
	ID                           string
	ProjectID                    string
	SessionID                    string
	BrowserInstanceID            string
	TabID                        string
	CWD                          string
	Shell                        string
	Status                       Status
	CreatedAt                    time.Time
	LastActivityAt               time.Time
	LastOutputAt                 time.Time
	ExitCode                     *int
	Detached                     bool
	LastForegroundCommandSummary string
	LastForegroundCommandExited  bool
}

func (s Session) GetID() string {
	return s.ID
}

func (s Session) Key() SessionKey {
	return SessionKey{
		BrowserInstanceID: s.BrowserInstanceID,
		TabID:             s.TabID,
		SessionID:         s.SessionID,
	}
}

type ReplayBuffer struct {
	maxBytes int
	buf      []byte
}

func NewReplayBuffer(maxBytes int) *ReplayBuffer {
	if maxBytes <= 0 {
		maxBytes = 128 * 1024
	}
	return &ReplayBuffer{maxBytes: maxBytes}
}

func (b *ReplayBuffer) Append(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	if len(chunk) >= b.maxBytes {
		b.buf = append(b.buf[:0], chunk[len(chunk)-b.maxBytes:]...)
		return
	}
	if overflow := len(b.buf) + len(chunk) - b.maxBytes; overflow > 0 {
		b.buf = append([]byte(nil), b.buf[overflow:]...)
	}
	b.buf = append(b.buf, chunk...)
}

func (b *ReplayBuffer) AppendString(chunk string) {
	b.Append([]byte(chunk))
}

func (b *ReplayBuffer) Bytes() []byte {
	return bytes.Clone(b.buf)
}

func (b *ReplayBuffer) Reset() {
	b.buf = b.buf[:0]
}
