package rpcserver

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	updater "github.com/sorcererxw/hopter/internal/update"
)

type HostService struct {
	workspace core.WorkspaceService
	updates   core.UpdateService
}

func NewHostService(workspace core.WorkspaceService, updates core.UpdateService) *HostService {
	return &HostService{workspace: workspace, updates: updates}
}

func (s *HostService) GetHostStatus(_ context.Context, _ *connect.Request[hopterv1.GetHostStatusRequest]) (*connect.Response[hopterv1.GetHostStatusResponse], error) {
	snapshot := s.workspace.GetHostStatus()
	backends := s.workspace.ListBackends()
	backendStatuses := make([]*hopterv1.BackendStatus, 0, len(backends))
	for _, backend := range backends {
		backendStatuses = append(backendStatuses, &hopterv1.BackendStatus{
			BackendKey: backend.Key,
			Available:  backend.Available,
			Version:    backend.Version,
			Reason:     backend.Reason,
		})
	}

	return connect.NewResponse(&hopterv1.GetHostStatusResponse{
		HostStatus: &hopterv1.HostStatus{
			HostId:       snapshot.HostID,
			Status:       mapHostState(snapshot.Status),
			Backends:     backendStatuses,
			ProjectCount: uint32(snapshot.ProjectCount),
			SessionCount: uint32(snapshot.SessionCount),
			UpdatedAt:    timestamp(snapshot.UpdatedAt),
		},
	}), nil
}

func (s *HostService) ListBackends(_ context.Context, _ *connect.Request[hopterv1.ListBackendsRequest]) (*connect.Response[hopterv1.ListBackendsResponse], error) {
	backends := s.workspace.ListBackends()
	response := &hopterv1.ListBackendsResponse{
		Backends: make([]*hopterv1.BackendStatus, 0, len(backends)),
	}
	for _, backend := range backends {
		response.Backends = append(response.Backends, &hopterv1.BackendStatus{
			BackendKey: backend.Key,
			Available:  backend.Available,
			Version:    backend.Version,
			Reason:     backend.Reason,
		})
	}
	return connect.NewResponse(response), nil
}

func (s *HostService) ListSkills(_ context.Context, _ *connect.Request[hopterv1.ListSkillsRequest]) (*connect.Response[hopterv1.ListSkillsResponse], error) {
	skills, err := s.workspace.ListSkills()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list skills: %w", err))
	}

	response := &hopterv1.ListSkillsResponse{
		Skills: make([]*hopterv1.SkillSummary, 0, len(skills)),
	}
	for _, skill := range skills {
		response.Skills = append(response.Skills, &hopterv1.SkillSummary{
			Name:        skill.Name,
			Reference:   skill.Reference,
			Description: skill.Description,
			Source:      skill.Source,
		})
	}

	return connect.NewResponse(response), nil
}

func (s *HostService) ListMCPServers(_ context.Context, _ *connect.Request[hopterv1.ListMCPServersRequest]) (*connect.Response[hopterv1.ListMCPServersResponse], error) {
	servers, err := s.workspace.ListMCPServers()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list mcp servers: %w", err))
	}

	response := &hopterv1.ListMCPServersResponse{
		Servers: make([]*hopterv1.MCPServerSummary, 0, len(servers)),
	}
	for _, server := range servers {
		response.Servers = append(response.Servers, &hopterv1.MCPServerSummary{
			Name:                server.Name,
			Source:              server.Source,
			ConfigurationStatus: server.ConfigurationStatus,
		})
	}

	return connect.NewResponse(response), nil
}

func (s *HostService) ListDirectoryRoots(_ context.Context, _ *connect.Request[hopterv1.ListDirectoryRootsRequest]) (*connect.Response[hopterv1.ListDirectoryRootsResponse], error) {
	roots, err := s.workspace.ListDirectoryRoots()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list directory roots: %w", err))
	}

	response := &hopterv1.ListDirectoryRootsResponse{
		Roots: make([]*hopterv1.DirectoryRoot, 0, len(roots)),
	}
	for _, root := range roots {
		response.Roots = append(response.Roots, directoryRootToProto(root))
	}
	return connect.NewResponse(response), nil
}

