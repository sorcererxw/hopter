package codex

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"

	"github.com/sorcererxw/hopter/internal/core"
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

func TestNormalizeTranscriptItemsMapsCommentaryAgentMessagesToReasoning(t *testing.T) {
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
	if len(items) != 3 {
		t.Fatalf("items = %d, want 3", len(items))
	}
	if items[0].Body != "continue" {
		t.Fatalf("first item body = %q", items[0].Body)
	}
	if items[1].Kind != core.SessionTranscriptItemKindReasoning {
		t.Fatalf("second item kind = %q, want reasoning", items[1].Kind)
	}
	if items[1].Title != "Progress" {
		t.Fatalf("second item title = %q, want Progress", items[1].Title)
	}
	if items[1].Body != "I will make this implementation change next." {
		t.Fatalf("second item body = %q", items[1].Body)
	}
	if items[2].Body != "Implemented the change." {
		t.Fatalf("third item body = %q", items[2].Body)
	}
}

func TestNormalizeUserMessageRedactsSyncedDataImageURL(t *testing.T) {
	item, ok := normalizeThreadItem(ReadThreadItem{
		Type: "userMessage",
		ID:   "user-image",
		Content: json.RawMessage(`[
			{"type":"text","text":"please inspect this"},
			{"type":"image","image_url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}
		]`),
	})
	if !ok {
		t.Fatalf("user message was not normalized")
	}
	if item.Body != "please inspect this\n[image]" {
		t.Fatalf("body = %q", item.Body)
	}
	if item.DisplayBody != "please inspect this" {
		t.Fatalf("display body = %q", item.DisplayBody)
	}
	if len(item.Attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(item.Attachments))
	}
	if item.Attachments[0].URL != "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" {
		t.Fatalf("attachment url = %q", item.Attachments[0].URL)
	}
}

func TestNormalizeUserMessageRedactsDataImageURLInsideTextPart(t *testing.T) {
	item, ok := normalizeThreadItem(ReadThreadItem{
		Type: "userMessage",
		ID:   "user-text-data-image",
		Content: json.RawMessage(`[
			{"type":"text","text":"before data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ== after"}
		]`),
	})
	if !ok {
		t.Fatalf("user message was not normalized")
	}
	if item.Body != "before [image data omitted] after" {
		t.Fatalf("body = %q", item.Body)
	}
	if item.DisplayBody != "before [image data omitted] after" {
		t.Fatalf("display body = %q", item.DisplayBody)
	}
}

func TestNormalizeReadThreadItemsForPagePreservesFileChangeDiff(t *testing.T) {
	read := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type: "fileChange",
					ID:   "file-change-1",
					Changes: []ReadThreadFileChange{
						{
							Path: "/repo/ui/src/components/app/sessions/composer/composer.tsx",
							Diff: "@@ -1,2 +1,2 @@\n-old\n+new",
							Kind: struct {
								Type     string  `json:"type"`
								MovePath *string `json:"move_path"`
							}{Type: "update"},
						},
					},
				},
			},
		},
	)

	items := normalizeReadThreadItemsForPage(read)
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	if items[0].Kind != core.SessionTranscriptItemKindFileChange {
		t.Fatalf("item kind = %q, want file change", items[0].Kind)
	}
	if !strings.Contains(items[0].Body, "@@ -1,2 +1,2 @@") {
		t.Fatalf("file change body omitted diff: %s", items[0].Body)
	}
}

func TestNormalizeReasoningWithoutSummaryPreservesProgressOnly(t *testing.T) {
	item, ok := normalizeThreadItem(ReadThreadItem{
		Type:    "reasoning",
		ID:      "reasoning-empty",
		Summary: json.RawMessage(`[]`),
		Content: json.RawMessage(`[]`),
	})
	if !ok {
		t.Fatalf("reasoning item was not normalized")
	}
	if item.Body != reasoningProgressBody {
		t.Fatalf("reasoning body = %q, want %q", item.Body, reasoningProgressBody)
	}
	if item.DisplayBody != "" {
		t.Fatalf("display body = %q, want empty raw body", item.DisplayBody)
	}
}

func TestMergeCodexSourcedTranscriptItemsKeepsOnlyReasoningMissedByRead(t *testing.T) {
	canonical := []core.SessionTranscriptItem{
		{
			ID:    "user-1",
			Kind:  core.SessionTranscriptItemKindUserMessage,
			Title: "You",
			Body:  "continue",
		},
		{
			ID:    "agent-1",
			Kind:  core.SessionTranscriptItemKindAgentMessage,
			Title: "Codex",
			Body:  "done",
		},
	}
	cached := []core.SessionTranscriptItem{
		{
			ID:    "local-user",
			Kind:  core.SessionTranscriptItemKindUserMessage,
			Title: "You",
			Body:  "continue",
		},
		{
			ID:    "reasoning-1",
			Kind:  core.SessionTranscriptItemKindReasoning,
			Title: "Thinking",
			Body:  reasoningProgressBody,
		},
	}

	merged := mergeCodexSourcedTranscriptItems(canonical, cached)
	if len(merged) != 3 {
		t.Fatalf("merged items = %d, want 3", len(merged))
	}
	if merged[2].ID != "reasoning-1" {
		t.Fatalf("preserved item id = %q, want reasoning-1", merged[2].ID)
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
