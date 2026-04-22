package rpcserver

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	"github.com/sorcererxw/hopter/internal/gitops"
)

type GitService struct {
	git *gitops.Service
}

func NewGitService(git *gitops.Service) *GitService {
	return &GitService{git: git}
}

func (s *GitService) GetProjectGitStatus(
	ctx context.Context,
	req *connect.Request[hopterv1.GetProjectGitStatusRequest],
) (*connect.Response[hopterv1.GetProjectGitStatusResponse], error) {
	status, err := s.git.GetProjectGitStatus(ctx, req.Msg.GetProjectId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&hopterv1.GetProjectGitStatusResponse{
		Status: projectGitStatusToProto(status),
	}), nil
}

func (s *GitService) CommitProjectChanges(
	ctx context.Context,
	req *connect.Request[hopterv1.CommitProjectChangesRequest],
) (*connect.Response[hopterv1.CommitProjectChangesResponse], error) {
	mode, err := gitCommitModeFromProto(req.Msg.GetMode())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	result, err := s.git.CommitProjectChanges(
		ctx,
		req.Msg.GetProjectId(),
		mode,
		req.Msg.GetMessage(),
		req.Msg.GetExpectedStatusToken(),
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(commitProjectChangesResponseToProto(result)), nil
}

func (s *GitService) PushProjectBranch(
	ctx context.Context,
	req *connect.Request[hopterv1.PushProjectBranchRequest],
) (*connect.Response[hopterv1.PushProjectBranchResponse], error) {
	result, err := s.git.PushProjectBranch(
		ctx,
		req.Msg.GetProjectId(),
		req.Msg.GetExpectedHeadSha(),
		req.Msg.GetExpectedStatusToken(),
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(pushProjectBranchResponseToProto(result)), nil
}

func gitCommitModeFromProto(mode hopterv1.GitCommitMode) (gitops.CommitMode, error) {
	switch mode {
	case hopterv1.GitCommitMode_GIT_COMMIT_MODE_COMMIT_ONLY:
		return gitops.CommitOnly, nil
	case hopterv1.GitCommitMode_GIT_COMMIT_MODE_COMMIT_AND_PUSH:
		return gitops.CommitAndPush, nil
	default:
		return "", fmt.Errorf("commit mode is required")
	}
}

func projectGitStatusToProto(status gitops.ProjectStatus) *hopterv1.ProjectGitStatus {
	files := make([]*hopterv1.GitFileChange, 0, len(status.Files))
	for _, file := range status.Files {
		files = append(files, &hopterv1.GitFileChange{
			Path:            validUTF8(file.Path),
			Status:          gitFileStatusToProto(file.Status),
			IndexStatus:     validUTF8(file.IndexStatus),
			WorktreeStatus:  validUTF8(file.WorktreeStatus),
			OldPath:         validUTF8(file.OldPath),
			PartiallyStaged: file.PartiallyStaged,
			Additions:       uint32(file.Additions),
			Deletions:       uint32(file.Deletions),
		})
	}
	return &hopterv1.ProjectGitStatus{
		ProjectId:              validUTF8(status.ProjectID),
		RootPath:               validUTF8(status.RootPath),
		Branch:                 validUTF8(status.Branch),
		HeadSha:                validUTF8(status.HeadSHA),
		HeadShortSha:           validUTF8(status.HeadShortSHA),
		Upstream:               validUTF8(status.Upstream),
		PushRemote:             validUTF8(status.PushRemote),
		PushBranch:             validUTF8(status.PushBranch),
		Ahead:                  int32(status.Ahead),
		Behind:                 int32(status.Behind),
		Dirty:                  status.Dirty,
		HasConflicts:           status.HasConflicts,
		ProjectHasActiveWriter: status.ProjectHasActiveWriter,
		CanCommit:              status.CanCommit,
		CanPush:                status.CanPush,
		IsGitRepository:        status.IsGitRepository,
		DetachedHead:           status.DetachedHead,
		UnbornBranch:           status.UnbornBranch,
		StatusToken:            validUTF8(status.StatusToken),
		DefaultCommitMessage:   validUTF8(status.DefaultCommitMessage),
		Files:                  files,
		Blockers:               diagnosticsToProto(status.Blockers),
		Warnings:               diagnosticsToProto(status.Warnings),
	}
}

func commitProjectChangesResponseToProto(result gitops.CommitResult) *hopterv1.CommitProjectChangesResponse {
	return &hopterv1.CommitProjectChangesResponse{
		Outcome:        gitOutcomeToProto(result.Outcome),
		CommitSha:      validUTF8(result.CommitSHA),
		CommitShortSha: validUTF8(result.CommitShortSHA),
		Branch:         validUTF8(result.Branch),
		Upstream:       validUTF8(result.Upstream),
		Summary:        validUTF8(result.Summary),
		CommittedPaths: validUTF8List(result.CommittedPaths),
		Diagnostics:    diagnosticsToProto(result.Diagnostics),
		StatusAfter:    projectGitStatusToProto(result.StatusAfter),
	}
}

func pushProjectBranchResponseToProto(result gitops.PushResult) *hopterv1.PushProjectBranchResponse {
	return &hopterv1.PushProjectBranchResponse{
		Outcome:     gitOutcomeToProto(result.Outcome),
		Branch:      validUTF8(result.Branch),
		Upstream:    validUTF8(result.Upstream),
		Diagnostics: diagnosticsToProto(result.Diagnostics),
		StatusAfter: projectGitStatusToProto(result.StatusAfter),
	}
}

func diagnosticsToProto(diagnostics []gitops.Diagnostic) []*hopterv1.GitDiagnostic {
	result := make([]*hopterv1.GitDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		result = append(result, &hopterv1.GitDiagnostic{
			Code:          validUTF8(diagnostic.Code),
			Step:          validUTF8(diagnostic.Step),
			Message:       validUTF8(diagnostic.Message),
			StderrExcerpt: validUTF8(diagnostic.StderrExcerpt),
			ExitCode:      int32(diagnostic.ExitCode),
		})
	}
	return result
}

func gitFileStatusToProto(status gitops.FileStatus) hopterv1.GitFileStatus {
	switch status {
	case gitops.FileStatusAdded:
		return hopterv1.GitFileStatus_GIT_FILE_STATUS_ADDED
	case gitops.FileStatusModified:
		return hopterv1.GitFileStatus_GIT_FILE_STATUS_MODIFIED
	case gitops.FileStatusDeleted:
		return hopterv1.GitFileStatus_GIT_FILE_STATUS_DELETED
	case gitops.FileStatusRenamed:
		return hopterv1.GitFileStatus_GIT_FILE_STATUS_RENAMED
	case gitops.FileStatusUntracked:
		return hopterv1.GitFileStatus_GIT_FILE_STATUS_UNTRACKED
	case gitops.FileStatusConflicted:
		return hopterv1.GitFileStatus_GIT_FILE_STATUS_CONFLICTED
	default:
		return hopterv1.GitFileStatus_GIT_FILE_STATUS_UNSPECIFIED
	}
}

func gitOutcomeToProto(outcome gitops.Outcome) hopterv1.GitActionOutcome {
	switch outcome {
	case gitops.OutcomeCommitted:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_COMMITTED
	case gitops.OutcomeCommittedAndPushed:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_COMMITTED_AND_PUSHED
	case gitops.OutcomeCommittedPushFailed:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_COMMITTED_PUSH_FAILED
	case gitops.OutcomePushed:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_PUSHED
	case gitops.OutcomeNoChanges:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_NO_CHANGES
	case gitops.OutcomeRejectedStale:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_REJECTED_STALE
	case gitops.OutcomeRejectedBlocked:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_REJECTED_BLOCKED
	case gitops.OutcomeFailed:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_FAILED
	default:
		return hopterv1.GitActionOutcome_GIT_ACTION_OUTCOME_UNSPECIFIED
	}
}

func validUTF8List(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, validUTF8(value))
	}
	return result
}
