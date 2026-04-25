package rpcserver

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/agents"
	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
)

type fakeProjectSessionLister struct {
	listSessionsResult []agents.ResolvedSession
}

func (f *fakeProjectSessionLister) ListSessions(projectID string, limit uint32) ([]agents.ResolvedSession, error) {
	return f.listSessionsResult, nil
}

func TestListProjectsIncludesSyntheticSessionProjects(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	syntheticProject := core.Project{
		ID:             "cwd:/tmp/sample-project",
		Name:           "sample-project",
		RootPath:       "/tmp/sample-project",
		DefaultBackend: "codex",
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	service := NewProjectService(workspace, &fakeProjectSessionLister{
		listSessionsResult: []agents.ResolvedSession{
			{
				Project: syntheticProject,
				Session: core.Session{ID: "sess_1", ProjectID: syntheticProject.ID},
			},
		},
	})

	resp, err := service.ListProjects(context.Background(), connect.NewRequest(&hopterv1.ListProjectsRequest{}))
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}

	projects := resp.Msg.GetProjects()
	if len(projects) != 1 {
		t.Fatalf("project count = %d, want 1", len(projects))
	}
	if projects[0].GetId() != syntheticProject.ID {
		t.Fatalf("project id = %q, want %q", projects[0].GetId(), syntheticProject.ID)
	}
}
