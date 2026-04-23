package codex

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"

	"github.com/sorcererxw/hopter/internal/core"
)

const (
	transcriptItemLimit      = 200
	rawReasoningFallbackBody = "Raw reasoning emitted by Codex."
	reasoningProgressBody    = "Reasoning progress emitted by Codex."
)

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
		includeFileDiff:    true,
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
		includeFileDiff:    true,
	}

	items := make([]core.SessionTranscriptItem, 0, limit)
	hasMoreBefore := false
	for turnIndex := len(read.Thread.Turns) - 1; turnIndex >= 0; turnIndex-- {
		turn := read.Thread.Turns[turnIndex]
		for itemIndex := len(turn.Items) - 1; itemIndex >= 0; itemIndex-- {
			rawItem := turn.Items[itemIndex]
			normalized, ok := normalizeThreadItemWithOptions(rawItem, opts)
			if !ok {
				continue
			}
			if len(items) >= limit {
				hasMoreBefore = true
				break
			}
			applyTranscriptIdentity(&normalized, turnIndex, itemIndex, rawItem.ID)
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
	for index, item := range items {
		item.Body = truncateTranscriptBody(item.Kind, item.Body, transcriptNormalizeOptions{
			reasoningLimit:     600,
			commandOutputLimit: 900,
			includeFileDiff:    false,
		})
		if strings.TrimSpace(item.Body) == "" {
			continue
		}
		if strings.TrimSpace(item.ID) == "" {
			item.ID = fmt.Sprintf("local-item-%012d", index)
		}
		if strings.TrimSpace(item.OrderKey) == "" {
			item.OrderKey = localTranscriptOrderKey(index, item.ID)
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
	for turnIndex, turn := range read.Thread.Turns {
		for itemIndex, item := range turn.Items {
			normalized, ok := normalizeThreadItemWithOptions(item, opts)
			if !ok {
				continue
			}
			applyTranscriptIdentity(&normalized, turnIndex, itemIndex, item.ID)
			items = append(items, normalized)
		}
	}

	if opts.itemLimit > 0 && len(items) > opts.itemLimit {
		items = items[len(items)-opts.itemLimit:]
	}
	return items
}

func applyTranscriptIdentity(item *core.SessionTranscriptItem, turnIndex int, itemIndex int, rawID string) {
	if item == nil {
		return
	}
	orderKey := transcriptOrderKey(turnIndex, itemIndex, rawID)
	if strings.TrimSpace(item.ID) == "" {
		item.ID = "generated:" + orderKey
	}
	item.OrderKey = orderKey
}

func transcriptOrderKey(turnIndex int, itemIndex int, itemID string) string {
	return fmt.Sprintf("%012d:%012d:%s", turnIndex, itemIndex, strings.TrimSpace(itemID))
}

func localTranscriptOrderKey(index int, itemID string) string {
	return fmt.Sprintf("local:%012d:%s", index, strings.TrimSpace(itemID))
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
		body, displayBody, attachments := formatUserContent(item.ID, item.Content)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:          item.ID,
			Kind:        core.SessionTranscriptItemKindUserMessage,
			Title:       "You",
			Body:        body,
			DisplayBody: displayBody,
			Attachments: attachments,
		}, true
	case "agentMessage":
		body := strings.TrimSpace(item.Text)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		if isCommentaryAgentMessage(item) {
			return core.SessionTranscriptItem{
				ID:     item.ID,
				Kind:   core.SessionTranscriptItemKindReasoning,
				Title:  "Progress",
				Body:   body,
				Status: "completed",
			}, true
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
		rawBody := strings.TrimSpace(extractText(item.Content))
		if body == "" && rawBody != "" {
			body = rawReasoningFallbackBody
		}
		if body == "" {
			body = reasoningProgressBody
		}
		return core.SessionTranscriptItem{
			ID:          item.ID,
			Kind:        core.SessionTranscriptItemKindReasoning,
			Title:       "Thinking",
			Body:        body,
			DisplayBody: rawBody,
			Status:      strings.TrimSpace(item.Status),
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

func isCommentaryAgentMessage(item ReadThreadItem) bool {
	return strings.EqualFold(strings.TrimSpace(item.Phase), "commentary")
}

func formatUserContent(rawID string, raw json.RawMessage) (string, string, []core.SessionTranscriptAttachment) {
	body, attachments := formatContent(rawID, raw)
	displayBody := strings.TrimSpace(formatUserMessageForDisplay(body))
	return strings.TrimSpace(body), displayBody, attachments
}

func formatContent(rawID string, raw json.RawMessage) (string, []core.SessionTranscriptAttachment) {
	if len(raw) == 0 {
		return "", nil
	}

	var parts []map[string]any
	if err := json.Unmarshal(raw, &parts); err != nil {
		return compactJSON(raw, 1200), nil
	}

	lines := make([]string, 0, len(parts))
	attachments := make([]core.SessionTranscriptAttachment, 0)
	for index, part := range parts {
		partType, _ := part["type"].(string)
		switch partType {
		case "text":
			if text, _ := part["text"].(string); strings.TrimSpace(text) != "" {
				lines = append(lines, sanitizeUserContentText(strings.TrimSpace(text)))
			}
		case "localImage":
			if path, _ := part["path"].(string); strings.TrimSpace(path) != "" {
				lines = append(lines, "[image] "+path)
				attachments = append(attachments, transcriptAttachment(rawID, index, core.SessionTranscriptAttachmentKindImage, attachmentLabel(part, "Image"), path, imageProxyPathURL(path), contentType(part)))
			} else {
				lines = append(lines, "[image]")
				attachments = append(attachments, transcriptAttachment(rawID, index, core.SessionTranscriptAttachmentKindImage, "Image", "", "", contentType(part)))
			}
		case "image":
			if imageURL := imageURL(part); imageURL != "" {
				lines = append(lines, imageTranscriptLine(part, imageURL))
				attachments = append(attachments, transcriptAttachment(rawID, index, core.SessionTranscriptAttachmentKindImage, attachmentLabel(part, "Image"), "", imageAttachmentURL(imageURL), contentType(part)))
			} else {
				lines = append(lines, "[image]")
				attachments = append(attachments, transcriptAttachment(rawID, index, core.SessionTranscriptAttachmentKindImage, "Image", "", "", contentType(part)))
			}
		case "file", "localFile":
			path, _ := part["path"].(string)
			url, _ := part["url"].(string)
			label := attachmentLabel(part, "File")
			if strings.TrimSpace(path) != "" {
				lines = append(lines, "[file] "+strings.TrimSpace(path))
			} else if strings.TrimSpace(url) != "" {
				lines = append(lines, "[file] "+strings.TrimSpace(url))
			} else {
				lines = append(lines, "[file]")
			}
			attachments = append(attachments, transcriptAttachment(rawID, index, core.SessionTranscriptAttachmentKindFile, label, path, url, contentType(part)))
		default:
			if partType != "" {
				lines = append(lines, "["+partType+"]")
			}
		}
	}

	return strings.Join(lines, "\n"), attachments
}

func imageProxyPathURL(path string) string {
	normalized := strings.TrimSpace(path)
	if normalized == "" {
		return ""
	}
	return "/api/image-proxy?path=" + url.QueryEscape(normalized)
}

func imageProxyRemoteURL(rawURL string) string {
	normalized := strings.TrimSpace(rawURL)
	if normalized == "" {
		return ""
	}
	return "/api/image-proxy?url=" + url.QueryEscape(normalized)
}

func imageAttachmentURL(rawURL string) string {
	normalized := strings.TrimSpace(rawURL)
	if normalized == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(normalized), "data:image/") {
		return normalized
	}
	return imageProxyRemoteURL(normalized)
}

func imageTranscriptLine(part map[string]any, rawURL string) string {
	normalized := strings.TrimSpace(rawURL)
	if strings.HasPrefix(strings.ToLower(normalized), "data:image/") {
		if label := attachmentLabel(part, "Image"); label != "" && label != "Image" {
			return "[image] " + label
		}
		return "[image]"
	}
	return "[image] " + normalized
}

func imageURL(part map[string]any) string {
	for _, key := range []string{"image_url", "imageUrl", "url", "source"} {
		if value, _ := part[key].(string); strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func transcriptAttachment(
	itemID string,
	index int,
	kind core.SessionTranscriptAttachmentKind,
	label string,
	path string,
	url string,
	contentType string,
) core.SessionTranscriptAttachment {
	return core.SessionTranscriptAttachment{
		ID:          fmt.Sprintf("%s-attachment-%d", itemID, index),
		Kind:        kind,
		Label:       strings.TrimSpace(label),
		Path:        strings.TrimSpace(path),
		URL:         strings.TrimSpace(url),
		ContentType: strings.TrimSpace(contentType),
	}
}

func contentType(part map[string]any) string {
	if value, _ := part["content_type"].(string); strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	if value, _ := part["mime_type"].(string); strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return ""
}

func attachmentLabel(part map[string]any, fallback string) string {
	if value, _ := part["name"].(string); strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	if value, _ := part["label"].(string); strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	if value, _ := part["path"].(string); strings.TrimSpace(value) != "" {
		segments := strings.FieldsFunc(strings.TrimSpace(value), func(r rune) bool {
			return r == '/' || r == '\\'
		})
		if len(segments) > 0 {
			return segments[len(segments)-1]
		}
	}
	return fallback
}

func formatUserMessageForDisplay(value string) string {
	if comments := extractDiffCommentBodies(value); len(comments) == 1 {
		return comments[0]
	} else if len(comments) > 1 {
		numbered := make([]string, 0, len(comments))
		for index, comment := range comments {
			numbered = append(numbered, fmt.Sprintf("%d. %s", index+1, comment))
		}
		return strings.Join(numbered, "\n")
	}

	const marker = "## My request for Codex:"
	markerIndex := strings.Index(value, marker)
	if markerIndex < 0 {
		return cleanUserMessageFragment(value)
	}

	afterMarker := value[markerIndex+len(marker):]
	imageNarrativeIndex := strings.Index(afterMarker, "\nThe next image shows the browser page")
	if imageNarrativeIndex < 0 {
		imageNarrativeIndex = strings.Index(afterMarker, "\nThe next image shows")
	}
	if imageNarrativeIndex >= 0 {
		afterMarker = afterMarker[:imageNarrativeIndex]
	}

	return cleanUserMessageFragment(afterMarker)
}

func extractDiffCommentBodies(value string) []string {
	if !strings.Contains(value, "# Diff comments:") {
		return nil
	}

	comments := make([]string, 0)
	lines := strings.Split(value, "\n")
	collecting := false
	buffer := make([]string, 0)

	flush := func() {
		if len(buffer) == 0 {
			return
		}
		body := cleanUserMessageFragment(strings.Join(buffer, "\n"))
		if body != "" {
			comments = append(comments, body)
		}
		buffer = buffer[:0]
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if collecting {
			if strings.HasPrefix(trimmed, "## Comment ") ||
				trimmed == "# In app browser (IAB):" ||
				trimmed == "## My request for Codex:" {
				collecting = false
				flush()
			} else {
				buffer = append(buffer, line)
				continue
			}
		}
		if trimmed == "Comment:" {
			collecting = true
			buffer = buffer[:0]
		}
	}
	if collecting {
		flush()
	}

	return comments
}

func cleanUserMessageFragment(value string) string {
	cleaned := strings.TrimSpace(sanitizeUserContentText(value))
	cleaned = strings.TrimPrefix(cleaned, ":")
	cleaned = strings.TrimPrefix(cleaned, "：")
	cleaned = strings.TrimSpace(cleaned)
	if index := strings.Index(cleaned, "\nThe next image shows the browser page"); index >= 0 {
		cleaned = cleaned[:index]
	}
	if index := strings.Index(cleaned, "\nThe next image shows"); index >= 0 {
		cleaned = cleaned[:index]
	}
	cleaned = strings.TrimSpace(cleaned)
	cleaned = strings.TrimSuffix(cleaned, "[image]")
	return strings.TrimSpace(cleaned)
}

func sanitizeUserContentText(value string) string {
	cleaned := redactDataImageURLs(value)
	return strings.TrimSpace(cleaned)
}

func redactDataImageURLs(value string) string {
	const marker = "data:image/"
	if !strings.Contains(strings.ToLower(value), marker) {
		return value
	}

	var builder strings.Builder
	remaining := value
	for {
		lower := strings.ToLower(remaining)
		index := strings.Index(lower, marker)
		if index < 0 {
			builder.WriteString(remaining)
			break
		}

		builder.WriteString(remaining[:index])
		builder.WriteString("[image data omitted]")
		remaining = remaining[index:]

		end := len(remaining)
		for offset, r := range remaining {
			if offset == 0 {
				continue
			}
			if isDataURLTerminator(r) {
				end = offset
				break
			}
		}
		remaining = remaining[end:]
	}
	return builder.String()
}

func isDataURLTerminator(r rune) bool {
	return r <= ' ' || r == '"' || r == '\'' || r == '<' || r == '>' || r == ')' || r == ']'
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
		return body
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

func mergeCodexSourcedTranscriptItems(
	canonical []core.SessionTranscriptItem,
	cached []core.SessionTranscriptItem,
) []core.SessionTranscriptItem {
	if len(cached) == 0 {
		return canonical
	}

	merged := append([]core.SessionTranscriptItem(nil), canonical...)
	seen := make(map[string]struct{}, len(merged))
	for _, item := range merged {
		if id := strings.TrimSpace(item.ID); id != "" {
			seen[id] = struct{}{}
		}
	}

	for _, item := range cached {
		if !shouldRetainCodexEmittedTranscriptItem(item) {
			continue
		}
		id := strings.TrimSpace(item.ID)
		if _, ok := seen[id]; ok {
			continue
		}
		merged = append(merged, item)
		seen[id] = struct{}{}
	}

	return merged
}

func shouldRetainCodexEmittedTranscriptItem(item core.SessionTranscriptItem) bool {
	return item.Kind == core.SessionTranscriptItemKindReasoning &&
		strings.TrimSpace(item.ID) != "" &&
		strings.TrimSpace(item.Body) != ""
}

func truncateString(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
