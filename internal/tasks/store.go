package tasks

import (
	"context"
	"errors"
)

var ErrNotFound = errors.New("task not found")

type Store interface {
	Close() error
	CreateTask(context.Context, CreateTaskInput) (Snapshot, error)
	CreateSubtask(context.Context, CreateSubtaskInput) (Snapshot, error)
	GetTask(context.Context, string) (Snapshot, error)
	ListTasks(context.Context, ListFilter) ([]Task, error)
}
