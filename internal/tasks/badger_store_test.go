package tasks

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestBadgerStoreCreateGetListTask(t *testing.T) {
	store, err := NewBadgerStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewBadgerStore() error = %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	created, err := store.CreateTask(context.Background(), CreateTaskInput{
		ProjectID:       "proj_1",
		Prompt:          "Build a task store",
		InitialSubtasks: []string{"Add schema", "Write tests"},
		SchedulerMode:   SchedulerDisabled,
	})
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if created.Task.ID == "" {
		t.Fatal("CreateTask() returned empty task id")
	}
	if created.Task.Title != "Build a task store" {
		t.Fatalf("CreateTask() title = %q", created.Task.Title)
	}
	if created.Task.LifecycleStatus != LifecycleWaiting {
		t.Fatalf("CreateTask() lifecycle = %q", created.Task.LifecycleStatus)
	}
	if created.Task.CurrentStage != StagePlan {
		t.Fatalf("CreateTask() stage = %q", created.Task.CurrentStage)
	}
	if created.Task.SubtaskCount != 2 {
		t.Fatalf("CreateTask() subtask count = %d", created.Task.SubtaskCount)
	}
	if len(created.Task.Diagnostics) != 1 || created.Task.Diagnostics[0].Code != "scheduler_disabled" {
		t.Fatalf("CreateTask() diagnostics = %#v", created.Task.Diagnostics)
	}

	got, err := store.GetTask(context.Background(), created.Task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if got.Task.ID != created.Task.ID {
		t.Fatalf("GetTask() id = %q, want %q", got.Task.ID, created.Task.ID)
	}
	if len(got.Subtasks) != 2 {
		t.Fatalf("GetTask() subtasks = %d", len(got.Subtasks))
	}
	if got.Subtasks[0].Sequence != 1 || got.Subtasks[1].Sequence != 2 {
		t.Fatalf("GetTask() subtask sequence = %#v", got.Subtasks)
	}

	listed, err := store.ListTasks(context.Background(), ListFilter{ProjectID: "proj_1"})
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(listed) != 1 || listed[0].ID != created.Task.ID {
		t.Fatalf("ListTasks() = %#v", listed)
	}
}

func TestBadgerStoreCreateSubtask(t *testing.T) {
	store, err := NewBadgerStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewBadgerStore() error = %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	created, err := store.CreateTask(context.Background(), CreateTaskInput{
		ProjectID:     "proj_1",
		Prompt:        "Build tasks",
		SchedulerMode: SchedulerDisabled,
	})
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	updated, err := store.CreateSubtask(context.Background(), CreateSubtaskInput{
		TaskID: created.Task.ID,
		Prompt: "Add a follow-up",
	})
	if err != nil {
		t.Fatalf("CreateSubtask() error = %v", err)
	}
	if updated.Task.SubtaskCount != 1 {
		t.Fatalf("CreateSubtask() task subtask count = %d", updated.Task.SubtaskCount)
	}
	if len(updated.Subtasks) != 1 {
		t.Fatalf("CreateSubtask() subtasks = %d", len(updated.Subtasks))
	}
	if updated.Subtasks[0].Title != "Add a follow-up" {
		t.Fatalf("CreateSubtask() title = %q", updated.Subtasks[0].Title)
	}
}

func TestBadgerStoreReportsFriendlyErrorWhenAlreadyOpen(t *testing.T) {
	root := t.TempDir()
	store, err := NewBadgerStore(root)
	if err != nil {
		t.Fatalf("NewBadgerStore() first open error = %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})

	_, err = NewBadgerStore(root)
	if err == nil {
		t.Fatal("NewBadgerStore() second open returned nil error")
	}

	var inUse *StoreInUseError
	if !errors.As(err, &inUse) {
		t.Fatalf("NewBadgerStore() error = %T %v, want StoreInUseError", err, err)
	}
	for _, want := range []string{
		"Hopter is already running",
		"Only one Hopter process",
		"Stop the other Hopter process",
		root,
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("NewBadgerStore() error missing %q: %v", want, err)
		}
	}
}