func (s *HostService) ListDirectory(_ context.Context, req *connect.Request[hopterv1.ListDirectoryRequest]) (*connect.Response[hopterv1.ListDirectoryResponse], error) {
	listing, err := s.workspace.ListDirectory(req.Msg.GetPath())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&hopterv1.ListDirectoryResponse{
		Listing: directoryListingToProto(listing),
	}), nil
}

func (s *HostService) GetPathMetadata(_ context.Context, req *connect.Request[hopterv1.GetPathMetadataRequest]) (*connect.Response[hopterv1.GetPathMetadataResponse], error) {
	metadata, err := s.workspace.GetPathMetadata(req.Msg.GetPath())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&hopterv1.GetPathMetadataResponse{
		Metadata: pathMetadataToProto(metadata),
	}), nil
}

func (s *HostService) ListRecentRepos(_ context.Context, req *connect.Request[hopterv1.ListRecentReposRequest]) (*connect.Response[hopterv1.ListRecentReposResponse], error) {
	repos, err := s.workspace.ListRecentRepos(req.Msg.GetLimit())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list recent repos: %w", err))
	}

	response := &hopterv1.ListRecentReposResponse{
		Repos: make([]*hopterv1.PathMetadata, 0, len(repos)),
	}
	for _, repo := range repos {
		response.Repos = append(response.Repos, pathMetadataToProto(repo))
	}
	return connect.NewResponse(response), nil
}

func (s *HostService) GetUpdateStatus(_ context.Context, _ *connect.Request[hopterv1.GetUpdateStatusRequest]) (*connect.Response[hopterv1.GetUpdateStatusResponse], error) {
	if s.updates == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("update service unavailable"))
	}
	return connect.NewResponse(&hopterv1.GetUpdateStatusResponse{
		UpdateStatus: updateStatusToProto(s.updates.GetStatus()),
	}), nil
}

func (s *HostService) CheckForUpdate(_ context.Context, req *connect.Request[hopterv1.CheckForUpdateRequest]) (*connect.Response[hopterv1.CheckForUpdateResponse], error) {
	if s.updates == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("update service unavailable"))
	}

	status, err := s.updates.Check(req.Msg.GetForce())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("check for update: %w", err))
	}

	return connect.NewResponse(&hopterv1.CheckForUpdateResponse{
		UpdateStatus: updateStatusToProto(status),
	}), nil
}

func (s *HostService) ApplyUpdate(_ context.Context, _ *connect.Request[hopterv1.ApplyUpdateRequest]) (*connect.Response[hopterv1.ApplyUpdateResponse], error) {
	if s.updates == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("update service unavailable"))
	}

	status, err := s.updates.Apply()
	if err != nil {
		switch {
		case errors.Is(err, updater.ErrNoUpdateAvailable), errors.Is(err, updater.ErrUpdateNotSelfManaged), errors.Is(err, updater.ErrUpdateBusy):
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		default:
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("apply update: %w", err))
		}
	}

	return connect.NewResponse(&hopterv1.ApplyUpdateResponse{
		UpdateStatus: updateStatusToProto(status),
	}), nil
}

func updateStatusToProto(status core.UpdateStatus) *hopterv1.UpdateStatus {
	if status == (core.UpdateStatus{}) {
		return &hopterv1.UpdateStatus{}
	}

	protoStatus := &hopterv1.UpdateStatus{
		CurrentVersion:     status.CurrentVersion,
		CurrentCommit:      status.CurrentCommit,
		Channel:            status.Channel,
		InstallSource:      mapInstallSource(status.InstallSource),
		UpdatePolicy:       mapUpdatePolicy(status.UpdatePolicy),
		State:              mapUpdateState(status.State),
		UpdateAvailable:    status.UpdateAvailable,
		TargetVersion:      status.TargetVersion,
		UpgradeCommandHint: status.UpgradeCommandHint,
		FailureReason:      status.FailureReason,
		LastCheckedAt:      timestamp(status.LastCheckedAt),
	}
	if status.AvailableUpdate != nil {
		protoStatus.AvailableUpdate = &hopterv1.AvailableUpdate{
			Version:     status.AvailableUpdate.Version,
			NotesUrl:    status.AvailableUpdate.NotesURL,
			PublishedAt: timestamp(status.AvailableUpdate.PublishedAt),
		}
	}
	return protoStatus
}

