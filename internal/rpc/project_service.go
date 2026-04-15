package rpcserver

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type ProjectService struct {
	workspace core.WorkspaceService
}

func NewProjectService(workspace core.WorkspaceService) *ProjectService {
	return &ProjectService{workspace: workspace}
}

func (s *ProjectService) ListProjects(_ context.Context, _ *connect.Request[orchdv1.ListProjectsRequest]) (*connect.Response[orchdv1.ListProjectsResponse], error) {
	projects := s.workspace.ListProjects()
	response := &orchdv1.ListProjectsResponse{
		Projects: make([]*orchdv1.Project, 0, len(projects)),
	}
	for _, project := range projects {
		response.Projects = append(response.Projects, projectToProto(project))
	}
	return connect.NewResponse(response), nil
}

func (s *ProjectService) CreateProject(_ context.Context, req *connect.Request[orchdv1.CreateProjectRequest]) (*connect.Response[orchdv1.CreateProjectResponse], error) {
	project, err := s.workspace.CreateProject(core.CreateProjectInput{
		Name:           req.Msg.GetName(),
		RootPath:       req.Msg.GetRootPath(),
		DefaultBackend: req.Msg.GetDefaultBackend(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&orchdv1.CreateProjectResponse{
		Project: projectToProto(project),
	}), nil
}

func (s *ProjectService) GetProject(_ context.Context, req *connect.Request[orchdv1.GetProjectRequest]) (*connect.Response[orchdv1.GetProjectResponse], error) {
	project, ok := s.workspace.GetProject(req.Msg.GetProjectId())
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("project %q not found", req.Msg.GetProjectId()))
	}
	return connect.NewResponse(&orchdv1.GetProjectResponse{
		Project: projectToProto(project),
	}), nil
}
