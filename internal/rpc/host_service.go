package rpcserver

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	updater "github.com/sorcererxw/hopter/internal/update"
)

type HostService struct {
	workspace core.WorkspaceService
	updates   core.UpdateService
	agents    hostAgentCatalog
	models    hostModelLister
	quotas    hostQuotaReader
}

type hostAgentCatalog interface {
	ListAgentModels(backendKey string, includeHidden bool) ([]core.AgentModel, error)
	ReadAgentAccountRateLimits(backendKey string) (string, error)
	ReadAgentAccountRateLimitStatus(backendKey string) (core.AgentAccountRateLimits, error)
}

type hostModelLister interface {
	ListModels(includeHidden bool) ([]core.AgentModel, error)
}

type hostQuotaReader interface {
	ReadAccountRateLimits() (string, error)
}

func NewHostService(workspace core.WorkspaceService, updates core.UpdateService, models ...hostModelLister) *HostService {
	var agentCatalog hostAgentCatalog
	var modelLister hostModelLister
	var quotaReader hostQuotaReader
	for _, dependency := range models {
		if agentCatalog == nil {
			if catalog, ok := dependency.(hostAgentCatalog); ok {
				agentCatalog = catalog
			}
		}
		if modelLister == nil {
			modelLister = dependency
		}
		if quotaReader == nil {
			if reader, ok := dependency.(hostQuotaReader); ok {
				quotaReader = reader
			}
		}
	}
	return &HostService{
		workspace: workspace,
		updates:   updates,
		agents:    agentCatalog,
		models:    modelLister,
		quotas:    quotaReader,
	}
}

func (s *HostService) readBackendQuota(backend core.Backend) string {
	if !backend.Available {
		return ""
	}
	if s.agents != nil {
		quota, err := s.agents.ReadAgentAccountRateLimits(backend.Key)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(quota)
	}
	if backend.Key != core.BackendKeyCodex || s.quotas == nil {
		return ""
	}
	quota, err := s.quotas.ReadAccountRateLimits()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(quota)
}

func (s *HostService) mapBackendStatus(backend core.Backend) *hopterv1.BackendStatus {
	version := strings.TrimSpace(backend.Version)
	if quota := s.readBackendQuota(backend); quota != "" {
		version = quota
	}
	quotaStatus := s.readBackendQuotaStatus(backend)
	return &hopterv1.BackendStatus{
		BackendKey:       backend.Key,
		Available:        backend.Available,
		Version:          version,
		Reason:           backend.Reason,
		PlanType:         quotaStatus.PlanType,
		RateLimitWindows: mapBackendRateLimitWindows(quotaStatus.Windows),
	}
}

func (s *HostService) readBackendQuotaStatus(backend core.Backend) core.AgentAccountRateLimits {
	if !backend.Available || s.agents == nil {
		return core.AgentAccountRateLimits{}
	}
	status, err := s.agents.ReadAgentAccountRateLimitStatus(backend.Key)
	if err != nil {
		return core.AgentAccountRateLimits{}
	}
	return status
}

func mapBackendRateLimitWindows(windows []core.AgentRateLimitWindow) []*hopterv1.BackendRateLimitWindow {
	result := make([]*hopterv1.BackendRateLimitWindow, 0, len(windows))
	for _, window := range windows {
		result = append(result, &hopterv1.BackendRateLimitWindow{
			Label:              window.Label,
			UsedPercent:        window.UsedPercent,
			WindowDurationMins: window.WindowDurationMins,
			ResetsAt:           timestamp(window.ResetsAt),
		})
	}
	return result
}

func (s *HostService) GetHostStatus(_ context.Context, _ *connect.Request[hopterv1.GetHostStatusRequest]) (*connect.Response[hopterv1.GetHostStatusResponse], error) {
	snapshot := s.workspace.GetHostStatus()
	backends := s.workspace.ListBackends()
	backendStatuses := make([]*hopterv1.BackendStatus, 0, len(backends))
	for _, backend := range backends {
		backendStatuses = append(backendStatuses, s.mapBackendStatus(backend))
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
		response.Backends = append(response.Backends, s.mapBackendStatus(backend))
	}
	return connect.NewResponse(response), nil
}

func (s *HostService) ListModels(_ context.Context, req *connect.Request[hopterv1.ListModelsRequest]) (*connect.Response[hopterv1.ListModelsResponse], error) {
	backendKey := req.Msg.GetBackendKey()
	if backendKey == "" {
		backendKey = core.BackendKeyCodex
	}
	var models []core.AgentModel
	var err error
	if s.agents != nil {
		models, err = s.agents.ListAgentModels(backendKey, req.Msg.GetIncludeHidden())
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	} else if backendKey != core.BackendKeyCodex {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("backend %q does not expose models", backendKey))
	} else if s.models == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("model service unavailable"))
	} else {
		models, err = s.models.ListModels(req.Msg.GetIncludeHidden())
		if err != nil {
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("list %s models: %w", backendKey, err))
		}
	}

	response := &hopterv1.ListModelsResponse{
		Models: make([]*hopterv1.AgentModel, 0, len(models)),
	}
	for _, model := range models {
		response.Models = append(response.Models, agentModelToProto(model))
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
			Path:        skill.Path,
		})
	}

	return connect.NewResponse(response), nil
}

func (s *HostService) GetSkill(_ context.Context, req *connect.Request[hopterv1.GetSkillRequest]) (*connect.Response[hopterv1.GetSkillResponse], error) {
	skill, err := s.workspace.GetSkill(req.Msg.GetPath())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&hopterv1.GetSkillResponse{
		Skill: &hopterv1.SkillSummary{
			Name:        skill.Name,
			Reference:   skill.Reference,
			Description: skill.Description,
			Source:      skill.Source,
			Path:        skill.Path,
		},
	}), nil
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
