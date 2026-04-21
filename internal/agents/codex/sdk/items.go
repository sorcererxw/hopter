package sdk

import (
	"encoding/json"
	"fmt"
)

type Item interface {
	ItemType() string
}

type CommandExecutionStatus string

type PatchChangeKind string

type PatchApplyStatus string

type MCPToolCallStatus string

type AgentMessageItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

func (AgentMessageItem) ItemType() string { return "agent_message" }

type ReasoningItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

func (ReasoningItem) ItemType() string { return "reasoning" }

type CommandExecutionItem struct {
	ID               string                 `json:"id"`
	Command          string                 `json:"command"`
	AggregatedOutput string                 `json:"aggregated_output"`
	ExitCode         *int                   `json:"exit_code,omitempty"`
	Status           CommandExecutionStatus `json:"status"`
}

func (CommandExecutionItem) ItemType() string { return "command_execution" }

type FileUpdateChange struct {
	Path string          `json:"path"`
	Kind PatchChangeKind `json:"kind"`
}

type FileChangeItem struct {
	ID      string             `json:"id"`
	Changes []FileUpdateChange `json:"changes"`
	Status  PatchApplyStatus   `json:"status"`
}

func (FileChangeItem) ItemType() string { return "file_change" }

type MCPToolCallResult struct {
	Content           []any `json:"content"`
	StructuredContent any   `json:"structured_content"`
}

type ThreadError struct {
	Message string `json:"message"`
}

type MCPToolCallItem struct {
	ID        string             `json:"id"`
	Server    string             `json:"server"`
	Tool      string             `json:"tool"`
	Arguments any                `json:"arguments"`
	Result    *MCPToolCallResult `json:"result,omitempty"`
	Error     *ThreadError       `json:"error,omitempty"`
	Status    MCPToolCallStatus  `json:"status"`
}

func (MCPToolCallItem) ItemType() string { return "mcp_tool_call" }

type WebSearchItem struct {
	ID    string `json:"id"`
	Query string `json:"query"`
}

func (WebSearchItem) ItemType() string { return "web_search" }

type TodoEntry struct {
	Text      string `json:"text"`
	Completed bool   `json:"completed"`
}

type TodoListItem struct {
	ID    string      `json:"id"`
	Items []TodoEntry `json:"items"`
}

func (TodoListItem) ItemType() string { return "todo_list" }

type ErrorItem struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

func (ErrorItem) ItemType() string { return "error" }

type itemEnvelope struct {
	Type string `json:"type"`
}

func decodeItem(raw json.RawMessage) (Item, error) {
	var envelope itemEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	switch envelope.Type {
	case "agent_message":
		var item AgentMessageItem
		return &item, json.Unmarshal(raw, &item)
	case "reasoning":
		var item ReasoningItem
		return &item, json.Unmarshal(raw, &item)
	case "command_execution":
		var item CommandExecutionItem
		return &item, json.Unmarshal(raw, &item)
	case "file_change":
		var item FileChangeItem
		return &item, json.Unmarshal(raw, &item)
	case "mcp_tool_call":
		var item MCPToolCallItem
		return &item, json.Unmarshal(raw, &item)
	case "web_search":
		var item WebSearchItem
		return &item, json.Unmarshal(raw, &item)
	case "todo_list":
		var item TodoListItem
		return &item, json.Unmarshal(raw, &item)
	case "error":
		var item ErrorItem
		return &item, json.Unmarshal(raw, &item)
	default:
		return nil, fmt.Errorf("unknown item type %q", envelope.Type)
	}
}
