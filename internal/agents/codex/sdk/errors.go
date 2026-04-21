package sdk

import "errors"

var (
	ErrTurnFailed    = errors.New("codex turn failed")
	ErrStreamFailed  = errors.New("codex stream failed")
	ErrInvalidSchema = errors.New("invalid output schema")
)

type ExecError struct {
	Command []string
	Stderr  string
	Code    int
	Signal  string
}

func (e *ExecError) Error() string {
	if e == nil {
		return ""
	}
	if e.Signal != "" {
		return "codex exec exited with signal " + e.Signal + ": " + e.Stderr
	}
	return "codex exec exited with code " + itoa(e.Code) + ": " + e.Stderr
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	negative := v < 0
	if negative {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + (v % 10))
		v /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
