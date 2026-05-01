package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/dgraph-io/badger/v4"
	"github.com/google/uuid"
)

const (
	taskKeyPrefix    = "task/"
	subtaskKeyPrefix = "subtask/"
)

type BadgerStore struct {
	db *badger.DB
}

var openBadger = badger.Open

type StoreInUseError struct {
	Path string
	Err  error
}

func (e *StoreInUseError) Error() string {
	if strings.TrimSpace(e.Path) == "" {
		return "Hopter is already running. Only one Hopter process can run on this machine at a time. Stop the other Hopter process before starting this one."
	}
	return fmt.Sprintf("Hopter is already running. Only one Hopter process can use this machine at a time. Stop the other Hopter process before starting this one. Locked store: %s", e.Path)
}

func (e *StoreInUseError) Unwrap() error {
	return e.Err
}

func NewBadgerStore(root string) (*BadgerStore, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("task store path is required")
	}
	cleanRoot := filepath.Clean(root)
	if err := os.MkdirAll(cleanRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create task store directory: %w", err)
	}
	opts := badger.DefaultOptions(cleanRoot)
	opts.Logger = nil
	db, err := openBadger(opts)
	if err != nil {
		if isBadgerDirectoryLockError(err) {
			return nil, &StoreInUseError{Path: cleanRoot, Err: err}
		}
		if isRecoverableBadgerOpenError(err) {
			if recoverErr := archiveCorruptBadgerStore(cleanRoot); recoverErr != nil {
				return nil, fmt.Errorf("archive corrupt task store: %w", recoverErr)
			}
			db, err = openBadger(opts)
			if err == nil {
				return &BadgerStore{db: db}, nil
			}
		}
		return nil, err
	}
	return &BadgerStore{db: db}, nil
}

func isBadgerDirectoryLockError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "Cannot acquire directory lock") ||
		strings.Contains(message, "resource temporarily unavailable")
}

func isRecoverableBadgerOpenError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "while opening memtables") ||
		strings.Contains(message, "while opening fid") ||
		strings.Contains(message, "Create a new file") ||
		strings.Contains(message, "manifest has unsupported version") ||
		strings.Contains(message, "checksum mismatch") ||
		strings.Contains(message, "value log truncate")
}

func archiveCorruptBadgerStore(root string) error {
	info, err := os.Stat(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("task store root is not a directory: %s", root)
	}
	parent := filepath.Dir(root)
	archivePath := fmt.Sprintf("%s.corrupt-%s", root, time.Now().UTC().Format("20060102T150405"))
	if err := os.Rename(root, archivePath); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Join(parent, filepath.Base(root)), 0o700)
}

