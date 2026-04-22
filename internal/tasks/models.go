package tasks

import "time"

type LifecycleStatus string

const (
	LifecycleActive   LifecycleStatus = "active"
	LifecycleWaiting  LifecycleStatus = "waiting"
	LifecyclePaused   LifecycleStatus = "paused"
	LifecycleBlocked  LifecycleStatus = "blocked"
	LifecycleFailed   LifecycleStatus = "failed"
	LifecycleCanceled LifecycleStatus = "canceled"
	LifecycleDone     LifecycleStatus = "done"
)

type Stage string

const (
	StagePlan    Stage = "plan"
	StageCode    Stage = "code"
	StageReview  Stage = "review"
	StageCommit  Stage = "commit"
	StageSubtask Stage = "subtask"
)

type AttentionKind string

const (
	AttentionNone                AttentionKind = ""
	AttentionPlanApproval        AttentionKind = "plan_approval"
	AttentionDevelopmentApproval AttentionKind = "development_approval"
	AttentionBlocked             AttentionKind = "blocked"
	AttentionCommitBlocked       AttentionKind = "commit_blocked"
	AttentionStaleGate           AttentionKind = "stale_gate"
)

type CommitStatus string

const (
	CommitNotReady      CommitStatus = "not_ready"
	CommitReadyToCommit CommitStatus = "ready_to_commit"
	CommitBlocked       CommitStatus = "blocked"
	CommitCommitted     CommitStatus = "committed"
)

type SubtaskStatus string

const (
	SubtaskOpen     SubtaskStatus = "open"
	SubtaskRunning  SubtaskStatus = "running"
	SubtaskDone     SubtaskStatus = "done"
	SubtaskBlocked  SubtaskStatus = "blocked"
	SubtaskCanceled SubtaskStatus = "canceled"
)

type GateStatus string

const (
	GateOpen              GateStatus = "open"
	GateApproved          GateStatus = "approved"
	GateRevisionRequested GateStatus = "revision_requested"
	GateCanceled          GateStatus = "canceled"
	GateStale             GateStatus = "stale"
)

type Diagnostic struct {
	Code         string `json:"code"`
	Severity     string `json:"severity"`
	Source       string `json:"source"`
	Message      string `json:"message"`
	Cause        string `json:"cause"`
	UserAction   string `json:"user_action"`
	Retriable    bool   `json:"retriable"`
	EvidencePath string `json:"evidence_path"`
	SessionID    string `json:"session_id"`
	StageRunID   string `json:"stage_run_id"`
	DocsURL      string `json:"docs_url"`
}

type Task struct {
	ID                    string          `json:"id"`
	ProjectID             string          `json:"project_id"`
	Title                 string          `json:"title"`
	Prompt                string          `json:"prompt"`
	Priority              uint32          `json:"priority"`
	SessionID             string          `json:"session_id"`
	LifecycleStatus       LifecycleStatus `json:"lifecycle_status"`
	CurrentStage          Stage           `json:"current_stage"`
	AttentionKind         AttentionKind   `json:"attention_kind"`
	CommitStatus          CommitStatus    `json:"commit_status"`
	SubtaskCount          uint32          `json:"subtask_count"`
	CompletedSubtaskCount uint32          `json:"completed_subtask_count"`
	Diagnostics           []Diagnostic    `json:"diagnostics"`
	CreatedAt             time.Time       `json:"created_at"`
	UpdatedAt             time.Time       `json:"updated_at"`
	CompletedAt           *time.Time      `json:"completed_at,omitempty"`
}

type Subtask struct {
	ID            string        `json:"id"`
	TaskID        string        `json:"task_id"`
	Sequence      uint32        `json:"sequence"`
	Title         string        `json:"title"`
	Prompt        string        `json:"prompt"`
	Status        SubtaskStatus `json:"status"`
	SessionTurnID string        `json:"session_turn_id"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
	CompletedAt   *time.Time    `json:"completed_at,omitempty"`
}

type Gate struct {
	ID                  string     `json:"id"`
	TaskID              string     `json:"task_id"`
	StageRunID          string     `json:"stage_run_id"`
	Stage               Stage      `json:"stage"`
	Status              GateStatus `json:"status"`
	Revision            uint64     `json:"revision"`
	Question            string     `json:"question"`
	RecommendedDecision string     `json:"recommended_decision"`
	Decision            string     `json:"decision"`
	Comment             string     `json:"comment"`
	CreatedAt           time.Time  `json:"created_at"`
	DecidedAt           *time.Time `json:"decided_at,omitempty"`
}

type Snapshot struct {
	Task        Task
	Subtasks    []Subtask
	CurrentGate *Gate
}

type CreateTaskInput struct {
	ProjectID       string
	Title           string
	Prompt          string
	Priority        uint32
	InitialSubtasks []string
	IdempotencyKey  string
}

type CreateSubtaskInput struct {
	TaskID         string
	Title          string
	Prompt         string
	IdempotencyKey string
}

type ListFilter struct {
	ProjectID       string
	AttentionKind   AttentionKind
	LifecycleStatus LifecycleStatus
	Limit           uint32
}
