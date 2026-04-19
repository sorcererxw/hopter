package rpcserver

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/backend"
	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
)

type ProjectService struct {
	workspace core.WorkspaceService
	sessions  projectSessionLister
}

type projectSessionLister interface {
	ListSessions(projectID string, limit uint32) ([]backend.ResolvedSession, error)
}

func NewProjectService(workspace core.WorkspaceService, sessions ...projectSessionLister) *ProjectService {
	var sessionLister projectSessionLister
	if len(sessions) > 0 {
		sessionLister = sessions[0]
	}
	return &ProjectService{workspace: workspace, sessions: sessionLister}
}

func (s *ProjectService) ListProjects(_ context.Context, _ *connect.Request[hopterv1.ListProjectsRequest]) (*connect.Response[hopterv1.ListProjectsResponse], error) {
	projects := s.workspace.ListProjects()
	projects = appendSyntheticProjects(projects, s.sessions)
	response := &hopterv1.ListProjectsResponse{
		Projects: make([]*hopterv1.Project, 0, len(projects)),
	}
	for _, project := range projects {
		response.Projects = append(response.Projects, projectToProto(project))
	}
	return connect.NewResponse(response), nil
}

func appendSyntheticProjects(projects []core.Project, sessions projectSessionLister) []core.Project {
	if sessions == nil {
		return projects
	}

	resolved, err := sessions.ListSessions("", 100)
	if err != nil {
		return projects
	}

	seen := make(map[string]struct{}, len(projects))
	merged := append([]core.Project(nil), projects...)
	for _, project := range projects {
		seen[projectDedupKey(project)] = struct{}{}
	}

	for _, item := range resolved {
		key := projectDedupKey(item.Project)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, item.Project)
	}

	return merged
}

func projectDedupKey(project core.Project) string {
	root := filepath.Clean(strings.TrimSpace(project.RootPath))
	if root != "." && root != "" {
		return root
	}
	return strings.TrimSpace(project.ID)
}

func (s *ProjectService) CreateProject(_ context.Context, req *connect.Request[hopterv1.CreateProjectRequest]) (*connect.Response[hopterv1.CreateProjectResponse], error) {
	project, err := s.workspace.CreateProject(core.CreateProjectInput{
		Name:           req.Msg.GetName(),
		RootPath:       req.Msg.GetRootPath(),
		DefaultBackend: req.Msg.GetDefaultBackend(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&hopterv1.CreateProjectResponse{
		Project: projectToProto(project),
	}), nil
}

func (s *ProjectService) GetProject(_ context.Context, req *connect.Request[hopterv1.GetProjectRequest]) (*connect.Response[hopterv1.GetProjectResponse], error) {
	project, ok := s.workspace.GetProject(req.Msg.GetProjectId())
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("project %q not found", req.Msg.GetProjectId()))
	}
	return connect.NewResponse(&hopterv1.GetProjectResponse{
		Project: projectToProto(project),
	}), nil
}
