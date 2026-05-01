package rpcserver

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	"github.com/sorcererxw/hopter/internal/tasks"
)

type TaskService struct {
	store     tasks.Store
	workspace core.WorkspaceService
	eventSink core.EventSink
}

func NewTaskService(store tasks.Store, workspace core.WorkspaceService, eventSink core.EventSink) *TaskService {
	return &TaskService{store: store, workspace: workspace, eventSink: eventSink}
}

func (s *TaskService) ListTasks(ctx context.Context, req *connect.Request[hopterv1.ListTasksRequest]) (*connect.Response[hopterv1.ListTasksResponse], error) {
	filter := tasks.ListFilter{
		ProjectID:       req.Msg.GetProjectId(),
		SessionID:       req.Msg.GetSessionId(),
		AttentionKind:   attentionKindFromProto(req.Msg.GetAttentionKind()),
		LifecycleStatus: lifecycleStatusFromProto(req.Msg.GetLifecycleStatus()),
		Limit:           req.Msg.GetLimit(),
	}
	items, err := s.store.ListTasks(ctx, filter)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	response := &hopterv1.ListTasksResponse{Tasks: make([]*hopterv1.Task, 0, len(items))}
	for _, item := range items {
		response.Tasks = append(response.Tasks, s.taskToProto(item))
	}
	return connect.NewResponse(response), nil
}

func (s *TaskService) GetTask(ctx context.Context, req *connect.Request[hopterv1.GetTaskRequest]) (*connect.Response[hopterv1.GetTaskResponse], error) {
	snapshot, err := s.store.GetTask(ctx, req.Msg.GetTaskId())
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	return connect.NewResponse(&hopterv1.GetTaskResponse{
		Task:        s.taskToProto(snapshot.Task),
		Subtasks:    subtasksToProto(snapshot.Subtasks),
		CurrentGate: gateToProto(snapshot.CurrentGate),
	}), nil
}

