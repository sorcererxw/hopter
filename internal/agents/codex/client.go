package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	codexsdk "github.com/pmenglund/codex-sdk-go"
	"github.com/pmenglund/codex-sdk-go/protocol"
	"github.com/pmenglund/codex-sdk-go/rpc"

	"github.com/sorcererxw/hopter/internal/core"
)

type Notification struct {
	Method string
	Params json.RawMessage
}

type ServerRequest struct {
	ID     json.RawMessage
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type Client struct {
	ctx context.Context
	sdk *codexsdk.Codex
	rpc *rpc.Client
	sub *rpc.NotificationIterator

	onNotification  func(Notification)
	onServerRequest func(ServerRequest)
	onTrace         func(TraceEntry)
	onExit          func()

	approvalMu sync.Mutex
	nextID     int64
	approvals  map[string]chan approvalResponse

	wireMu       sync.Mutex
	wireRequests map[string][]wireServerRequest
}

type approvalResponse struct {
	result any
	err    error
}

type wireServerRequest struct {
	id     json.RawMessage
	params json.RawMessage
}

type StartThreadResult struct {
	Thread struct {
		ID   string  `json:"id"`
		Path *string `json:"path"`
		Cwd  string  `json:"cwd"`
	} `json:"thread"`
}

type ThreadStatus struct {
	Type        string   `json:"type"`
	ActiveFlags []string `json:"activeFlags"`
}

type ThreadRecord struct {
	ID            string       `json:"id"`
	ForkedFromID  *string      `json:"forkedFromId"`
	Preview       string       `json:"preview"`
	Ephemeral     bool         `json:"ephemeral"`
	ModelProvider string       `json:"modelProvider"`
	CreatedAt     int64        `json:"createdAt"`
	UpdatedAt     int64        `json:"updatedAt"`
	Status        ThreadStatus `json:"status"`
	Path          *string      `json:"path"`
	Cwd           string       `json:"cwd"`
	CLIVersion    string       `json:"cliVersion"`
	Name          *string      `json:"name"`
}

type ThreadListResult struct {
	Data       []ThreadRecord `json:"data"`
	NextCursor *string        `json:"nextCursor"`
}

type ThreadTurnsListParams struct {
	ThreadID      string  `json:"threadId"`
	Cursor        *string `json:"cursor,omitempty"`
	Limit         *int    `json:"limit,omitempty"`
	SortDirection string  `json:"sortDirection,omitempty"`
}

type ThreadTurnsListResult struct {
	Data            []ReadThreadTurn `json:"data"`
	NextCursor      *string          `json:"nextCursor,omitempty"`
	BackwardsCursor *string          `json:"backwardsCursor,omitempty"`
}

type ModelReasoningEffortRecord struct {
	ReasoningEffort string `json:"reasoningEffort"`
	Description     string `json:"description"`
}

type ModelRecord struct {
	ID                        string                       `json:"id"`
	Model                     string                       `json:"model"`
	DisplayName               string                       `json:"displayName"`
	Description               string                       `json:"description"`
	Hidden                    bool                         `json:"hidden"`
	IsDefault                 bool                         `json:"isDefault"`
	DefaultReasoningEffort    string                       `json:"defaultReasoningEffort"`
	SupportedReasoningEfforts []ModelReasoningEffortRecord `json:"supportedReasoningEfforts"`
	InputModalities           []string                     `json:"inputModalities"`
}

type ModelListResult struct {
	Data       []ModelRecord `json:"data"`
	NextCursor *string       `json:"nextCursor"`
}

type StartTurnResult struct {
	Turn struct {
		ID string `json:"id"`
	} `json:"turn"`
}

type ReadThreadContentPart struct {
	Type     string `json:"type"`
	Text     string `json:"text"`
	Path     string `json:"path"`
	ImageURL string `json:"image_url"`
	Name     string `json:"name"`
	MimeType string `json:"mime_type"`
}

type ReadThreadFileChange struct {
	Path string `json:"path"`
	Diff string `json:"diff"`
	Kind struct {
		Type     string  `json:"type"`
		MovePath *string `json:"move_path"`
	} `json:"kind"`
}

type ReadThreadCommandAction struct {
	Type    string `json:"type"`
	Command string `json:"command"`
	Cmd     string `json:"cmd"`
	Name    string `json:"name"`
	Path    string `json:"path"`
	Query   string `json:"query"`
}

type ReadThreadError struct {
	Message string `json:"message"`
}

type ReadThreadItem struct {
	Type             string                    `json:"type"`
	ID               string                    `json:"id"`
	Text             string                    `json:"text"`
	Phase            string                    `json:"phase"`
	Status           string                    `json:"status"`
	Server           string                    `json:"server"`
	Tool             string                    `json:"tool"`
	Command          string                    `json:"command"`
	CommandActions   []ReadThreadCommandAction `json:"commandActions"`
	ParsedCmd        []ReadThreadCommandAction `json:"parsed_cmd"`
	ParsedCmdCamel   []ReadThreadCommandAction `json:"parsedCmd"`
	AggregatedOutput string                    `json:"aggregatedOutput"`
	Source           string                    `json:"source"`
	ProcessID        string                    `json:"processId"`
	ExitCode         *int                      `json:"exitCode"`
	DurationMs       int64                     `json:"durationMs"`
	Arguments        json.RawMessage           `json:"arguments"`
	Result           json.RawMessage           `json:"result"`
	Error            *ReadThreadError          `json:"error"`
	Content          json.RawMessage           `json:"content"`
	Summary          json.RawMessage           `json:"summary"`
	Changes          []ReadThreadFileChange    `json:"changes"`
}

type ReadThreadTurn struct {
	ID     string           `json:"id"`
	Status string           `json:"status"`
	Items  []ReadThreadItem `json:"items"`
}

type readAccountRateLimitsResponse struct {
	RateLimits          accountRateLimits            `json:"rateLimits"`
	RateLimitsByLimitID map[string]accountRateLimits `json:"rateLimitsByLimitId"`
}

type accountRateLimits struct {
	LimitID   *string                   `json:"limitId"`
	Credits   *protocol.CreditsSnapshot `json:"credits"`
	LimitName *string                   `json:"limitName"`
	PlanType  interface{}               `json:"planType"`
	Primary   *protocol.RateLimitWindow `json:"primary"`
	Secondary *protocol.RateLimitWindow `json:"secondary"`
}

type ReadThreadResult struct {
	Thread struct {
		ID            string                     `json:"id"`
		ForkedFromID  *string                    `json:"forkedFromId"`
		Preview       string                     `json:"preview"`
		Ephemeral     bool                       `json:"ephemeral"`
		ModelProvider string                     `json:"modelProvider"`
		CreatedAt     int64                      `json:"createdAt"`
		UpdatedAt     int64                      `json:"updatedAt"`
		Status        ThreadStatus               `json:"status"`
		Path          *string                    `json:"path"`
		Cwd           string                     `json:"cwd"`
		CLIVersion    string                     `json:"cliVersion"`
		Name          *string                    `json:"name"`
		TokenUsage    *protocol.ThreadTokenUsage `json:"tokenUsage,omitempty"`
		Turns         []ReadThreadTurn           `json:"turns"`
	} `json:"thread"`
}

type ResumeThreadResult struct {
	Thread ThreadRecord `json:"thread"`
	Cwd    string       `json:"cwd"`
}

type RollbackThreadResult struct {
	Thread struct {
		ID            string                     `json:"id"`
		ForkedFromID  *string                    `json:"forkedFromId"`
		Preview       string                     `json:"preview"`
		Ephemeral     bool                       `json:"ephemeral"`
		ModelProvider string                     `json:"modelProvider"`
		CreatedAt     int64                      `json:"createdAt"`
		UpdatedAt     int64                      `json:"updatedAt"`
		Status        ThreadStatus               `json:"status"`
		Path          *string                    `json:"path"`
		Cwd           string                     `json:"cwd"`
		CLIVersion    string                     `json:"cliVersion"`
		Name          *string                    `json:"name"`
		TokenUsage    *protocol.ThreadTokenUsage `json:"tokenUsage,omitempty"`
		Turns         []ReadThreadTurn           `json:"turns"`
	} `json:"thread"`
}

func Start(
	ctx context.Context,
	cwd string,
	onNotification func(Notification),
	onServerRequest func(ServerRequest),
	onTrace func(TraceEntry),
	onExit func(),
) (*Client, error) {
	client := &Client{
		ctx:             ctx,
		onNotification:  onNotification,
		onServerRequest: onServerRequest,
		onTrace:         onTrace,
		onExit:          onExit,
		approvals:       make(map[string]chan approvalResponse),
		wireRequests:    make(map[string][]wireServerRequest),
	}

	releaseStart, err := enterAppServerStartQueue(ctx)
	if err != nil {
		return nil, err
	}
	defer releaseStart()

	transport, err := rpc.SpawnStdio(context.WithoutCancel(ctx), "codex", []string{"app-server"}, io.Discard)
	if err != nil {
		return nil, fmt.Errorf("start codex app-server: %w", err)
	}

	title := "Hopter"
	sdk, err := codexsdk.New(ctx, codexsdk.Options{
		Transport: &tracedTransport{
			inner:           transport,
			onTrace:         onTrace,
			onServerRequest: client.recordWireServerRequest,
		},
		ClientInfo: protocol.ClientInfo{
			Name:    "hopter-go",
			Title:   &title,
			Version: "0.1.0",
		},
		ApprovalHandler: client,
	})
	if err != nil {
		_ = transport.Close()
		return nil, err
	}

	client.sdk = sdk
	client.rpc = sdk.Client()
	client.sub = client.rpc.SubscribeNotifications(128)
	go client.forwardNotifications()

	return client, nil
}

func (c *Client) Close() error {
	if c.sub != nil {
		c.sub.Close()
	}
	if c.sdk != nil {
		return c.sdk.Close()
	}
	return nil
}

func (c *Client) StartThread(cwd string, options core.SessionTurnOptions) (*StartThreadResult, error) {
	params := protocol.ThreadStartParams{
		ApprovalPolicy: codexsdk.ApprovalPolicyOnRequest,
		Cwd:            optionalString(cwd),
		Sandbox:        codexsdk.SandboxModeDangerFullAccess,
	}
	if model := strings.TrimSpace(options.Model); model != "" {
		params.Model = &model
	}
	applyServiceTier(&params.ServiceTier, options)

	var out StartThreadResult
	if err := c.call(protocolMethodThreadStart, params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListThreads(cwd string, limit uint32) (*ThreadListResult, error) {
	archived := false
	sortKey := protocol.ThreadSortKeyUpdatedAt
	params := protocol.ThreadListParams{
		Archived: &archived,
		SortKey:  sortKey,
		SourceKinds: []protocol.ThreadSourceKind{
			protocol.ThreadSourceKindCli,
			protocol.ThreadSourceKindExec,
			protocol.ThreadSourceKindVscode,
			protocol.ThreadSourceKindAppServer,
		},
	}
	if strings.TrimSpace(cwd) != "" {
		params.Cwd = optionalString(cwd)
	}
	if limit > 0 {
		limitInt := int(limit)
		params.Limit = &limitInt
	}

	var out ThreadListResult
	if err := c.call(protocolMethodThreadList, params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListModels(includeHidden bool) (*ModelListResult, error) {
	var out ModelListResult
	if err := c.call(protocolMethodModelList, protocol.ModelListParams{
		IncludeHidden: &includeHidden,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ReadAccountRateLimits() (string, error) {
	var out readAccountRateLimitsResponse
	if err := c.call(protocolMethodAccountRateLimitsRead, nil, &out); err != nil {
		return "", err
	}
	return accountRateLimitsResponseSummary(out), nil
}

func (c *Client) ReadAccountRateLimitStatus() (core.AgentAccountRateLimits, error) {
	var out readAccountRateLimitsResponse
	if err := c.call(protocolMethodAccountRateLimitsRead, nil, &out); err != nil {
		return core.AgentAccountRateLimits{}, err
	}
	return accountRateLimitsResponseStatus(out), nil
}

func (c *Client) ResumeThread(threadID, cwd string, options core.SessionTurnOptions) (*ResumeThreadResult, error) {
	params := protocol.ThreadResumeParams{
		ThreadID:       threadID,
		ApprovalPolicy: codexsdk.ApprovalPolicyOnRequest,
		Sandbox:        codexsdk.SandboxModeDangerFullAccess,
	}
	if strings.TrimSpace(cwd) != "" {
		params.Cwd = optionalString(cwd)
	}
	if model := strings.TrimSpace(options.Model); model != "" {
		params.Model = &model
	}
	applyServiceTier(&params.ServiceTier, options)

	var out ResumeThreadResult
	if err := c.call(protocolMethodThreadResume, params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) RollbackThread(threadID string, numTurns int) (*RollbackThreadResult, error) {
	params := protocol.ThreadRollbackParams{
		ThreadID: threadID,
		NumTurns: numTurns,
	}

	var out RollbackThreadResult
	if err := c.call(protocolMethodThreadRollback, params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) StartTurn(threadID string, text string, options core.SessionTurnOptions) (*StartTurnResult, error) {
	params := protocol.TurnStartParams{
		ThreadID:       threadID,
		ApprovalPolicy: codexsdk.ApprovalPolicyOnRequest,
		Input:          buildTurnStartInput(text, options.Attachments),
	}
	if model := strings.TrimSpace(options.Model); model != "" {
		params.Model = &model
	}
	if effort := strings.TrimSpace(options.ReasoningEffort); effort != "" {
		params.Effort = protocol.ReasoningEffort(effort)
	}
	applyServiceTier(&params.ServiceTier, options)

	var out StartTurnResult
	if err := c.call(protocolMethodTurnStart, params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func applyServiceTier(target *interface{}, options core.SessionTurnOptions) {
	if !options.CodexFastMode || target == nil {
		return
	}
	*target = protocol.ServiceTierFast
}

func (c *Client) SteerTurn(threadID, expectedTurnID, text string, options core.SessionTurnOptions) (*StartTurnResult, error) {
	params := protocol.TurnSteerParams{
		ThreadID:       threadID,
		ExpectedTurnID: expectedTurnID,
		Input:          buildTurnSteerInput(text, options.Attachments),
	}

	var out StartTurnResult
	if err := c.call(protocolMethodTurnSteer, params, &out); err != nil {
		return nil, err
	}
	if out.Turn.ID == "" {
		out.Turn.ID = expectedTurnID
	}
	return &out, nil
}

func buildTurnStartInput(text string, attachments []core.SessionInputAttachment) []protocol.TurnStartParamsInputElem {
	parts := buildCodexInput(text, attachments)
	input := make([]protocol.TurnStartParamsInputElem, 0, len(parts))
	for _, part := range parts {
		input = append(input, part)
	}
	return input
}

func buildTurnSteerInput(text string, attachments []core.SessionInputAttachment) []protocol.TurnSteerParamsInputElem {
	parts := buildCodexInput(text, attachments)
	input := make([]protocol.TurnSteerParamsInputElem, 0, len(parts))
	for _, part := range parts {
		input = append(input, part)
	}
	return input
}

func buildCodexInput(text string, attachments []core.SessionInputAttachment) []codexsdk.Input {
	input := make([]codexsdk.Input, 0, 1+len(attachments))
	if strings.TrimSpace(text) != "" {
		input = append(input, codexsdk.TextInput(text))
	}
	for _, attachment := range attachments {
		url := strings.TrimSpace(attachment.URL)
		if url == "" {
			continue
		}
		image := codexsdk.ImageInput(url)
		if label := strings.TrimSpace(attachment.Label); label != "" {
			image.Name = label
		}
		input = append(input, image)
	}
	return input
}

func (c *Client) InterruptTurn(threadID, turnID string) error {
	return c.call(protocolMethodTurnInterrupt, protocol.TurnInterruptParams{
		ThreadID: threadID,
		TurnID:   turnID,
	}, nil)
}

func (c *Client) ReadThread(threadID string) (*ReadThreadResult, error) {
	return c.readThread(threadID, true)
}

func (c *Client) ReadThreadMeta(threadID string) (*ReadThreadResult, error) {
	return c.readThread(threadID, false)
}

func (c *Client) ListThreadTurns(params ThreadTurnsListParams) (*ThreadTurnsListResult, error) {
	var out ThreadTurnsListResult
	if err := c.call(protocolMethodThreadTurnsList, params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func accountRateLimitsResponseSummary(response readAccountRateLimitsResponse) string {
	if len(response.RateLimitsByLimitID) == 0 {
		return accountRateLimitsSummary(response.RateLimits, false)
	}

	primaryID := strings.TrimSpace(pointerValue(response.RateLimits.LimitID))
	if primaryID == "" {
		primaryID = "codex"
	}
	parts := make([]string, 0, len(response.RateLimitsByLimitID))
	if primary, ok := response.RateLimitsByLimitID[primaryID]; ok {
		if summary := accountRateLimitsSummary(primary, false); summary != "" {
			parts = append(parts, summary)
		}
	}

	ids := make([]string, 0, len(response.RateLimitsByLimitID))
	for id := range response.RateLimitsByLimitID {
		if id != primaryID {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		bucket := response.RateLimitsByLimitID[id]
		if summary := accountRateLimitsSummary(bucket, true); summary != "" {
			parts = append(parts, summary)
		}
	}

	return strings.Join(parts, " · ")
}

func accountRateLimitsResponseStatus(response readAccountRateLimitsResponse) core.AgentAccountRateLimits {
	primaryID := strings.TrimSpace(pointerValue(response.RateLimits.LimitID))
	if primaryID == "" {
		primaryID = "codex"
	}

	status := core.AgentAccountRateLimits{
		PlanType: formatPlanType(response.RateLimits.PlanType),
	}
	if len(response.RateLimitsByLimitID) == 0 {
		status.Windows = accountRateLimitWindows(response.RateLimits, false)
		return status
	}

	if primary, ok := response.RateLimitsByLimitID[primaryID]; ok {
		if status.PlanType == "" {
			status.PlanType = formatPlanType(primary.PlanType)
		}
		status.Windows = append(status.Windows, accountRateLimitWindows(primary, false)...)
	}

	ids := make([]string, 0, len(response.RateLimitsByLimitID))
	for id := range response.RateLimitsByLimitID {
		if id != primaryID {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		status.Windows = append(status.Windows, accountRateLimitWindows(response.RateLimitsByLimitID[id], true)...)
	}
	return status
}

func accountRateLimitWindows(rateLimits accountRateLimits, includeName bool) []core.AgentRateLimitWindow {
	name := ""
	if includeName {
		name = strings.TrimSpace(pointerValue(rateLimits.LimitName))
		if name == "" {
			name = strings.TrimSpace(pointerValue(rateLimits.LimitID))
		}
	}
	windows := make([]core.AgentRateLimitWindow, 0, 2)
	if window := accountRateLimitWindow(rateLimits.Primary, name); window != nil {
		windows = append(windows, *window)
	}
	if window := accountRateLimitWindow(rateLimits.Secondary, name); window != nil {
		windows = append(windows, *window)
	}
	return windows
}

func accountRateLimitWindow(window *protocol.RateLimitWindow, label string) *core.AgentRateLimitWindow {
	if window == nil {
		return nil
	}
	if window.UsedPercent == 0 && window.ResetsAt == nil && window.WindowDurationMins == nil {
		return nil
	}
	result := core.AgentRateLimitWindow{
		Label:       label,
		UsedPercent: uint32(max(window.UsedPercent, 0)),
	}
	if window.WindowDurationMins != nil && *window.WindowDurationMins > 0 {
		result.WindowDurationMins = uint32(*window.WindowDurationMins)
	}
	if window.ResetsAt != nil && *window.ResetsAt > 0 {
		result.ResetsAt = time.Unix(int64(*window.ResetsAt), 0)
	}
	return &result
}

func accountRateLimitsSummary(rateLimits accountRateLimits, includeName bool) string {
	parts := make([]string, 0, 4)
	if plan := formatPlanType(rateLimits.PlanType); plan != "" && !includeName {
		parts = append(parts, plan)
	}

	if includeName {
		if name := strings.TrimSpace(pointerValue(rateLimits.LimitName)); name != "" {
			parts = append(parts, name)
		} else if id := strings.TrimSpace(pointerValue(rateLimits.LimitID)); id != "" {
			parts = append(parts, id)
		}
	}

	if rateLimits.Credits != nil {
		if rateLimits.Credits.Unlimited {
			parts = append(parts, "unlimited credits")
		}
		if rateLimits.Credits.HasCredits && rateLimits.Credits.Balance != nil {
			if balance := strings.TrimSpace(*rateLimits.Credits.Balance); balance != "" {
				parts = append(parts, "credits "+balance)
			}
		}
		if len(parts) == 0 && !rateLimits.Credits.HasCredits {
			parts = append(parts, "no credits")
		}
	}

	if rateLimits.Primary != nil && (rateLimits.Primary.UsedPercent > 0 || rateLimits.Primary.ResetsAt != nil || rateLimits.Primary.WindowDurationMins != nil) {
		parts = append(parts, formatRateLimitWindow(rateLimits.Primary))
	}
	if rateLimits.Secondary != nil && (rateLimits.Secondary.UsedPercent > 0 || rateLimits.Secondary.ResetsAt != nil || rateLimits.Secondary.WindowDurationMins != nil) {
		parts = append(parts, formatRateLimitWindow(rateLimits.Secondary))
	}

	if len(parts) == 0 && rateLimits.LimitName != nil {
		return strings.TrimSpace(*rateLimits.LimitName)
	}
	return strings.Join(parts, " · ")
}

func formatRateLimitWindow(window *protocol.RateLimitWindow) string {
	prefix := "window"
	if window != nil && window.WindowDurationMins != nil {
		prefix = formatWindowDuration(*window.WindowDurationMins)
	}
	return fmt.Sprintf("%s %d%% used", prefix, window.UsedPercent)
}

func formatWindowDuration(minutes int) string {
	if minutes <= 0 {
		return "window"
	}
	if minutes%10080 == 0 {
		weeks := minutes / 10080
		if weeks == 1 {
			return "7d"
		}
		return fmt.Sprintf("%dw", weeks)
	}
	if minutes%1440 == 0 {
		return fmt.Sprintf("%dd", minutes/1440)
	}
	if minutes%60 == 0 {
		return fmt.Sprintf("%dh", minutes/60)
	}
	return fmt.Sprintf("%dm", minutes)
}

func formatPlanType(planType interface{}) string {
	plan := strings.TrimSpace(fmt.Sprintf("%v", planType))
	if plan == "" || plan == "<nil>" {
		return ""
	}
	return strings.ToUpper(plan[:1]) + plan[1:]
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (c *Client) readThread(threadID string, includeTurns bool) (*ReadThreadResult, error) {
	var out ReadThreadResult
	if err := c.call(protocolMethodThreadRead, protocol.ThreadReadParams{
		ThreadID:     threadID,
		IncludeTurns: includeTurns,
	}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) call(method string, params any, result any) error {
	release, err := enterAppServerRequestQueue(c.ctx)
	if err != nil {
		return err
	}
	defer release()
	if c.rpc == nil {
		return errors.New("codex app-server client is not initialized")
	}
	return c.rpc.Call(c.ctx, method, params, result)
}

func (c *Client) forwardNotifications() {
	if c.sub == nil {
		return
	}
	defer func() {
		if c.onExit != nil {
			c.onExit()
		}
	}()

	for {
		note, err := c.sub.Next(c.ctx)
		if err != nil {
			return
		}
		if c.onNotification == nil {
			continue
		}
		params := append(json.RawMessage(nil), note.Raw...)
		if len(params) == 0 && note.Params != nil {
			if encoded, err := json.Marshal(note.Params); err == nil {
				params = encoded
			}
		}
		go c.onNotification(Notification{Method: note.Method, Params: params})
	}
}

func (c *Client) requestApproval(ctx context.Context, method string, params any) (any, error) {
	if c.onServerRequest == nil {
		return nil, fmt.Errorf("no handler configured for app-server request %q", method)
	}

	id := atomic.AddInt64(&c.nextID, 1)
	rawID, err := json.Marshal(id)
	if err != nil {
		return nil, err
	}
	rawParams, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	if wire, ok := c.takeWireServerRequest(method); ok {
		rawID = wire.id
		rawParams = wire.params
	}

	ch := make(chan approvalResponse, 1)
	key := string(rawID)
	c.approvalMu.Lock()
	c.approvals[key] = ch
	c.approvalMu.Unlock()
	defer func() {
		c.approvalMu.Lock()
		delete(c.approvals, key)
		c.approvalMu.Unlock()
	}()

	go c.onServerRequest(ServerRequest{
		ID:     append(json.RawMessage(nil), rawID...),
		Method: method,
		Params: append(json.RawMessage(nil), rawParams...),
	})

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case response := <-ch:
		return response.result, response.err
	}
}

func (c *Client) recordWireServerRequest(method string, id json.RawMessage, params json.RawMessage) {
	c.wireMu.Lock()
	defer c.wireMu.Unlock()
	c.wireRequests[method] = append(c.wireRequests[method], wireServerRequest{
		id:     append(json.RawMessage(nil), id...),
		params: append(json.RawMessage(nil), params...),
	})
}

func (c *Client) takeWireServerRequest(method string) (wireServerRequest, bool) {
	c.wireMu.Lock()
	defer c.wireMu.Unlock()
	queue := c.wireRequests[method]
	if len(queue) == 0 {
		return wireServerRequest{}, false
	}
	item := queue[0]
	if len(queue) == 1 {
		delete(c.wireRequests, method)
	} else {
		c.wireRequests[method] = queue[1:]
	}
	return item, true
}

func (c *Client) RespondToApproval(rawID json.RawMessage, result any) error {
	key := string(rawID)
	c.approvalMu.Lock()
	ch := c.approvals[key]
	c.approvalMu.Unlock()
	if ch == nil {
		return fmt.Errorf("app-server approval request %s not found", key)
	}
	ch <- approvalResponse{result: result}
	return nil
}

func (c *Client) AccountChatgptAuthTokensRefresh(context.Context, protocol.ChatgptAuthTokensRefreshParams) (*protocol.ChatgptAuthTokensRefreshResponse, error) {
	return nil, errors.New("chatgpt auth token refresh is not supported")
}

func (c *Client) ApplyPatchApproval(ctx context.Context, params protocol.ApplyPatchApprovalParams) (*protocol.ApplyPatchApprovalResponse, error) {
	return typedApprovalResponse[protocol.ApplyPatchApprovalResponse](c, ctx, protocolMethodApplyPatchApproval, params)
}

func (c *Client) ExecCommandApproval(ctx context.Context, params protocol.ExecCommandApprovalParams) (*protocol.ExecCommandApprovalResponse, error) {
	return typedApprovalResponse[protocol.ExecCommandApprovalResponse](c, ctx, protocolMethodExecCommandApproval, params)
}

func (c *Client) ItemCommandExecutionRequestApproval(ctx context.Context, params protocol.CommandExecutionRequestApprovalParams) (*protocol.CommandExecutionRequestApprovalResponse, error) {
	return typedApprovalResponse[protocol.CommandExecutionRequestApprovalResponse](c, ctx, protocolMethodItemCommandExecutionRequestApproval, params)
}

func (c *Client) ItemFileChangeRequestApproval(ctx context.Context, params protocol.FileChangeRequestApprovalParams) (*protocol.FileChangeRequestApprovalResponse, error) {
	return typedApprovalResponse[protocol.FileChangeRequestApprovalResponse](c, ctx, protocolMethodItemFileChangeRequestApproval, params)
}

func (c *Client) ItemPermissionsRequestApproval(ctx context.Context, params protocol.PermissionsRequestApprovalParams) (*protocol.PermissionsRequestApprovalResponse, error) {
	return typedApprovalResponse[protocol.PermissionsRequestApprovalResponse](c, ctx, protocolMethodItemPermissionsRequestApproval, params)
}

func (c *Client) ItemToolCall(context.Context, protocol.DynamicToolCallParams) (*protocol.DynamicToolCallResponse, error) {
	return nil, errors.New("dynamic tool calls are not supported")
}

func (c *Client) ItemToolRequestUserInput(context.Context, protocol.ToolRequestUserInputParams) (*protocol.ToolRequestUserInputResponse, error) {
	return nil, errors.New("tool user input requests are not supported")
}

func (c *Client) McpServerElicitationRequest(context.Context, protocol.McpServerElicitationRequestParams) (*protocol.McpServerElicitationRequestResponse, error) {
	return nil, errors.New("mcp server elicitation requests are not supported")
}

func typedApprovalResponse[T any](c *Client, ctx context.Context, method string, params any) (*T, error) {
	result, err := c.requestApproval(ctx, method, params)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var out T
	if err := json.Unmarshal(encoded, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type tracedTransport struct {
	inner           rpc.Transport
	onTrace         func(TraceEntry)
	onServerRequest func(method string, id json.RawMessage, params json.RawMessage)
}

func (t *tracedTransport) ReadLine() (string, error) {
	line, err := t.inner.ReadLine()
	if err == nil {
		t.traceLine("incoming", line)
	}
	return line, err
}

func (t *tracedTransport) WriteLine(line string) error {
	if err := t.inner.WriteLine(line); err != nil {
		return err
	}
	t.traceLine("outgoing", line)
	return nil
}

func (t *tracedTransport) Close() error {
	return t.inner.Close()
}

func (t *tracedTransport) traceLine(direction string, line string) {
	if t.onTrace == nil && t.onServerRequest == nil {
		return
	}
	payload := json.RawMessage(strings.TrimSpace(line))
	if len(payload) == 0 {
		return
	}

	var envelope struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return
	}

	entry := TraceEntry{
		Direction: direction,
		Payload:   append(json.RawMessage(nil), payload...),
	}
	switch {
	case envelope.Method != "" && len(envelope.ID) > 0:
		entry.Kind = "request"
		if direction == "incoming" {
			entry.Kind = "server_request"
			if t.onServerRequest != nil {
				var full struct {
					Params json.RawMessage `json:"params"`
				}
				_ = json.Unmarshal(payload, &full)
				t.onServerRequest(
					envelope.Method,
					append(json.RawMessage(nil), envelope.ID...),
					append(json.RawMessage(nil), full.Params...),
				)
			}
		}
		entry.Method = envelope.Method
		entry.ID = traceID(envelope.ID)
	case envelope.Method != "":
		entry.Kind = "notification"
		entry.Method = envelope.Method
	case len(envelope.Result) > 0 || len(envelope.Error) > 0:
		entry.Kind = "response"
		entry.ID = traceID(envelope.ID)
	default:
		return
	}
	if t.onTrace != nil {
		t.onTrace(entry)
	}
}

const (
	protocolMethodApplyPatchApproval                  = "applyPatchApproval"
	protocolMethodExecCommandApproval                 = "execCommandApproval"
	protocolMethodAccountRateLimitsRead               = "account/rateLimits/read"
	protocolMethodItemCommandExecutionRequestApproval = "item/commandExecution/requestApproval"
	protocolMethodItemFileChangeRequestApproval       = "item/fileChange/requestApproval"
	protocolMethodItemPermissionsRequestApproval      = "item/permissions/requestApproval"
	protocolMethodModelList                           = "model/list"
	protocolMethodThreadList                          = "thread/list"
	protocolMethodThreadRead                          = "thread/read"
	protocolMethodThreadResume                        = "thread/resume"
	protocolMethodThreadRollback                      = "thread/rollback"
	protocolMethodThreadStart                         = "thread/start"
	protocolMethodThreadTurnsList                     = "thread/turns/list"
	protocolMethodTurnInterrupt                       = "turn/interrupt"
	protocolMethodTurnStart                           = "turn/start"
	protocolMethodTurnSteer                           = "turn/steer"
)
