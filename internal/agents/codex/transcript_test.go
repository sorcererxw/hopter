package codex

import (
	"encoding/json"
	"sort"
	"testing"
)

func TestNormalizeTranscriptItemsAssignsStableSortableIdentity(t *testing.T) {
	read := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:    "userMessage",
					ID:      "user-1",
					Content: json.RawMessage(`[{"type":"text","text":"first"}]`),
				},
				{
					Type: "reasoning",
					ID:   "",
					Summary: json.RawMessage(
						`[{"type":"summary_text","text":"thinking"}]`,
					),
				},
			},
		},
		ReadThreadTurn{
			ID:     "turn-2",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:  "agentMessage",
					ID:    "agent-1",
					Text:  "done",
					Phase: "final_answer",
				},
			},
		},
	)

	items := normalizeReadThreadItemsForPage(read)
	if len(items) != 3 {
		t.Fatalf("items = %d, want 3", len(items))
	}

	seenIDs := make(map[string]struct{}, len(items))
	orderKeys := make([]string, 0, len(items))
	for _, item := range items {
		if item.ID == "" {
			t.Fatalf("item id is empty: %#v", item)
		}
		if item.OrderKey == "" {
			t.Fatalf("item order key is empty: %#v", item)
		}
		if _, ok := seenIDs[item.ID]; ok {
			t.Fatalf("duplicate item id %q", item.ID)
		}
		seenIDs[item.ID] = struct{}{}
		orderKeys = append(orderKeys, item.OrderKey)
	}

	sortedOrderKeys := append([]string(nil), orderKeys...)
	sort.Strings(sortedOrderKeys)
	for index := range orderKeys {
		if orderKeys[index] != sortedOrderKeys[index] {
			t.Fatalf("order keys are not sortable in transcript order: got %#v sorted %#v", orderKeys, sortedOrderKeys)
		}
	}
}

func TestNormalizeTranscriptItemsSkipsCommentaryAgentMessages(t *testing.T) {
	read := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:    "userMessage",
					ID:      "user-1",
					Content: json.RawMessage(`[{"type":"text","text":"continue"}]`),
				},
				{
					Type:  "agentMessage",
					ID:    "agent-progress",
					Text:  "I will make this implementation change next.",
					Phase: "commentary",
				},
				{
					Type:  "agentMessage",
					ID:    "agent-final",
					Text:  "Implemented the change.",
					Phase: "final_answer",
				},
			},
		},
	)

	items := normalizeReadThreadItemsForPage(read)
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	if items[0].Body != "continue" {
		t.Fatalf("first item body = %q", items[0].Body)
	}
	if items[1].Body != "Implemented the change." {
		t.Fatalf("second item body = %q", items[1].Body)
	}
}

func TestNormalizeLatestReadThreadItemsKeepsAbsoluteOrderKeys(t *testing.T) {
	read := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:    "userMessage",
					ID:      "user-1",
					Content: json.RawMessage(`[{"type":"text","text":"first"}]`),
				},
			},
		},
		ReadThreadTurn{
			ID:     "turn-2",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:    "userMessage",
					ID:      "user-2",
					Content: json.RawMessage(`[{"type":"text","text":"second"}]`),
				},
				{
					Type:  "agentMessage",
					ID:    "agent-2",
					Text:  "done",
					Phase: "final_answer",
				},
			},
		},
	)

	items, hasMoreBefore := normalizeLatestReadThreadItemsForPage(read, 2)
	if !hasMoreBefore {
		t.Fatalf("hasMoreBefore = false, want true")
	}
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	if items[0].OrderKey != "000000000001:000000000000:user-2" {
		t.Fatalf("first order key = %q", items[0].OrderKey)
	}
	if items[1].OrderKey != "000000000001:000000000001:agent-2" {
		t.Fatalf("second order key = %q", items[1].OrderKey)
	}
}
