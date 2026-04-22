package codex

import (
	"fmt"
	"strings"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

func userTranscriptItem(input string) core.SessionTranscriptItem {
	body := strings.TrimSpace(input)
	now := time.Now().UTC().UnixNano()
	id := fmt.Sprintf("local-user-%d", now)
	return core.SessionTranscriptItem{
		ID:          id,
		OrderKey:    fmt.Sprintf("local:%020d:%s", now, id),
		Kind:        core.SessionTranscriptItemKindUserMessage,
		Title:       "You",
		Body:        body,
		DisplayBody: formatUserMessageForDisplay(body),
	}
}
