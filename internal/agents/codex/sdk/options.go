package sdk

type ApprovalPolicy string

const (
	ApprovalPolicyNever     ApprovalPolicy = "never"
	ApprovalPolicyOnRequest ApprovalPolicy = "on-request"
	ApprovalPolicyOnFailure ApprovalPolicy = "on-failure"
	ApprovalPolicyUntrusted ApprovalPolicy = "untrusted"
)

type SandboxMode string

const (
	SandboxModeReadOnly         SandboxMode = "read-only"
	SandboxModeWorkspaceWrite   SandboxMode = "workspace-write"
	SandboxModeDangerFullAccess SandboxMode = "danger-full-access"
)

type ModelReasoningEffort string

const (
	ModelReasoningEffortMinimal ModelReasoningEffort = "minimal"
	ModelReasoningEffortLow     ModelReasoningEffort = "low"
	ModelReasoningEffortMedium  ModelReasoningEffort = "medium"
	ModelReasoningEffortHigh    ModelReasoningEffort = "high"
	ModelReasoningEffortXHigh   ModelReasoningEffort = "xhigh"
)

type WebSearchMode string

const (
	WebSearchModeDisabled WebSearchMode = "disabled"
	WebSearchModeCached   WebSearchMode = "cached"
	WebSearchModeLive     WebSearchMode = "live"
)

type ClientOptions struct {
	CodexPath string
	BaseURL   string
	APIKey    string
	Config    map[string]any
	Env       map[string]string
}

type ThreadOptions struct {
	Model                 string
	SandboxMode           SandboxMode
	WorkingDirectory      string
	AdditionalDirectories []string
	SkipGitRepoCheck      bool
	ModelReasoningEffort  ModelReasoningEffort
	NetworkAccessEnabled  *bool
	WebSearchMode         WebSearchMode
	WebSearchEnabled      *bool
	ApprovalPolicy        ApprovalPolicy
}

type RunOptions struct {
	OutputSchema map[string]any
}
