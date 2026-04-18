package core

import "time"

type HostState string

const (
	HostStateHealthy     HostState = "healthy"
	HostStateDegraded    HostState = "degraded"
	HostStateUnavailable HostState = "unavailable"
)

type SessionState string

const (
	SessionStatePending         SessionState = "pending"
	SessionStateRunning         SessionState = "running"
	SessionStateWaitingInput    SessionState = "waiting_input"
	SessionStateWaitingApproval SessionState = "waiting_approval"
	SessionStateCompleted       SessionState = "completed"
	SessionStateFailed          SessionState = "failed"
	SessionStateDegraded        SessionState = "degraded"
)

type ApprovalDecision string

const (
	ApprovalDecisionApprove ApprovalDecision = "approve"
	ApprovalDecisionReject  ApprovalDecision = "reject"
)

type ArtifactKind string

const (
	ArtifactKindSummary      ArtifactKind = "summary"
	ArtifactKindChangedFiles ArtifactKind = "changed_files"
	ArtifactKindTestResult   ArtifactKind = "test_result"
	ArtifactKindScreenshot   ArtifactKind = "screenshot"
	ArtifactKindLog          ArtifactKind = "log"
	ArtifactKindOther        ArtifactKind = "other"
)

type SessionTranscriptItemKind string

const (
	SessionTranscriptItemKindUserMessage      SessionTranscriptItemKind = "user_message"
	SessionTranscriptItemKindAgentMessage     SessionTranscriptItemKind = "agent_message"
	SessionTranscriptItemKindReasoning        SessionTranscriptItemKind = "reasoning"
	SessionTranscriptItemKindToolCall         SessionTranscriptItemKind = "tool_call"
	SessionTranscriptItemKindCommandExecution SessionTranscriptItemKind = "command_execution"
	SessionTranscriptItemKindFileChange       SessionTranscriptItemKind = "file_change"
)

type SessionTranscriptItem struct {
	ID     string
	Kind   SessionTranscriptItemKind
	Title  string
	Body   string
	Status string
}

type Backend struct {
	Key       string
	Available bool
	Version   string
	Reason    string
}

type Skill struct {
	Name        string
	Reference   string
	Description string
	Source      string
	Path        string
}

type MCPServer struct {
	Name              string
	Source            string
	ConfigurationStatus string
}

type DirectoryRoot struct {
	Label string
	Path  string
	Kind  string
}

type DirectoryEntry struct {
	Name        string
	Path        string
	IsDirectory bool
	IsRepo      bool
	HasChildren bool
	IsAllowed   bool
}

type DirectoryListing struct {
	CurrentPath string
	ParentPath  string
	Entries     []DirectoryEntry
}

type PathMetadata struct {
	Path                string
	CanonicalPath       string
	Basename            string
	IsDirectory         bool
	IsRepo              bool
	IsAllowed           bool
	ChildDirectoryCount int
	ChildFileCount      int
	ModifiedAt          time.Time
}

type SessionFile struct {
	SessionID     string
	ProjectID     string
	Available     bool
	RequestedPath string
	CanonicalPath string
	DisplayPath   string
	Content       string
	Reason        string
	Truncated     bool
	IsBinary      bool
	LineCount     int
	InitialLine   int
	InitialColumn int
}

type SessionReviewFile struct {
	Path         string
	Kind         string
	MovePath     string
	Additions    int
	Deletions    int
	Diff         string
	DisplayLabel string
}

type SessionReview struct {
	SessionID             string
	ProjectID             string
	Available             bool
	TurnID                string
	Reason                string
	FullPatch             string
	Files                 []SessionReviewFile
	GeneratedAt           time.Time
	PendingTurnInProgress bool
}

type HostSnapshot struct {
	HostID       string
	Status       HostState
	Backends     []Backend
	ProjectCount int
	SessionCount int
	UpdatedAt    time.Time
}