func (s *TaskService) CreateTask(ctx context.Context, req *connect.Request[hopterv1.CreateTaskRequest]) (*connect.Response[hopterv1.CreateTaskResponse], error) {
	if _, ok := s.resolveTaskProject(req.Msg.GetProjectId()); !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("project %q not found", req.Msg.GetProjectId()))
	}
	snapshot, err := s.store.CreateTask(ctx, tasks.CreateTaskInput{
		ProjectID:       req.Msg.GetProjectId(),
		SessionID:       req.Msg.GetSessionId(),
		Title:           req.Msg.GetTitle(),
		Prompt:          req.Msg.GetPrompt(),
		Priority:        req.Msg.GetPriority(),
		InitialSubtasks: req.Msg.GetInitialSubtasks(),
		IdempotencyKey:  req.Msg.GetIdempotencyKey(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	s.publishTaskChanged(snapshot.Task)
	return connect.NewResponse(&hopterv1.CreateTaskResponse{
		Task:        s.taskToProto(snapshot.Task),
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    true,
		Diagnostics: diagnosticsToTaskProto(snapshot.Task.Diagnostics),
	}), nil
}

func (s *TaskService) CreateSubtask(ctx context.Context, req *connect.Request[hopterv1.CreateSubtaskRequest]) (*connect.Response[hopterv1.CreateSubtaskResponse], error) {
	snapshot, err := s.store.CreateSubtask(ctx, tasks.CreateSubtaskInput{
		TaskID:         req.Msg.GetTaskId(),
		Title:          req.Msg.GetTitle(),
		Prompt:         req.Msg.GetPrompt(),
		IdempotencyKey: req.Msg.GetIdempotencyKey(),
	})
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	s.publishTaskChanged(snapshot.Task)
	var subtask *hopterv1.Subtask
	if len(snapshot.Subtasks) > 0 {
		subtask = subtaskToProto(snapshot.Subtasks[len(snapshot.Subtasks)-1])
	}
	return connect.NewResponse(&hopterv1.CreateSubtaskResponse{
		Task:        s.taskToProto(snapshot.Task),
		Subtask:     subtask,
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    true,
		Diagnostics: diagnosticsToTaskProto(snapshot.Task.Diagnostics),
	}), nil
}

func (s *TaskService) publishTaskChanged(task tasks.Task) {
	if s.eventSink == nil {
		return
	}
	s.eventSink.Publish(core.Event{
		Kind:      core.EventTasksChanged,
		ProjectID: task.ProjectID,
		SessionID: task.SessionID,
		TaskID:    task.ID,
		Summary:   task.Title,
	})
	s.eventSink.Publish(core.Event{
		Kind:      core.EventTaskChanged,
		ProjectID: task.ProjectID,
		SessionID: task.SessionID,
		TaskID:    task.ID,
		Summary:   task.Title,
	})
}

func (s *TaskService) ApproveTaskGate(ctx context.Context, req *connect.Request[hopterv1.ApproveTaskGateRequest]) (*connect.Response[hopterv1.ApproveTaskGateResponse], error) {
	snapshot, err := s.store.GetTask(ctx, req.Msg.GetTaskId())
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	diagnostics := []tasks.Diagnostic{notImplementedDiagnostic("gate_approval_not_implemented", "Gate approval is not wired in this slice.")}
	return connect.NewResponse(&hopterv1.ApproveTaskGateResponse{
		Task:        s.taskToProto(snapshot.Task),
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    false,
		Diagnostics: diagnosticsToTaskProto(diagnostics),
	}), nil
}

func (s *TaskService) RequestTaskRevision(ctx context.Context, req *connect.Request[hopterv1.RequestTaskRevisionRequest]) (*connect.Response[hopterv1.RequestTaskRevisionResponse], error) {
	snapshot, err := s.store.GetTask(ctx, req.Msg.GetTaskId())
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	diagnostics := []tasks.Diagnostic{notImplementedDiagnostic("task_revision_not_implemented", "Task revision is not wired in this slice.")}
	return connect.NewResponse(&hopterv1.RequestTaskRevisionResponse{
		Task:        s.taskToProto(snapshot.Task),
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    false,
		Diagnostics: diagnosticsToTaskProto(diagnostics),
	}), nil
}

func (s *TaskService) RetryTaskStage(ctx context.Context, req *connect.Request[hopterv1.RetryTaskStageRequest]) (*connect.Response[hopterv1.RetryTaskStageResponse], error) {
	snapshot, err := s.store.GetTask(ctx, req.Msg.GetTaskId())
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	diagnostics := []tasks.Diagnostic{notImplementedDiagnostic("task_retry_not_implemented", "Task retry is not wired in this slice.")}
	return connect.NewResponse(&hopterv1.RetryTaskStageResponse{
		Task:        s.taskToProto(snapshot.Task),
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    false,
		Diagnostics: diagnosticsToTaskProto(diagnostics),
	}), nil
}

func (s *TaskService) PauseTask(ctx context.Context, req *connect.Request[hopterv1.PauseTaskRequest]) (*connect.Response[hopterv1.PauseTaskResponse], error) {
	snapshot, err := s.store.GetTask(ctx, req.Msg.GetTaskId())
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	diagnostics := []tasks.Diagnostic{notImplementedDiagnostic("task_pause_not_implemented", "Task pause is not wired in this slice.")}
	return connect.NewResponse(&hopterv1.PauseTaskResponse{
		Task:        s.taskToProto(snapshot.Task),
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    false,
		Diagnostics: diagnosticsToTaskProto(diagnostics),
	}), nil
}

func (s *TaskService) ResumeTask(ctx context.Context, req *connect.Request[hopterv1.ResumeTaskRequest]) (*connect.Response[hopterv1.ResumeTaskResponse], error) {
	snapshot, err := s.store.GetTask(ctx, req.Msg.GetTaskId())
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	diagnostics := []tasks.Diagnostic{notImplementedDiagnostic("task_resume_not_implemented", "Task resume is not wired in this slice.")}
	return connect.NewResponse(&hopterv1.ResumeTaskResponse{
		Task:        s.taskToProto(snapshot.Task),
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    false,
		Diagnostics: diagnosticsToTaskProto(diagnostics),
	}), nil
}

func (s *TaskService) CancelTask(ctx context.Context, req *connect.Request[hopterv1.CancelTaskRequest]) (*connect.Response[hopterv1.CancelTaskResponse], error) {
	snapshot, err := s.store.GetTask(ctx, req.Msg.GetTaskId())
	if err != nil {
		return nil, taskError(req.Msg.GetTaskId(), err)
	}
	diagnostics := []tasks.Diagnostic{notImplementedDiagnostic("task_cancel_not_implemented", "Task cancel is not wired in this slice.")}
	return connect.NewResponse(&hopterv1.CancelTaskResponse{
		Task:        s.taskToProto(snapshot.Task),
		CurrentGate: gateToProto(snapshot.CurrentGate),
		Accepted:    false,
		Diagnostics: diagnosticsToTaskProto(diagnostics),
	}), nil
}

func (s *TaskService) taskToProto(task tasks.Task) *hopterv1.Task {
	project, _ := s.resolveTaskProject(task.ProjectID)
	return &hopterv1.Task{
		Id:                    task.ID,
		Project:               projectRef(project),
		Title:                 validUTF8(task.Title),
		Prompt:                validUTF8(task.Prompt),
		SessionId:             validUTF8(task.SessionID),
		LifecycleStatus:       lifecycleStatusToProto(task.LifecycleStatus),
		CurrentStage:          taskStageToProto(task.CurrentStage),
		AttentionKind:         attentionKindToProto(task.AttentionKind),
		CommitStatus:          commitStatusToProto(task.CommitStatus),
		SubtaskCount:          task.SubtaskCount,
		CompletedSubtaskCount: task.CompletedSubtaskCount,
		Diagnostics:           diagnosticsToTaskProto(task.Diagnostics),
		CreatedAt:             timestamp(task.CreatedAt),
		UpdatedAt:             timestamp(task.UpdatedAt),
		CompletedAt:           optionalTimestamp(task.CompletedAt),
	}
}

func (s *TaskService) resolveTaskProject(projectID string) (core.Project, bool) {
	if project, ok := s.workspace.GetProject(projectID); ok {
		return project, true
	}

	trimmedProjectID := strings.TrimSpace(projectID)
	if !strings.HasPrefix(trimmedProjectID, "cwd:") {
		return core.Project{}, false
	}

	rootPath := strings.TrimSpace(strings.TrimPrefix(trimmedProjectID, "cwd:"))
	if rootPath == "" {
		return core.Project{}, false
	}

	metadata, err := s.workspace.GetPathMetadata(rootPath)
	if err != nil || !metadata.IsAllowed || !metadata.IsDirectory {
		return core.Project{}, false
	}

	name := filepath.Base(metadata.CanonicalPath)
	if name == "." || name == string(filepath.Separator) || name == "" {
		name = metadata.CanonicalPath
	}

	return core.Project{
		ID:             trimmedProjectID,
		Name:           name,
		RootPath:       metadata.CanonicalPath,
		DefaultBackend: core.BackendKeyCodex,
	}, true
}

func subtasksToProto(subtasks []tasks.Subtask) []*hopterv1.Subtask {
	result := make([]*hopterv1.Subtask, 0, len(subtasks))
	for _, subtask := range subtasks {
		result = append(result, subtaskToProto(subtask))
	}
	return result
}

func subtaskToProto(subtask tasks.Subtask) *hopterv1.Subtask {
	return &hopterv1.Subtask{
		Id:            validUTF8(subtask.ID),
		TaskId:        validUTF8(subtask.TaskID),
		Sequence:      subtask.Sequence,
		Title:         validUTF8(subtask.Title),
		Prompt:        validUTF8(subtask.Prompt),
		Status:        subtaskStatusToProto(subtask.Status),
		SessionTurnId: validUTF8(subtask.SessionTurnID),
		CreatedAt:     timestamp(subtask.CreatedAt),
		UpdatedAt:     timestamp(subtask.UpdatedAt),
		CompletedAt:   optionalTimestamp(subtask.CompletedAt),
	}
}

func gateToProto(gate *tasks.Gate) *hopterv1.TaskHumanGate {
	if gate == nil {
		return nil
	}
	return &hopterv1.TaskHumanGate{
		Id:                  validUTF8(gate.ID),
		TaskId:              validUTF8(gate.TaskID),
		StageRunId:          validUTF8(gate.StageRunID),
		Stage:               taskStageToProto(gate.Stage),
		Status:              gateStatusToProto(gate.Status),
		Revision:            gate.Revision,
		Question:            validUTF8(gate.Question),
		RecommendedDecision: validUTF8(gate.RecommendedDecision),
		Decision:            validUTF8(gate.Decision),
		Comment:             validUTF8(gate.Comment),
		CreatedAt:           timestamp(gate.CreatedAt),
		DecidedAt:           optionalTimestamp(gate.DecidedAt),
	}
}

func diagnosticsToTaskProto(diagnostics []tasks.Diagnostic) []*hopterv1.TaskDiagnostic {
	result := make([]*hopterv1.TaskDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		result = append(result, &hopterv1.TaskDiagnostic{
			Code:         validUTF8(diagnostic.Code),
			Severity:     validUTF8(diagnostic.Severity),
			Source:       validUTF8(diagnostic.Source),
			Message:      validUTF8(diagnostic.Message),
			Cause:        validUTF8(diagnostic.Cause),
			UserAction:   validUTF8(diagnostic.UserAction),
			Retriable:    diagnostic.Retriable,
			EvidencePath: validUTF8(diagnostic.EvidencePath),
			SessionId:    validUTF8(diagnostic.SessionID),
			StageRunId:   validUTF8(diagnostic.StageRunID),
			DocsUrl:      validUTF8(diagnostic.DocsURL),
		})
	}
	return result
}

func taskError(taskID string, err error) error {
	if errors.Is(err, tasks.ErrNotFound) {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("task %q not found", taskID))
	}
	return connect.NewError(connect.CodeInvalidArgument, err)
}

func notImplementedDiagnostic(code string, message string) tasks.Diagnostic {
	return tasks.Diagnostic{
		Code:       code,
		Severity:   "info",
		Source:     "tasks",
		Message:    message,
		Cause:      "Only the durable task foundation is enabled in this slice.",
		UserAction: "Continue with the next Tasks implementation slice.",
		Retriable:  false,
	}
}

func lifecycleStatusToProto(status tasks.LifecycleStatus) hopterv1.TaskLifecycleStatus {
	switch status {
	case tasks.LifecycleActive:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_ACTIVE
	case tasks.LifecycleWaiting:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_WAITING
	case tasks.LifecyclePaused:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_PAUSED
	case tasks.LifecycleBlocked:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_BLOCKED
	case tasks.LifecycleFailed:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_FAILED
	case tasks.LifecycleCanceled:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_CANCELED
	case tasks.LifecycleDone:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_DONE
	default:
		return hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_UNSPECIFIED
	}
}

func lifecycleStatusFromProto(status hopterv1.TaskLifecycleStatus) tasks.LifecycleStatus {
	switch status {
	case hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_ACTIVE:
		return tasks.LifecycleActive
	case hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_WAITING:
		return tasks.LifecycleWaiting
	case hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_PAUSED:
		return tasks.LifecyclePaused
	case hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_BLOCKED:
		return tasks.LifecycleBlocked
	case hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_FAILED:
		return tasks.LifecycleFailed
	case hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_CANCELED:
		return tasks.LifecycleCanceled
	case hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_DONE:
		return tasks.LifecycleDone
	default:
		return ""
	}
}

func taskStageToProto(stage tasks.Stage) hopterv1.TaskStage {
	switch stage {
	case tasks.StagePlan:
		return hopterv1.TaskStage_TASK_STAGE_PLAN
	case tasks.StageCode:
		return hopterv1.TaskStage_TASK_STAGE_CODE
	case tasks.StageReview:
		return hopterv1.TaskStage_TASK_STAGE_REVIEW
	case tasks.StageCommit:
		return hopterv1.TaskStage_TASK_STAGE_COMMIT
	case tasks.StageSubtask:
		return hopterv1.TaskStage_TASK_STAGE_SUBTASK
	default:
		return hopterv1.TaskStage_TASK_STAGE_UNSPECIFIED
	}
}

func attentionKindToProto(kind tasks.AttentionKind) hopterv1.AttentionKind {
	switch kind {
	case tasks.AttentionPlanApproval:
		return hopterv1.AttentionKind_ATTENTION_KIND_PLAN_APPROVAL
	case tasks.AttentionDevelopmentApproval:
		return hopterv1.AttentionKind_ATTENTION_KIND_DEVELOPMENT_APPROVAL
	case tasks.AttentionBlocked:
		return hopterv1.AttentionKind_ATTENTION_KIND_BLOCKED
	case tasks.AttentionCommitBlocked:
		return hopterv1.AttentionKind_ATTENTION_KIND_COMMIT_BLOCKED
	case tasks.AttentionStaleGate:
		return hopterv1.AttentionKind_ATTENTION_KIND_STALE_GATE
	default:
		return hopterv1.AttentionKind_ATTENTION_KIND_UNSPECIFIED
	}
}

func attentionKindFromProto(kind hopterv1.AttentionKind) tasks.AttentionKind {
	switch kind {
	case hopterv1.AttentionKind_ATTENTION_KIND_PLAN_APPROVAL:
		return tasks.AttentionPlanApproval
	case hopterv1.AttentionKind_ATTENTION_KIND_DEVELOPMENT_APPROVAL:
		return tasks.AttentionDevelopmentApproval
	case hopterv1.AttentionKind_ATTENTION_KIND_BLOCKED:
		return tasks.AttentionBlocked
	case hopterv1.AttentionKind_ATTENTION_KIND_COMMIT_BLOCKED:
		return tasks.AttentionCommitBlocked
	case hopterv1.AttentionKind_ATTENTION_KIND_STALE_GATE:
		return tasks.AttentionStaleGate
	default:
		return ""
	}
}

func commitStatusToProto(status tasks.CommitStatus) hopterv1.CommitStatus {
	switch status {
	case tasks.CommitNotReady:
		return hopterv1.CommitStatus_COMMIT_STATUS_NOT_READY
	case tasks.CommitReadyToCommit:
		return hopterv1.CommitStatus_COMMIT_STATUS_READY_TO_COMMIT
	case tasks.CommitBlocked:
		return hopterv1.CommitStatus_COMMIT_STATUS_BLOCKED
	case tasks.CommitCommitted:
		return hopterv1.CommitStatus_COMMIT_STATUS_COMMITTED
	default:
		return hopterv1.CommitStatus_COMMIT_STATUS_UNSPECIFIED
	}
}

func gateStatusToProto(status tasks.GateStatus) hopterv1.GateStatus {
	switch status {
	case tasks.GateOpen:
		return hopterv1.GateStatus_GATE_STATUS_OPEN
	case tasks.GateApproved:
		return hopterv1.GateStatus_GATE_STATUS_APPROVED
	case tasks.GateRevisionRequested:
		return hopterv1.GateStatus_GATE_STATUS_REVISION_REQUESTED
	case tasks.GateCanceled:
		return hopterv1.GateStatus_GATE_STATUS_CANCELED
	case tasks.GateStale:
		return hopterv1.GateStatus_GATE_STATUS_STALE
	default:
		return hopterv1.GateStatus_GATE_STATUS_UNSPECIFIED
	}
}

func subtaskStatusToProto(status tasks.SubtaskStatus) hopterv1.SubtaskStatus {
	switch status {
	case tasks.SubtaskOpen:
		return hopterv1.SubtaskStatus_SUBTASK_STATUS_OPEN
	case tasks.SubtaskRunning:
		return hopterv1.SubtaskStatus_SUBTASK_STATUS_RUNNING
	case tasks.SubtaskDone:
		return hopterv1.SubtaskStatus_SUBTASK_STATUS_DONE
	case tasks.SubtaskBlocked:
		return hopterv1.SubtaskStatus_SUBTASK_STATUS_BLOCKED
	case tasks.SubtaskCanceled:
		return hopterv1.SubtaskStatus_SUBTASK_STATUS_CANCELED
	default:
		return hopterv1.SubtaskStatus_SUBTASK_STATUS_UNSPECIFIED
	}
}
