package rpcserver

import (
	"context"

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
