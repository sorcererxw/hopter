package rpcserver

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	"orchd/internal/backend"
	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type fakeProjectSessionLister struct {
	listSessionsResult []backend.ResolvedSession
}

func (f *fakeProjectSessionLister) ListSessions(projectID string, limit uint32) ([]backend.ResolvedSession, error) {
	return f.listSessionsResult, nil
}

func TestListProjectsIncludesSyntheticSessionProjects(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	syntheticProject := core.Project{
		ID:             "cwd:/tmp/codeshell",
		Name:           "codeshell",
		RootPath:       "/tmp/codeshell",
		DefaultBackend: "codex",
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	service := NewProjectService(workspace, &fakeProjectSessionLister{
		listSessionsResult: []backend.ResolvedSession{
			{
				Project: syntheticProject,
				Session: core.Session{ID: "sess_1", ProjectID: syntheticProject.ID},
			},
		},
	})

	resp, err := service.ListProjects(context.Background(), connect.NewRequest(&orchdv1.ListProjectsRequest{}))
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
