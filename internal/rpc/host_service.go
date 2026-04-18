package rpcserver

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type HostService struct {
	workspace core.WorkspaceService
}

func NewHostService(workspace core.WorkspaceService) *HostService {
	return &HostService{workspace: workspace}
}

func (s *HostService) GetHostStatus(_ context.Context, _ *connect.Request[orchdv1.GetHostStatusRequest]) (*connect.Response[orchdv1.GetHostStatusResponse], error) {
	snapshot := s.workspace.GetHostStatus()
	backends := s.workspace.ListBackends()
	backendStatuses := make([]*orchdv1.BackendStatus, 0, len(backends))
	for _, backend := range backends {
		backendStatuses = append(backendStatuses, &orchdv1.BackendStatus{
			BackendKey: backend.Key,
			Available:  backend.Available,
			Version:    backend.Version,
			Reason:     backend.Reason,
		})
	}

	return connect.NewResponse(&orchdv1.GetHostStatusResponse{
		HostStatus: &orchdv1.HostStatus{
			HostId:       snapshot.HostID,
			Status:       mapHostState(snapshot.Status),
			Backends:     backendStatuses,
			ProjectCount: uint32(snapshot.ProjectCount),
			SessionCount: uint32(snapshot.SessionCount),
			UpdatedAt:    timestamp(snapshot.UpdatedAt),
		},
	}), nil
}

func (s *HostService) ListBackends(_ context.Context, _ *connect.Request[orchdv1.ListBackendsRequest]) (*connect.Response[orchdv1.ListBackendsResponse], error) {
	backends := s.workspace.ListBackends()
	response := &orchdv1.ListBackendsResponse{
		Backends: make([]*orchdv1.BackendStatus, 0, len(backends)),
	}
	for _, backend := range backends {
		response.Backends = append(response.Backends, &orchdv1.BackendStatus{
			BackendKey: backend.Key,
			Available:  backend.Available,
			Version:    backend.Version,
			Reason:     backend.Reason,
		})
	}
	return connect.NewResponse(response), nil
}

func (s *HostService) ListSkills(_ context.Context, _ *connect.Request[orchdv1.ListSkillsRequest]) (*connect.Response[orchdv1.ListSkillsResponse], error) {
	skills, err := s.workspace.ListSkills()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list skills: %w", err))
	}

	response := &orchdv1.ListSkillsResponse{
		Skills: make([]*orchdv1.SkillSummary, 0, len(skills)),
	}
	for _, skill := range skills {
		response.Skills = append(response.Skills, &orchdv1.SkillSummary{
			Name:        skill.Name,
			Reference:   skill.Reference,
			Description: skill.Description,
			Source:      skill.Source,
		})
	}

	return connect.NewResponse(response), nil
}

func (s *HostService) ListMCPServers(_ context.Context, _ *connect.Request[orchdv1.ListMCPServersRequest]) (*connect.Response[orchdv1.ListMCPServersResponse], error) {
	servers, err := s.workspace.ListMCPServers()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list mcp servers: %w", err))
	}

	response := &orchdv1.ListMCPServersResponse{
		Servers: make([]*orchdv1.MCPServerSummary, 0, len(servers)),
	}
	for _, server := range servers {
		response.Servers = append(response.Servers, &orchdv1.MCPServerSummary{
			Name:                server.Name,
			Source:              server.Source,
			ConfigurationStatus: server.ConfigurationStatus,
		})
	}

	return connect.NewResponse(response), nil
}

func (s *HostService) ListDirectoryRoots(_ context.Context, _ *connect.Request[orchdv1.ListDirectoryRootsRequest]) (*connect.Response[orchdv1.ListDirectoryRootsResponse], error) {
	roots, err := s.workspace.ListDirectoryRoots()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list directory roots: %w", err))
	}

	response := &orchdv1.ListDirectoryRootsResponse{
		Roots: make([]*orchdv1.DirectoryRoot, 0, len(roots)),
	}
	for _, root := range roots {
		response.Roots = append(response.Roots, directoryRootToProto(root))
	}
	return connect.NewResponse(response), nil
}

func (s *HostService) ListDirectory(_ context.Context, req *connect.Request[orchdv1.ListDirectoryRequest]) (*connect.Response[orchdv1.ListDirectoryResponse], error) {
	listing, err := s.workspace.ListDirectory(req.Msg.GetPath())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&orchdv1.ListDirectoryResponse{
		Listing: directoryListingToProto(listing),
	}), nil
}

func (s *HostService) GetPathMetadata(_ context.Context, req *connect.Request[orchdv1.GetPathMetadataRequest]) (*connect.Response[orchdv1.GetPathMetadataResponse], error) {
	metadata, err := s.workspace.GetPathMetadata(req.Msg.GetPath())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&orchdv1.GetPathMetadataResponse{
		Metadata: pathMetadataToProto(metadata),
	}), nil
}

func (s *HostService) ListRecentRepos(_ context.Context, req *connect.Request[orchdv1.ListRecentReposRequest]) (*connect.Response[orchdv1.ListRecentReposResponse], error) {
	repos, err := s.workspace.ListRecentRepos(req.Msg.GetLimit())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list recent repos: %w", err))
	}

	response := &orchdv1.ListRecentReposResponse{
		Repos: make([]*orchdv1.PathMetadata, 0, len(repos)),
	}
	for _, repo := range repos {
		response.Repos = append(response.Repos, pathMetadataToProto(repo))
	}
	return connect.NewResponse(response), nil
}
