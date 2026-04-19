package codex

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/sorcererxw/hopter/internal/core"
)

const transcriptItemLimit = 200

func normalizeTranscriptItems(read *ReadThreadResult) []core.SessionTranscriptItem {
	return normalizeTranscriptItemsWithOptions(read, transcriptNormalizeOptions{
		itemLimit:          transcriptItemLimit,
		reasoningLimit:     1200,
		commandOutputLimit: 1600,
		includeFileDiff:    true,
	})
}

type transcriptNormalizeOptions struct {
	itemLimit          int
	reasoningLimit     int
	commandOutputLimit int
	includeFileDiff    bool
}

func normalizeReadThreadItemsForPage(read *ReadThreadResult) []core.SessionTranscriptItem {
	return normalizeTranscriptItemsWithOptions(read, transcriptNormalizeOptions{
		itemLimit:          0,
		reasoningLimit:     600,
		commandOutputLimit: 900,
		includeFileDiff:    false,
	})
}

func normalizeLatestReadThreadItemsForPage(
	read *ReadThreadResult,
	limit int,
) ([]core.SessionTranscriptItem, bool) {
	if read == nil || limit <= 0 {
		return nil, false
	}

	opts := transcriptNormalizeOptions{
		itemLimit:          0,
		reasoningLimit:     600,
		commandOutputLimit: 900,
		includeFileDiff:    false,
	}

	items := make([]core.SessionTranscriptItem, 0, limit)
	hasMoreBefore := false
	for turnIndex := len(read.Thread.Turns) - 1; turnIndex >= 0; turnIndex-- {
		turn := read.Thread.Turns[turnIndex]
		for itemIndex := len(turn.Items) - 1; itemIndex >= 0; itemIndex-- {
			normalized, ok := normalizeThreadItemWithOptions(turn.Items[itemIndex], opts)
			if !ok {
				continue
			}
			if len(items) >= limit {
				hasMoreBefore = true
				break
			}
			items = append(items, normalized)
		}
		if hasMoreBefore {
			break
		}
	}

	slices.Reverse(items)
	return items, hasMoreBefore
}

func normalizeTranscriptItemsForPage(items []core.SessionTranscriptItem) []core.SessionTranscriptItem {
	result := make([]core.SessionTranscriptItem, 0, len(items))
	for _, item := range items {
		item.Body = truncateTranscriptBody(item.Kind, item.Body, transcriptNormalizeOptions{
			reasoningLimit:     600,
			commandOutputLimit: 900,
			includeFileDiff:    false,
		})
		if strings.TrimSpace(item.Body) == "" {
			continue
		}
		result = append(result, item)
	}
	return result
}

func normalizeTranscriptItemsWithOptions(read *ReadThreadResult, opts transcriptNormalizeOptions) []core.SessionTranscriptItem {
	if read == nil {
		return nil
	}

	items := make([]core.SessionTranscriptItem, 0)
	for _, turn := range read.Thread.Turns {
		for _, item := range turn.Items {
			normalized, ok := normalizeThreadItemWithOptions(item, opts)
			if !ok {
				continue
			}
			items = append(items, normalized)
		}
	}

	if opts.itemLimit > 0 && len(items) > opts.itemLimit {
		items = items[len(items)-opts.itemLimit:]
	}
	return items
}

func normalizeThreadItem(item ReadThreadItem) (core.SessionTranscriptItem, bool) {
	return normalizeThreadItemWithOptions(item, transcriptNormalizeOptions{
		reasoningLimit:     1200,
		commandOutputLimit: 1600,
		includeFileDiff:    true,
	})
}

func normalizeThreadItemWithOptions(item ReadThreadItem, opts transcriptNormalizeOptions) (core.SessionTranscriptItem, bool) {
	switch item.Type {
	case "userMessage":
		body := strings.TrimSpace(formatContent(item.Content))
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:    item.ID,
			Kind:  core.SessionTranscriptItemKindUserMessage,
			Title: "You",
			Body:  body,
		}, true
	case "agentMessage":
		body := strings.TrimSpace(item.Text)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:     item.ID,
			Kind:   core.SessionTranscriptItemKindAgentMessage,
			Title:  "Codex",
			Body:   body,
			Status: strings.TrimSpace(item.Phase),
		}, true
	case "reasoning":
		body := strings.TrimSpace(extractText(item.Summary))
		if body == "" {
			body = strings.TrimSpace(extractText(item.Content))
		}
		if body == "" {
			body = strings.TrimSpace(compactJSON(item.Summary, opts.reasoningLimit))
		}
		if body == "" {
			body = strings.TrimSpace(compactJSON(item.Content, opts.reasoningLimit))
		}
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:    item.ID,
			Kind:  core.SessionTranscriptItemKindReasoning,
			Title: "Thinking",
			Body:  body,
		}, true
	case "mcpToolCall":
		body := formatToolCall(item)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:     item.ID,
			Kind:   core.SessionTranscriptItemKindToolCall,
			Title:  fmt.Sprintf("Tool %s.%s", item.Server, item.Tool),
			Body:   body,
			Status: strings.TrimSpace(item.Status),
		}, true
	case "commandExecution":
		body := formatCommandExecutionWithLimit(item, opts.commandOutputLimit)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:     item.ID,
			Kind:   core.SessionTranscriptItemKindCommandExecution,
			Title:  "Command",
			Body:   body,
			Status: strings.TrimSpace(item.Status),
		}, true
	case "fileChange":
		body := formatFileChangeWithOptions(item, opts.includeFileDiff)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:     item.ID,
			Kind:   core.SessionTranscriptItemKindFileChange,
			Title:  "File change",
			Body:   body,
			Status: strings.TrimSpace(item.Status),
		}, true
	default:
		return core.SessionTranscriptItem{}, false
	}
}

func formatContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	var parts []map[string]any
	if err := json.Unmarshal(raw, &parts); err != nil {
		return compactJSON(raw, 1200)
	}

	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		partType, _ := part["type"].(string)
		switch partType {
		case "text":
			if text, _ := part["text"].(string); strings.TrimSpace(text) != "" {
				lines = append(lines, strings.TrimSpace(text))
			}
		case "localImage":
			if path, _ := part["path"].(string); strings.TrimSpace(path) != "" {
				lines = append(lines, "[image] "+path)
			} else {
				lines = append(lines, "[image]")
			}
		case "image":
			if url, _ := part["image_url"].(string); strings.TrimSpace(url) != "" {
				lines = append(lines, "[image] "+url)
			} else {
				lines = append(lines, "[image]")
			}
		default:
			if partType != "" {
				lines = append(lines, "["+partType+"]")
			}
		}
	}

	return strings.Join(lines, "\n")
}

func formatToolCall(item ReadThreadItem) string {
	lines := make([]string, 0, 4)
	if item.Status != "" {
		lines = append(lines, "status: "+item.Status)
	}
	if args := compactJSON(item.Arguments, 600); args != "" {
		lines = append(lines, "arguments:\n"+args)
	}
	if item.Error != nil && strings.TrimSpace(item.Error.Message) != "" {
		lines = append(lines, "error:\n"+strings.TrimSpace(item.Error.Message))
	} else if result := compactJSON(item.Result, 1000); result != "" && result != "null" {
		lines = append(lines, "result:\n"+result)
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func formatCommandExecution(item ReadThreadItem) string {
	return formatCommandExecutionWithLimit(item, 1600)
}

func formatCommandExecutionWithLimit(item ReadThreadItem, outputLimit int) string {
	lines := make([]string, 0, 4)
	if strings.TrimSpace(item.Command) != "" {
		lines = append(lines, item.Command)
	}
	if item.Status != "" {
		lines = append(lines, "status: "+item.Status)
	}
	if item.ExitCode != nil {
		lines = append(lines, fmt.Sprintf("exit code: %d", *item.ExitCode))
	}
	if output := strings.TrimSpace(item.AggregatedOutput); output != "" {
		if outputLimit > 0 && len(output) > outputLimit {
			output = output[:outputLimit] + "\n…"
		}
		lines = append(lines, "output:\n"+output)
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func formatFileChange(item ReadThreadItem) string {
	return formatFileChangeWithOptions(item, true)
}

func formatFileChangeWithOptions(item ReadThreadItem, includeDiff bool) string {
	if len(item.Changes) == 0 {
		return ""
	}
	if includeDiff {
		return formatReadThreadFileChanges(item.Changes)
	}
	return formatReadThreadFileChangesCompact(item.Changes)
}

func truncateTranscriptBody(
	kind core.SessionTranscriptItemKind,
	body string,
	opts transcriptNormalizeOptions,
) string {
	switch kind {
	case core.SessionTranscriptItemKindReasoning:
		return truncateString(body, opts.reasoningLimit)
	case core.SessionTranscriptItemKindCommandExecution:
		return truncateString(body, opts.commandOutputLimit+200)
	default:
		return body
	}
}

func extractText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}

	lines := make([]string, 0)
	collectText(value, &lines)
	return strings.Join(lines, "\n")
}

func collectText(value any, lines *[]string) {
	switch typed := value.(type) {
	case map[string]any:
		if text, ok := typed["text"].(string); ok && strings.TrimSpace(text) != "" {
			*lines = append(*lines, strings.TrimSpace(text))
		}
		for _, nested := range typed {
			collectText(nested, lines)
		}
	case []any:
		for _, nested := range typed {
			collectText(nested, lines)
		}
	}
}

func compactJSON(raw json.RawMessage, limit int) string {
	if len(raw) == 0 {
		return ""
	}

	var out bytes.Buffer
	if err := json.Indent(&out, raw, "", "  "); err != nil {
		text := strings.TrimSpace(string(raw))
		if limit > 0 && len(text) > limit {
			return text[:limit] + "…"
		}
		return text
	}

	text := strings.TrimSpace(out.String())
	if limit > 0 && len(text) > limit {
		return text[:limit] + "…"
	}
	return text
}

func truncateString(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
