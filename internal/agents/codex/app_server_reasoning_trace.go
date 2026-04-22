package codex

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/sorcererxw/hopter/internal/core"
)

type traceReasoningItem struct {
	id                  string
	orderKey            string
	raw                 string
	status              string
	summary             string
	pendingSummaryBreak bool
}

func appServerTraceReasoningItems(rootPath, sessionID string) []core.SessionTranscriptItem {
	traceFile := appServerTracePath(rootPath, sessionID)
	if traceFile == "" {
		return nil
	}

	f, err := os.Open(traceFile)
	if err != nil {
		return nil
	}
	defer f.Close()

	items := make(map[string]*traceReasoningItem)
	order := make([]string, 0)
	lineIndex := 0
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		lineIndex += 1
		var entry TraceEntry
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			continue
		}
		if entry.Direction != "incoming" {
			continue
		}

		switch entry.Method {
		case "item/started", "item/completed":
			var payload struct {
				Params struct {
					Item ReadThreadItem `json:"item"`
				} `json:"params"`
			}
			if err := json.Unmarshal(entry.Payload, &payload); err != nil {
				continue
			}
			if payload.Params.Item.Type != "reasoning" {
				continue
			}
			normalized, ok := normalizeThreadItemWithOptions(
				payload.Params.Item,
				liveReasoningNormalizeOptions(),
			)
			if !ok {
				continue
			}
			state := ensureTraceReasoningItem(
				items,
				&order,
				normalized.ID,
				traceReasoningOrderKey(entry, lineIndex, normalized.ID),
			)
			if normalized.Body != reasoningProgressBody &&
				normalized.Body != rawReasoningFallbackBody {
				state.summary = normalized.Body
			}
			if strings.TrimSpace(normalized.DisplayBody) != "" {
				state.raw = normalized.DisplayBody
			}
			if entry.Method == "item/completed" {
				state.status = "completed"
			} else if strings.TrimSpace(state.status) == "" {
				state.status = "streaming"
			}
		case "item/reasoning/summaryPartAdded":
			var payload struct {
				Params struct {
					ItemID string `json:"itemId"`
				} `json:"params"`
			}
			if err := json.Unmarshal(entry.Payload, &payload); err != nil {
				continue
			}
			itemID := strings.TrimSpace(payload.Params.ItemID)
			if itemID == "" {
				continue
			}
			state := ensureTraceReasoningItem(
				items,
				&order,
				itemID,
				traceReasoningOrderKey(entry, lineIndex, itemID),
			)
			state.pendingSummaryBreak = strings.TrimSpace(state.summary) != ""
		case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
			var payload struct {
				Params struct {
					Delta  string `json:"delta"`
					ItemID string `json:"itemId"`
				} `json:"params"`
			}
			if err := json.Unmarshal(entry.Payload, &payload); err != nil {
				continue
			}
			itemID := strings.TrimSpace(payload.Params.ItemID)
			if itemID == "" || payload.Params.Delta == "" {
				continue
			}
			state := ensureTraceReasoningItem(
				items,
				&order,
				itemID,
				traceReasoningOrderKey(entry, lineIndex, itemID),
			)
			if entry.Method == "item/reasoning/textDelta" {
				state.raw += payload.Params.Delta
				continue
			}
			if state.pendingSummaryBreak && strings.TrimSpace(state.summary) != "" {
				state.summary += "\n\n"
			}
			state.summary += payload.Params.Delta
			state.pendingSummaryBreak = false
		}
	}

	result := make([]core.SessionTranscriptItem, 0, len(order))
	for _, id := range order {
		state := items[id]
		if state == nil {
			continue
		}
		body := strings.TrimSpace(state.summary)
		raw := strings.TrimSpace(state.raw)
		if body == "" && raw != "" {
			body = rawReasoningFallbackBody
		}
		if body == "" {
			body = reasoningProgressBody
		}
		item := core.SessionTranscriptItem{
			ID:          state.id,
			OrderKey:    state.orderKey,
			Kind:        core.SessionTranscriptItemKindReasoning,
			Title:       "Thinking",
			Body:        body,
			DisplayBody: raw,
			Status:      strings.TrimSpace(state.status),
		}
		if item.Status == "" {
			item.Status = "completed"
		}
		if shouldRetainCodexEmittedTranscriptItem(item) {
			result = append(result, item)
		}
	}
	return result
}

func ensureTraceReasoningItem(
	items map[string]*traceReasoningItem,
	order *[]string,
	itemID string,
	orderKey string,
) *traceReasoningItem {
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		itemID = fmt.Sprintf("reasoning-trace-%012d", len(*order))
	}
	state := items[itemID]
	if state != nil {
		return state
	}
	state = &traceReasoningItem{
		id:       itemID,
		orderKey: orderKey,
	}
	items[itemID] = state
	*order = append(*order, itemID)
	return state
}

func appServerTracePath(rootPath, sessionID string) string {
	rootPath = strings.TrimSpace(rootPath)
	sessionID = filepath.Base(strings.TrimSpace(sessionID))
	if rootPath == "" ||
		sessionID == "" ||
		sessionID == "." ||
		sessionID == string(filepath.Separator) {
		return ""
	}
	return filepath.Join(
		rootPath,
		"storage",
		"runtime",
		"app-server-traces",
		sessionID+".jsonl",
	)
}

func traceReasoningOrderKey(entry TraceEntry, lineIndex int, itemID string) string {
	if !entry.Timestamp.IsZero() {
		return fmt.Sprintf(
			"trace:%020d:%s",
			entry.Timestamp.UnixNano(),
			strings.TrimSpace(itemID),
		)
	}
	return fmt.Sprintf("trace:%020d:%s", lineIndex, strings.TrimSpace(itemID))
}
