package core

import "time"

type HostState string

const (
	HostStateHealthy     HostState = "healthy"
	HostStateDegraded    HostState = "degraded"
	HostStateUnavailable HostState = "unavailable"
)

type InstallSource string

const (
	InstallSourceDirect          InstallSource = "direct"
	InstallSourceUnknown         InstallSource = "unknown"
	InstallSourceHomebrewFormula InstallSource = "homebrew_formula"
	InstallSourceHomebrewCask    InstallSource = "homebrew_cask"
	InstallSourceNPM             InstallSource = "npm"
	InstallSourceAPT             InstallSource = "apt"
	InstallSourceDNF             InstallSource = "dnf"
	InstallSourceWinget          InstallSource = "winget"
	InstallSourceNix             InstallSource = "nix"
	InstallSourceMacPorts        InstallSource = "macports"
	InstallSourceSnap            InstallSource = "snap"
	InstallSourceFlatpak         InstallSource = "flatpak"
)

type UpdatePolicy string

const (
	UpdatePolicySelfManaged    UpdatePolicy = "self_managed"
	UpdatePolicyPackageManaged UpdatePolicy = "package_managed"
	UpdatePolicyStoreManaged   UpdatePolicy = "store_managed"
)

type UpdateState string

const (
	UpdateStateIdle                  UpdateState = "idle"
	UpdateStateChecking              UpdateState = "checking"
	UpdateStateAvailable             UpdateState = "available"
	UpdateStateDownloading           UpdateState = "downloading"
	UpdateStateVerifying             UpdateState = "verifying"
	UpdateStatePreflightRunning      UpdateState = "preflight_running"
	UpdateStateReadyToApply          UpdateState = "ready_to_apply"
	UpdateStateReexecing             UpdateState = "reexecing"
	UpdateStateFailedPreExec         UpdateState = "failed_pre_exec"
	UpdateStateFailedPostExecUnknown UpdateState = "failed_post_exec_unknown"
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

type SessionTranscriptAttachmentKind string

const (
	SessionTranscriptAttachmentKindImage SessionTranscriptAttachmentKind = "image"
	SessionTranscriptAttachmentKindFile  SessionTranscriptAttachmentKind = "file"
)

type SessionTranscriptAttachment struct {
	ID          string
	Kind        SessionTranscriptAttachmentKind
	Label       string
	Path        string
	URL         string
	ContentType string
}

type SessionTranscriptCommandActionKind string

const (
	SessionTranscriptCommandActionKindRead      SessionTranscriptCommandActionKind = "read"
	SessionTranscriptCommandActionKindListFiles SessionTranscriptCommandActionKind = "list_files"
	SessionTranscriptCommandActionKindSearch    SessionTranscriptCommandActionKind = "search"
	SessionTranscriptCommandActionKindUnknown   SessionTranscriptCommandActionKind = "unknown"
)

type SessionTranscriptCommandAction struct {
	Kind    SessionTranscriptCommandActionKind
	Command string
	Name    string
	Path    string
	Query   string
}

type SessionTranscriptItem struct {
	ID             string
	OrderKey       string
	Kind           SessionTranscriptItemKind
	Title          string
	Body           string
	Status         string
	DisplayBody    string
	Attachments    []SessionTranscriptAttachment
	CommandActions []SessionTranscriptCommandAction
}

type Backend struct {
	Key       string
	Available bool
	Version   string
	Reason    string
}

type AgentAccountRateLimits struct {
	PlanType string
	Windows  []AgentRateLimitWindow
}

type AgentRateLimitWindow struct {
	Label              string
	UsedPercent        uint32
	WindowDurationMins uint32
	ResetsAt           time.Time
}

const BackendKeyCodex = "codex"

type ModelReasoningEffort struct {
	ReasoningEffort string
	Description     string
}

type AgentModel struct {
	ID                        string
	Model                     string
	DisplayName               string
	Description               string
	IsDefault                 bool
	DefaultReasoningEffort    string
	SupportedReasoningEfforts []ModelReasoningEffort
	InputModalities           []string
}

type Skill struct {
	Name        string
	Reference   string
	Description string
	Source      string
	Path        string
}

type MCPServer struct {
	Name                string
	Source              string
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

type AvailableUpdate struct {
	Version              string
	NotesURL             string
	PublishedAt          time.Time
	MinUpgradableVersion string
	ArtifactURL          string
	SHA256               string
	SizeBytes            int64
}

type UpdateStatus struct {
	CurrentVersion     string
	CurrentCommit      string
	Channel            string
	InstallSource      InstallSource
	UpdatePolicy       UpdatePolicy
	State              UpdateState
	UpdateAvailable    bool
	AvailableUpdate    *AvailableUpdate
	TargetVersion      string
	UpgradeCommandHint string
	FailureReason      string
	LastCheckedAt      time.Time
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

type SessionContextWindowUsage struct {
	UsedTokens  uint64
	TotalTokens uint64
	LastTokens  uint64
}

type Session struct {
	ID                       string
	ProjectID                string
	BackendKey               string
	Title                    string
	BackendThreadID          string
	PendingApprovalID        string
	ActiveTurnID             string
	Status                   SessionState
	Summary                  string
	AttentionRequired        bool
	AttentionReason          string
	LastInputHint            string
	PreferredModel           string
	PreferredReasoningEffort string
	PreferredCodexFastMode   bool
	ContextWindowUsage       *SessionContextWindowUsage
	UpdatedAt                time.Time
	Artifacts                []Artifact
	TranscriptItems          []SessionTranscriptItem
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
	EventConfigChanged           EventKind = "config.changed"
	EventProjectsChanged         EventKind = "projects.changed"
	EventSessionsChanged         EventKind = "sessions.changed"
	EventSessionChanged          EventKind = "session.changed"
	EventSessionArtifactsChanged EventKind = "session.artifacts.changed"
	EventGitChanged              EventKind = "git.changed"
	EventTasksChanged            EventKind = "tasks.changed"
	EventTaskChanged             EventKind = "task.changed"
	EventTaskAttentionRequired   EventKind = "task.attention.required"
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
	TaskID    string
	Summary   string
	LivePatch *SessionLivePatch
}

type EventSink interface {
	Publish(Event)
}

type UpdateService interface {
	GetStatus() UpdateStatus
	Check(force bool) (UpdateStatus, error)
	Apply() (UpdateStatus, error)
}

type WorkspaceService interface {
	GetHostStatus() HostSnapshot
	ListBackends() []Backend
	ListSkills() ([]Skill, error)
	GetSkill(path string) (Skill, error)
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
	SessionID       string
	ProjectID       string
	BackendKey      string
	Title           string
	Prompt          string
	Model           string
	ReasoningEffort string
	CodexFastMode   bool
	Attachments     []SessionInputAttachment
}

type SessionInputAttachment struct {
	Label       string
	URL         string
	ContentType string
}

type SessionInputMode string

const (
	SessionInputModeGuide SessionInputMode = "guide"
	SessionInputModeQueue SessionInputMode = "queue"
)

type SessionTurnOptions struct {
	Model           string
	ReasoningEffort string
	CodexFastMode   bool
	Attachments     []SessionInputAttachment
	InputMode       SessionInputMode
}

type SessionQueueItem struct {
	ID              string
	SessionID       string
	Input           string
	Preview         string
	Position        uint32
	Model           string
	ReasoningEffort string
	CodexFastMode   bool
	Attachments     []SessionInputAttachment
	CreatedAt       time.Time
}

type SessionRollbackTarget struct {
	TranscriptItemID string
	OrderKey         string
}

type SessionRollbackResult struct {
	Session          Session
	DroppedTurnCount uint32
}

type SessionPatch struct {
	BackendKey               *string
	BackendThreadID          *string
	PendingApprovalID        *string
	ActiveTurnID             *string
	Status                   *SessionState
	Summary                  *string
	AttentionRequired        *bool
	AttentionReason          *string
	LastInputHint            *string
	PreferredModel           *string
	PreferredReasoningEffort *string
	PreferredCodexFastMode   *bool
	ContextWindowUsage       *SessionContextWindowUsage
	Artifacts                *[]Artifact
	TranscriptItems          *[]SessionTranscriptItem
	AppendTranscriptItems    *[]SessionTranscriptItem
}