func mapInstallSource(source core.InstallSource) hopterv1.InstallSource {
	switch source {
	case core.InstallSourceDirect:
		return hopterv1.InstallSource_INSTALL_SOURCE_DIRECT
	case core.InstallSourceUnknown:
		return hopterv1.InstallSource_INSTALL_SOURCE_UNKNOWN
	case core.InstallSourceHomebrewFormula:
		return hopterv1.InstallSource_INSTALL_SOURCE_HOMEBREW_FORMULA
	case core.InstallSourceHomebrewCask:
		return hopterv1.InstallSource_INSTALL_SOURCE_HOMEBREW_CASK
	case core.InstallSourceAPT:
		return hopterv1.InstallSource_INSTALL_SOURCE_APT
	case core.InstallSourceDNF:
		return hopterv1.InstallSource_INSTALL_SOURCE_DNF
	case core.InstallSourceWinget:
		return hopterv1.InstallSource_INSTALL_SOURCE_WINGET
	case core.InstallSourceNix:
		return hopterv1.InstallSource_INSTALL_SOURCE_NIX
	case core.InstallSourceMacPorts:
		return hopterv1.InstallSource_INSTALL_SOURCE_MACPORTS
	case core.InstallSourceSnap:
		return hopterv1.InstallSource_INSTALL_SOURCE_SNAP
	case core.InstallSourceFlatpak:
		return hopterv1.InstallSource_INSTALL_SOURCE_FLATPAK
	default:
		return hopterv1.InstallSource_INSTALL_SOURCE_UNSPECIFIED
	}
}

func mapUpdatePolicy(policy core.UpdatePolicy) hopterv1.UpdatePolicy {
	switch policy {
	case core.UpdatePolicySelfManaged:
		return hopterv1.UpdatePolicy_UPDATE_POLICY_SELF_MANAGED
	case core.UpdatePolicyPackageManaged:
		return hopterv1.UpdatePolicy_UPDATE_POLICY_PACKAGE_MANAGED
	case core.UpdatePolicyStoreManaged:
		return hopterv1.UpdatePolicy_UPDATE_POLICY_STORE_MANAGED
	default:
		return hopterv1.UpdatePolicy_UPDATE_POLICY_UNSPECIFIED
	}
}

func mapUpdateState(state core.UpdateState) hopterv1.UpdateState {
	switch state {
	case core.UpdateStateIdle:
		return hopterv1.UpdateState_UPDATE_STATE_IDLE
	case core.UpdateStateChecking:
		return hopterv1.UpdateState_UPDATE_STATE_CHECKING
	case core.UpdateStateAvailable:
		return hopterv1.UpdateState_UPDATE_STATE_AVAILABLE
	case core.UpdateStateDownloading:
		return hopterv1.UpdateState_UPDATE_STATE_DOWNLOADING
	case core.UpdateStateVerifying:
		return hopterv1.UpdateState_UPDATE_STATE_VERIFYING
	case core.UpdateStatePreflightRunning:
		return hopterv1.UpdateState_UPDATE_STATE_PREFLIGHT_RUNNING
	case core.UpdateStateReadyToApply:
		return hopterv1.UpdateState_UPDATE_STATE_READY_TO_APPLY
	case core.UpdateStateReexecing:
		return hopterv1.UpdateState_UPDATE_STATE_REEXECING
	case core.UpdateStateFailedPreExec:
		return hopterv1.UpdateState_UPDATE_STATE_FAILED_PRE_EXEC
	case core.UpdateStateFailedPostExecUnknown:
		return hopterv1.UpdateState_UPDATE_STATE_FAILED_POST_EXEC_UNKNOWN
	default:
		return hopterv1.UpdateState_UPDATE_STATE_UNSPECIFIED
	}
}
