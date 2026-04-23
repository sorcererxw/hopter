package codex

import (
	"fmt"
	"strings"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

func userTranscriptItem(input string, attachments []core.SessionInputAttachment) core.SessionTranscriptItem {
	body := strings.TrimSpace(input)
	now := time.Now().UTC().UnixNano()
	id := fmt.Sprintf("local-user-%d", now)
	transcriptAttachments := make([]core.SessionTranscriptAttachment, 0, len(attachments))
	for index, attachment := range attachments {
		url := strings.TrimSpace(attachment.URL)
		if url == "" {
			continue
		}
		line := "[image]"
		if label := strings.TrimSpace(attachment.Label); label != "" {
			line += " " + label
		}
		if body == "" {
			body = line
		} else {
			body += "\n" + line
		}
		transcriptAttachments = append(transcriptAttachments, core.SessionTranscriptAttachment{
			ID:          fmt.Sprintf("%s-image-%d", id, index),
			Kind:        core.SessionTranscriptAttachmentKindImage,
			Label:       firstNonEmptyString(strings.TrimSpace(attachment.Label), "Image"),
			URL:         url,
			ContentType: strings.TrimSpace(attachment.ContentType),
		})
	}
	return core.SessionTranscriptItem{
		ID:          id,
		OrderKey:    fmt.Sprintf("local:%020d:%s", now, id),
		Kind:        core.SessionTranscriptItemKindUserMessage,
		Title:       "You",
		Body:        body,
		DisplayBody: formatUserMessageForDisplay(body),
		Attachments: transcriptAttachments,
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