func (s *BadgerStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *BadgerStore) CreateTask(ctx context.Context, input CreateTaskInput) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	title := strings.TrimSpace(input.Title)
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		return Snapshot{}, fmt.Errorf("task prompt is required")
	}
	if strings.TrimSpace(input.ProjectID) == "" {
		return Snapshot{}, fmt.Errorf("project id is required")
	}
	if title == "" {
		title = deriveTitle(prompt)
	}

	now := time.Now().UTC()
	task := Task{
		ID:              "task_" + uuid.NewString(),
		ProjectID:       strings.TrimSpace(input.ProjectID),
		SessionID:       strings.TrimSpace(input.SessionID),
		Title:           title,
		Prompt:          prompt,
		Priority:        input.Priority,
		LifecycleStatus: LifecycleActive,
		CurrentStage:    StagePlan,
		CommitStatus:    CommitNotReady,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if task.SessionID != "" {
		task.LifecycleStatus = LifecycleWaiting
	}

	subtasks := make([]Subtask, 0, len(input.InitialSubtasks))
	for _, raw := range input.InitialSubtasks {
		text := strings.TrimSpace(raw)
		if text == "" {
			continue
		}
		subtasks = append(subtasks, Subtask{
			ID:        "subtask_" + uuid.NewString(),
			TaskID:    task.ID,
			Sequence:  uint32(len(subtasks) + 1),
			Title:     deriveTitle(text),
			Prompt:    text,
			Status:    SubtaskOpen,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}
	task.SubtaskCount = uint32(len(subtasks))

	err := s.db.Update(func(txn *badger.Txn) error {
		if err := setJSON(txn, taskKey(task.ID), task); err != nil {
			return err
		}
		for _, subtask := range subtasks {
			if err := setJSON(txn, subtaskKey(subtask.TaskID, subtask.Sequence, subtask.ID), subtask); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Task: task, Subtasks: subtasks}, nil
}

func (s *BadgerStore) CreateSubtask(ctx context.Context, input CreateSubtaskInput) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		return Snapshot{}, fmt.Errorf("subtask prompt is required")
	}
	now := time.Now().UTC()
	var snapshot Snapshot
	err := s.db.Update(func(txn *badger.Txn) error {
		task, err := getTask(txn, input.TaskID)
		if err != nil {
			return err
		}
		subtasks, err := listSubtasks(txn, input.TaskID)
		if err != nil {
			return err
		}
		subtask := Subtask{
			ID:        "subtask_" + uuid.NewString(),
			TaskID:    input.TaskID,
			Sequence:  uint32(len(subtasks) + 1),
			Title:     firstNonEmpty(strings.TrimSpace(input.Title), deriveTitle(prompt)),
			Prompt:    prompt,
			Status:    SubtaskOpen,
			CreatedAt: now,
			UpdatedAt: now,
		}
		subtasks = append(subtasks, subtask)
		task.SubtaskCount = uint32(len(subtasks))
		task.UpdatedAt = now
		if err := setJSON(txn, taskKey(task.ID), task); err != nil {
			return err
		}
		if err := setJSON(txn, subtaskKey(subtask.TaskID, subtask.Sequence, subtask.ID), subtask); err != nil {
			return err
		}
		snapshot = Snapshot{Task: task, Subtasks: subtasks}
		return nil
	})
	if err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func (s *BadgerStore) GetTask(ctx context.Context, taskID string) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	var snapshot Snapshot
	err := s.db.View(func(txn *badger.Txn) error {
		task, err := getTask(txn, taskID)
		if err != nil {
			return err
		}
		subtasks, err := listSubtasks(txn, taskID)
		if err != nil {
			return err
		}
		snapshot = Snapshot{Task: task, Subtasks: subtasks}
		return nil
	})
	if err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func (s *BadgerStore) ListTasks(ctx context.Context, filter ListFilter) ([]Task, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var tasks []Task
	err := s.db.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.PrefetchValues = true
		it := txn.NewIterator(opts)
		defer it.Close()
		prefix := []byte(taskKeyPrefix)
		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
			item := it.Item()
			var task Task
			if err := item.Value(func(value []byte) error {
				return json.Unmarshal(value, &task)
			}); err != nil {
				return err
			}
			if filter.ProjectID != "" && task.ProjectID != filter.ProjectID {
				continue
			}
			if filter.SessionID != "" && task.SessionID != filter.SessionID {
				continue
			}
			if filter.AttentionKind != "" && task.AttentionKind != filter.AttentionKind {
				continue
			}
			if filter.LifecycleStatus != "" && task.LifecycleStatus != filter.LifecycleStatus {
				continue
			}
			tasks = append(tasks, task)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(tasks, func(i, j int) bool {
		if filter.SessionID != "" {
			return tasks[i].CreatedAt.Before(tasks[j].CreatedAt)
		}
		return tasks[i].UpdatedAt.After(tasks[j].UpdatedAt)
	})
	if filter.Limit > 0 && len(tasks) > int(filter.Limit) {
		tasks = tasks[:int(filter.Limit)]
	}
	return tasks, nil
}

func getTask(txn *badger.Txn, taskID string) (Task, error) {
	item, err := txn.Get([]byte(taskKey(taskID)))
	if errors.Is(err, badger.ErrKeyNotFound) {
		return Task{}, ErrNotFound
	}
	if err != nil {
		return Task{}, err
	}
	var task Task
	err = item.Value(func(value []byte) error {
		return json.Unmarshal(value, &task)
	})
	return task, err
}

func listSubtasks(txn *badger.Txn, taskID string) ([]Subtask, error) {
	opts := badger.DefaultIteratorOptions
	opts.PrefetchValues = true
	it := txn.NewIterator(opts)
	defer it.Close()
	prefix := []byte(subtaskPrefix(taskID))
	var subtasks []Subtask
	for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
		item := it.Item()
		var subtask Subtask
		if err := item.Value(func(value []byte) error {
			return json.Unmarshal(value, &subtask)
		}); err != nil {
			return nil, err
		}
		subtasks = append(subtasks, subtask)
	}
	sort.Slice(subtasks, func(i, j int) bool {
		return subtasks[i].Sequence < subtasks[j].Sequence
	})
	return subtasks, nil
}

func setJSON(txn *badger.Txn, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return txn.Set([]byte(key), encoded)
}

func taskKey(taskID string) string {
	return taskKeyPrefix + strings.TrimSpace(taskID)
}

func subtaskPrefix(taskID string) string {
	return subtaskKeyPrefix + strings.TrimSpace(taskID) + "/"
}

func subtaskKey(taskID string, sequence uint32, subtaskID string) string {
	return fmt.Sprintf("%s%010d/%s", subtaskPrefix(taskID), sequence, strings.TrimSpace(subtaskID))
}

func deriveTitle(prompt string) string {
	trimmed := strings.TrimSpace(prompt)
	if len(trimmed) <= 80 {
		return trimmed
	}
	return strings.TrimSpace(trimmed[:79]) + "..."
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
