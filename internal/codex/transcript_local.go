package codex

import (
	"fmt"
	"strings"
	"time"

	"orchd/internal/core"
)

func userTranscriptItem(input string) core.SessionTranscriptItem {
	body := strings.TrimSpace(input)
	return core.SessionTranscriptItem{
		ID:    fmt.Sprintf("local-user-%d", time.Now().UTC().UnixNano()),
		Kind:  core.SessionTranscriptItemKindUserMessage,
		Title: "You",
		Body:  body,
	}
}