type Project struct {
	ID             string
	Name           string
	RootPath       string
	DefaultBackend string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Artifact struct {
	ID          string
	Kind        ArtifactKind
	Label       string
	CreatedAt   time.Time
	DownloadURL string
	ContentType string
}

type Session struct {
	ID                string
	ProjectID         string
	BackendKey        string
	Title             string
	BackendThreadID   string
	PendingApprovalID string
	ActiveTurnID      string
	Status            SessionState
	Summary           string
	AttentionRequired bool
	AttentionReason   string
	LastInputHint     string
	UpdatedAt         time.Time
	Artifacts         []Artifact
	TranscriptItems   []SessionTranscriptItem
}

type SessionMeta struct {
	Session            Session
	Project            Project
	HasMoreBefore      bool
	LatestPageSizeHint uint32
}

type ListSessionTranscriptInput struct {
	SessionID    string
	BeforeCursor string
	Limit        uint32
}

type GetSessionFileInput struct {
	SessionID string
	Path      string
	Line      uint32
	Column    uint32
}

type SessionTranscriptPage struct {
	SessionID         string
	ProjectID         string
	Items             []SessionTranscriptItem
	NextBeforeCursor  string
	HasMoreBefore     bool
	SnapshotUpdatedAt time.Time
}

type EventKind string

const (
	EventHostChanged             EventKind = "host.changed"
	EventProjectsChanged         EventKind = "projects.changed"
	EventSessionsChanged         EventKind = "sessions.changed"
	EventSessionChanged          EventKind = "session.changed"
	EventSessionArtifactsChanged EventKind = "session.artifacts.changed"
)

type SessionLivePatchKind string

const (
	SessionLivePatchKindUnspecified       SessionLivePatchKind = ""
	SessionLivePatchKindStatus            SessionLivePatchKind = "status"
	SessionLivePatchKindDraftDelta        SessionLivePatchKind = "draft_delta"
	SessionLivePatchKindMessageFinalized  SessionLivePatchKind = "message_finalized"
	SessionLivePatchKindReconcileRequired SessionLivePatchKind = "reconcile_required"
)

type SessionLivePatch struct {
	Kind            SessionLivePatchKind
	ActiveTurnID    string
	DraftItemID     string
	DraftDelta      string
	FinalItem       *SessionTranscriptItem
	Status          SessionState
	Summary         string
	RequiresRefetch bool
}

type Event struct {
	Kind      EventKind
	ProjectID string
	SessionID string
	Summary   string
	LivePatch *SessionLivePatch
}

type EventSink interface {
	Publish(Event)
}

type WorkspaceService interface {
	GetHostStatus() HostSnapshot
	ListBackends() []Backend
	ListSkills() ([]Skill, error)
	ListMCPServers() ([]MCPServer, error)
	ListDirectoryRoots() ([]DirectoryRoot, error)
	ListDirectory(path string) (DirectoryListing, error)
	GetPathMetadata(path string) (PathMetadata, error)
	ListRecentRepos(limit uint32) ([]PathMetadata, error)
	ListProjects() []Project
	CreateProject(CreateProjectInput) (Project, error)
	GetProject(projectID string) (Project, bool)
	ListSessions(ListSessionsInput) []Session
	GetSession(sessionID string) (Session, bool)
	CreateSession(CreateSessionInput) (Session, error)
	SendSessionInput(sessionID string, input string) (Session, error)
	UpdateSession(sessionID string, patch SessionPatch) (Session, error)
	ListSessionArtifacts(sessionID string) ([]Artifact, error)
}

type CreateProjectInput struct {
	Name           string
	RootPath       string
	DefaultBackend string
}

type ListSessionsInput struct {
	ProjectID string
	Limit     uint32
}

type CreateSessionInput struct {
	ProjectID  string
	BackendKey string
	Title      string
	Prompt     string
}

type SessionPatch struct {
	BackendKey            *string
	BackendThreadID       *string
	PendingApprovalID     *string
	ActiveTurnID          *string
	Status                *SessionState
	Summary               *string
	AttentionRequired     *bool
	AttentionReason       *string
	LastInputHint         *string
	Artifacts             *[]Artifact
	TranscriptItems       *[]SessionTranscriptItem
	AppendTranscriptItems *[]SessionTranscriptItem
}
