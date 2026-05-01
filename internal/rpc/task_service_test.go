package rpcserver

import (
	"context"
	"os"
	"testing"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	"github.com/sorcererxw/hopter/internal/tasks"
)

func TestTaskServiceAcceptsSyntheticCWDSessionProject(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	store, err := tasks.NewBadgerStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewBadgerStore() error = %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	rootPath, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	projectID := "cwd:" + rootPath
	sessionID := "sess_queued"
	service := NewTaskService(store, workspace, nil)

	created, err := service.CreateTask(context.Background(), connect.NewRequest(&hopterv1.CreateTaskRequest{
		ProjectId: projectID,
		SessionId: &sessionID,
		Prompt:    "Queue this for the current session",
	}))
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if got := created.Msg.GetTask().GetProject().GetId(); got != projectID {
		t.Fatalf("CreateTask() project id = %q, want %q", got, projectID)
	}
	if got := created.Msg.GetTask().GetSessionId(); got != sessionID {
		t.Fatalf("CreateTask() session id = %q, want %q", got, sessionID)
	}
	if got := created.Msg.GetTask().GetLifecycleStatus(); got != hopterv1.TaskLifecycleStatus_TASK_LIFECYCLE_STATUS_WAITING {
		t.Fatalf("CreateTask() lifecycle = %v, want waiting", got)
	}

	listed, err := service.ListTasks(context.Background(), connect.NewRequest(&hopterv1.ListTasksRequest{
		SessionId: &sessionID,
		Limit:     uint32Ptr(10),
	}))
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(listed.Msg.GetTasks()) != 1 {
		t.Fatalf("ListTasks() task count = %d, want 1", len(listed.Msg.GetTasks()))
	}
	if got := listed.Msg.GetTasks()[0].GetProject().GetId(); got != projectID {
		t.Fatalf("ListTasks() project id = %q, want %q", got, projectID)
	}
}

func uint32Ptr(value uint32) *uint32 {
	return &value
}
