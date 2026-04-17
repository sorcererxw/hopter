package codex

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	codexsdk "orchd/internal/codex/sdk"
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

func normalizeSDKItem(item codexsdk.Item) (core.SessionTranscriptItem, bool) {
	switch typed := item.(type) {
	case *codexsdk.AgentMessageItem:
		body := strings.TrimSpace(typed.Text)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:    typed.ID,
			Kind:  core.SessionTranscriptItemKindAgentMessage,
			Title: "Codex",
			Body:  body,
		}, true
	case *codexsdk.ReasoningItem:
		body := strings.TrimSpace(typed.Text)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:    typed.ID,
			Kind:  core.SessionTranscriptItemKindReasoning,
			Title: "Thinking",
			Body:  body,
		}, true
	case *codexsdk.CommandExecutionItem:
		body := formatSDKCommandExecution(typed)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:     typed.ID,
			Kind:   core.SessionTranscriptItemKindCommandExecution,
			Title:  "Command",
			Body:   body,
			Status: string(typed.Status),
		}, true
	case *codexsdk.FileChangeItem:
		body := formatSDKFileChange(typed)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:     typed.ID,
			Kind:   core.SessionTranscriptItemKindFileChange,
			Title:  "File change",
			Body:   body,
			Status: string(typed.Status),
		}, true
	case *codexsdk.MCPToolCallItem:
		body := formatSDKToolCall(typed)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:     typed.ID,
			Kind:   core.SessionTranscriptItemKindToolCall,
			Title:  fmt.Sprintf("Tool %s.%s", typed.Server, typed.Tool),
			Body:   body,
			Status: string(typed.Status),
		}, true
	case *codexsdk.WebSearchItem:
		body := strings.TrimSpace(typed.Query)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:    typed.ID,
			Kind:  core.SessionTranscriptItemKindToolCall,
			Title: "Web search",
			Body:  body,
		}, true
	case *codexsdk.TodoListItem:
		lines := make([]string, 0, len(typed.Items))
		for _, item := range typed.Items {
			prefix := "[ ] "
			if item.Completed {
				prefix = "[x] "
			}
			if text := strings.TrimSpace(item.Text); text != "" {
				lines = append(lines, prefix+text)
			}
		}
		if len(lines) == 0 {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:    typed.ID,
			Kind:  core.SessionTranscriptItemKindReasoning,
			Title: "Plan",
			Body:  strings.Join(lines, "\n"),
		}, true
	case *codexsdk.ErrorItem:
		body := strings.TrimSpace(typed.Message)
		if body == "" {
			return core.SessionTranscriptItem{}, false
		}
		return core.SessionTranscriptItem{
			ID:    typed.ID,
			Kind:  core.SessionTranscriptItemKindToolCall,
			Title: "Error",
			Body:  body,
		}, true
	default:
		return core.SessionTranscriptItem{}, false
	}
}

func formatSDKToolCall(item *codexsdk.MCPToolCallItem) string {
	lines := make([]string, 0, 4)
	if item.Status != "" {
		lines = append(lines, "status: "+string(item.Status))
	}
	if item.Arguments != nil {
		if args := compactAnyJSON(item.Arguments, 600); args != "" {
			lines = append(lines, "arguments:\n"+args)
		}
	}
	if item.Error != nil && strings.TrimSpace(item.Error.Message) != "" {
		lines = append(lines, "error:\n"+strings.TrimSpace(item.Error.Message))
	} else if item.Result != nil {
		if result := compactAnyJSON(item.Result, 1000); result != "" && result != "null" {
			lines = append(lines, "result:\n"+result)
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func formatSDKCommandExecution(item *codexsdk.CommandExecutionItem) string {
	lines := make([]string, 0, 4)
	if strings.TrimSpace(item.Command) != "" {
		lines = append(lines, item.Command)
	}
	if item.Status != "" {
		lines = append(lines, "status: "+string(item.Status))
	}
	if item.ExitCode != nil {
		lines = append(lines, fmt.Sprintf("exit code: %d", *item.ExitCode))
	}
	if output := strings.TrimSpace(item.AggregatedOutput); output != "" {
		if len(output) > 1600 {
			output = output[:1600] + "\n…"
		}
		lines = append(lines, "output:\n"+output)
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func formatSDKFileChange(item *codexsdk.FileChangeItem) string {
	if len(item.Changes) == 0 {
		return ""
	}
	return formatSDKFileChanges(item.Changes)
}

func compactAnyJSON(value any, limit int) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return compactJSON(raw, limit)
}
