package sdk

import (
	"encoding/json"
	"fmt"
)

type Event interface {
	EventType() string
}

type Usage struct {
	InputTokens       int `json:"input_tokens"`
	CachedInputTokens int `json:"cached_input_tokens"`
	OutputTokens      int `json:"output_tokens"`
}

type ThreadStartedEvent struct {
	ThreadID string `json:"thread_id"`
}

func (ThreadStartedEvent) EventType() string { return "thread.started" }

type TurnStartedEvent struct{}

func (TurnStartedEvent) EventType() string { return "turn.started" }

type TurnCompletedEvent struct {
	Usage Usage `json:"usage"`
}

func (TurnCompletedEvent) EventType() string { return "turn.completed" }

type TurnFailedEvent struct {
	Error ThreadError `json:"error"`
}

func (TurnFailedEvent) EventType() string { return "turn.failed" }

type ItemStartedEvent struct {
	Item Item `json:"item"`
}

func (ItemStartedEvent) EventType() string { return "item.started" }

type ItemUpdatedEvent struct {
	Item Item `json:"item"`
}

func (ItemUpdatedEvent) EventType() string { return "item.updated" }

type ItemCompletedEvent struct {
	Item Item `json:"item"`
}

func (ItemCompletedEvent) EventType() string { return "item.completed" }

type StreamErrorEvent struct {
	Message string `json:"message"`
}

func (StreamErrorEvent) EventType() string { return "error" }

type eventEnvelope struct {
	Type string          `json:"type"`
	Item json.RawMessage `json:"item"`
}

func decodeEvent(line string) (Event, error) {
	var envelope eventEnvelope
	if err := json.Unmarshal([]byte(line), &envelope); err != nil {
		return nil, fmt.Errorf("parse event line %q: %w", line, err)
	}
	switch envelope.Type {
	case "thread.started":
		var event ThreadStartedEvent
		return &event, json.Unmarshal([]byte(line), &event)
	case "turn.started":
		return &TurnStartedEvent{}, nil
	case "turn.completed":
		var event TurnCompletedEvent
		return &event, json.Unmarshal([]byte(line), &event)
	case "turn.failed":
		var event TurnFailedEvent
		return &event, json.Unmarshal([]byte(line), &event)
	case "item.started":
		item, err := decodeItem(envelope.Item)
		if err != nil {
			return nil, err
		}
		return &ItemStartedEvent{Item: item}, nil
	case "item.updated":
		item, err := decodeItem(envelope.Item)
		if err != nil {
			return nil, err
		}
		return &ItemUpdatedEvent{Item: item}, nil
	case "item.completed":
		item, err := decodeItem(envelope.Item)
		if err != nil {
			return nil, err
		}
		return &ItemCompletedEvent{Item: item}, nil
	case "error":
		var event StreamErrorEvent
		return &event, json.Unmarshal([]byte(line), &event)
	default:
		return nil, fmt.Errorf("unknown event type %q", envelope.Type)
	}
}
