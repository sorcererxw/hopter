package rpcserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
)

type fakeHostModelLister struct {
	models []core.AgentModel
}

func (f *fakeHostModelLister) ListModels(bool) ([]core.AgentModel, error) {
	return f.models, nil
}

func TestGetSkillReadsSkillSummaryByPath(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, "ask-claude")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillPath, []byte(`---
name: ask-claude
description: "Ask Claude via local CLI"
---
`), 0o644); err != nil {
		t.Fatalf("write skill: %v", err)
	}

	workspace := core.NewInMemoryWorkspace("host", nil)
	service := NewHostService(workspace, nil)

	resp, err := service.GetSkill(context.Background(), connect.NewRequest(&hopterv1.GetSkillRequest{
		Path: skillPath,
	}))
	if err != nil {
		t.Fatalf("GetSkill: %v", err)
	}
	if resp.Msg.GetSkill().GetReference() != "ask-claude" {
		t.Fatalf("reference = %q, want ask-claude", resp.Msg.GetSkill().GetReference())
	}
	if resp.Msg.GetSkill().GetDescription() != "Ask Claude via local CLI" {
		t.Fatalf("description = %q", resp.Msg.GetSkill().GetDescription())
	}
}

func TestListModelsReturnsCodexModels(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	service := NewHostService(workspace, nil, &fakeHostModelLister{
		models: []core.AgentModel{
			{
				ID:                     "gpt-5.4",
				Model:                  "gpt-5.4",
				DisplayName:            "gpt-5.4",
				Description:            "Latest frontier agentic coding model.",
				IsDefault:              true,
				DefaultReasoningEffort: "medium",
				SupportedReasoningEfforts: []core.ModelReasoningEffort{
					{ReasoningEffort: "medium", Description: "Balanced"},
					{ReasoningEffort: "xhigh", Description: "Extra high"},
				},
				InputModalities: []string{"text", "image"},
			},
		},
	})

	backendKey := "codex"
	resp, err := service.ListModels(context.Background(), connect.NewRequest(&hopterv1.ListModelsRequest{
		BackendKey: &backendKey,
	}))
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}

	models := resp.Msg.GetModels()
	if len(models) != 1 {
		t.Fatalf("model count = %d, want 1", len(models))
	}
	if models[0].GetModel() != "gpt-5.4" {
		t.Fatalf("model = %q, want gpt-5.4", models[0].GetModel())
	}
	if models[0].GetDefaultReasoningEffort() != "medium" {
		t.Fatalf("default reasoning effort = %q, want medium", models[0].GetDefaultReasoningEffort())
	}
	if got := models[0].GetSupportedReasoningEfforts()[1].GetReasoningEffort(); got != "xhigh" {
		t.Fatalf("second reasoning effort = %q, want xhigh", got)
	}
}
