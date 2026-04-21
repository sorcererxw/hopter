package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
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

type envelope struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type Client struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	mu     sync.Mutex
	nextID int64
	wait   map[int64]chan envelope
	done   chan error

	onNotification  func(Notification)
	onServerRequest func(ServerRequest)
	onTrace         func(TraceEntry)
	onExit          func()
}

type StartThreadResult struct {
	Thread struct {
		ID   string  `json:"id"`
		Path *string `json:"path"`
		Cwd  string  `json:"cwd"`
	} `json:"thread"`
}

type ThreadStatus struct {
	Type string `json:"type"`
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

type ReadThreadError struct {
	Message string `json:"message"`
}

type ReadThreadItem struct {
	Type             string                 `json:"type"`
	ID               string                 `json:"id"`
	Text             string                 `json:"text"`
	Phase            string                 `json:"phase"`
	Status           string                 `json:"status"`
	Server           string                 `json:"server"`
	Tool             string                 `json:"tool"`
	Command          string                 `json:"command"`
	AggregatedOutput string                 `json:"aggregatedOutput"`
	Source           string                 `json:"source"`
	ProcessID        string                 `json:"processId"`
	ExitCode         *int                   `json:"exitCode"`
	DurationMs       int64                  `json:"durationMs"`
	Arguments        json.RawMessage        `json:"arguments"`
	Result           json.RawMessage        `json:"result"`
	Error            *ReadThreadError       `json:"error"`
	Content          json.RawMessage        `json:"content"`
	Summary          json.RawMessage        `json:"summary"`
	Changes          []ReadThreadFileChange `json:"changes"`
}

type ReadThreadTurn struct {
	ID     string           `json:"id"`
	Status string           `json:"status"`
	Items  []ReadThreadItem `json:"items"`
}

type ReadThreadResult struct {
	Thread struct {
		ID            string           `json:"id"`
		ForkedFromID  *string          `json:"forkedFromId"`
		Preview       string           `json:"preview"`
		Ephemeral     bool             `json:"ephemeral"`
		ModelProvider string           `json:"modelProvider"`
		CreatedAt     int64            `json:"createdAt"`
		UpdatedAt     int64            `json:"updatedAt"`
		Status        ThreadStatus     `json:"status"`
		Path          *string          `json:"path"`
		Cwd           string           `json:"cwd"`
		CLIVersion    string           `json:"cliVersion"`
		Name          *string          `json:"name"`
		Turns         []ReadThreadTurn `json:"turns"`
	} `json:"thread"`
}

type ResumeThreadResult struct {
	Thread ThreadRecord `json:"thread"`
	Cwd    string       `json:"cwd"`
}

func Start(
	ctx context.Context,
	cwd string,
	onNotification func(Notification),
	onServerRequest func(ServerRequest),
	onTrace func(TraceEntry),
	onExit func(),
) (*Client, error) {
	cmd := exec.CommandContext(ctx, "codex", "app-server")
	cmd.Dir = cwd

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("codex stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("codex stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("codex stderr pipe: %w", err)
	}

	client := &Client{
		cmd:             cmd,
		stdin:           stdin,
		wait:            make(map[int64]chan envelope),
		done:            make(chan error, 1),
		onNotification:  onNotification,
		onServerRequest: onServerRequest,
		onTrace:         onTrace,
		onExit:          onExit,
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start codex app-server: %w", err)
	}

	go client.read(stdout)
	go io.Copy(io.Discard, stderr)
	go func() {
		_ = cmd.Wait()
		if client.onExit != nil {
			client.onExit()
		}
	}()

	if err := client.initialize(); err != nil {
		_ = client.Close()
		return nil, err
	}

	return client, nil
}

func (c *Client) Close() error {
	if c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
	return nil
}

func (c *Client) initialize() error {
	_, err := c.request("initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "hopter-go",
			"version": "0.1.0",
		},
		"capabilities": nil,
	})
	return err
}

func (c *Client) StartThread(cwd string) (*StartThreadResult, error) {
	raw, err := c.request("thread/start", map[string]any{
		"cwd":                    cwd,
		"approvalPolicy":         "on-request",
		"sandbox":                "danger-full-access",
		"experimentalRawEvents":  false,
		"persistExtendedHistory": false,
	})
	if err != nil {
		return nil, err
	}
	var out StartThreadResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode thread/start: %w", err)
	}
	return &out, nil
}

func (c *Client) ListThreads(cwd string, limit uint32) (*ThreadListResult, error) {
	params := map[string]any{
		"archived": false,
		"sortKey":  "updated_at",
	}
	if strings.TrimSpace(cwd) != "" {
		params["cwd"] = cwd
	}
	if limit > 0 {
		params["limit"] = limit
	}

	raw, err := c.request("thread/list", params)
	if err != nil {
		return nil, err
	}
	var out ThreadListResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode thread/list: %w", err)
	}
	return &out, nil
}

func (c *Client) ResumeThread(threadID, cwd string) (*ResumeThreadResult, error) {
	params := map[string]any{
		"threadId":               threadID,
		"approvalPolicy":         "on-request",
		"sandbox":                "danger-full-access",
		"persistExtendedHistory": false,
	}
	if strings.TrimSpace(cwd) != "" {
		params["cwd"] = cwd
	}
	raw, err := c.request("thread/resume", params)
	if err != nil {
		return nil, err
	}
	var out ResumeThreadResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode thread/resume: %w", err)
	}
	return &out, nil
}

func (c *Client) StartTurn(threadID string, text string) (*StartTurnResult, error) {
	raw, err := c.request("turn/start", map[string]any{
		"threadId":       threadID,
		"approvalPolicy": "on-request",
		"input": []map[string]any{{
			"type":          "text",
			"text":          text,
			"text_elements": []any{},
		}},
	})
	if err != nil {
		return nil, err
	}
	var out StartTurnResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode turn/start: %w", err)
	}
	return &out, nil
}

func (c *Client) SteerTurn(threadID, expectedTurnID, text string) (*StartTurnResult, error) {
	raw, err := c.request("turn/steer", map[string]any{
		"threadId":       threadID,
		"expectedTurnId": expectedTurnID,
		"approvalPolicy": "on-request",
		"input": []map[string]any{{
			"type":          "text",
			"text":          text,
			"text_elements": []any{},
		}},
	})
	if err != nil {
		return nil, err
	}
	var out StartTurnResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode turn/steer: %w", err)
	}
	return &out, nil
}

func (c *Client) InterruptTurn(threadID, turnID string) error {
	_, err := c.request("turn/interrupt", map[string]any{
		"threadId": threadID,
		"turnId":   turnID,
	})
	if err != nil {
		return fmt.Errorf("interrupt turn: %w", err)
	}
	return nil
}

func (c *Client) ReadThread(threadID string) (*ReadThreadResult, error) {
	return c.readThread(threadID, true)
}

func (c *Client) ReadThreadMeta(threadID string) (*ReadThreadResult, error) {
	return c.readThread(threadID, false)
}

func (c *Client) readThread(threadID string, includeTurns bool) (*ReadThreadResult, error) {
	raw, err := c.request("thread/read", map[string]any{
		"threadId":     threadID,
		"includeTurns": includeTurns,
	})
	if err != nil {
		return nil, err
	}
	var out ReadThreadResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode thread/read: %w", err)
	}
	return &out, nil
}

func (c *Client) request(method string, params any) (json.RawMessage, error) {
	id := atomic.AddInt64(&c.nextID, 1)
	waitCh := make(chan envelope, 1)

	c.mu.Lock()
	c.wait[id] = waitCh
	c.mu.Unlock()

	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal request %s: %w", method, err)
	}
	if _, err := c.stdin.Write(append(payload, '\n')); err != nil {
		return nil, fmt.Errorf("write request %s: %w", method, err)
	}
	c.trace(TraceEntry{
		Direction: "outgoing",
		Kind:      "request",
		Method:    method,
		ID:        fmt.Sprintf("%d", id),
		Payload:   append(json.RawMessage(nil), payload...),
	})

	var (
		response envelope
		ok       bool
	)
	select {
	case response, ok = <-waitCh:
		if !ok {
			return nil, fmt.Errorf("%s: codex app-server closed the response channel", method)
		}
	case err := <-c.done:
		if err == nil {
			err = io.EOF
		}
		c.mu.Lock()
		delete(c.wait, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("%s: %w", method, err)
	}
	if response.Error != nil {
		return nil, fmt.Errorf("%s: %s", method, response.Error.Message)
	}
	return response.Result, nil
}

func (c *Client) read(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 32*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		var msg envelope
		if err := json.Unmarshal(line, &msg); err != nil {
			continue
		}

		if len(msg.Result) > 0 || msg.Error != nil {
			var id int64
			if err := json.Unmarshal(msg.ID, &id); err != nil {
				continue
			}
			c.mu.Lock()
			ch := c.wait[id]
			delete(c.wait, id)
			c.mu.Unlock()
			if ch != nil {
				ch <- msg
			}
			c.trace(TraceEntry{
				Direction: "incoming",
				Kind:      "response",
				ID:        traceID(msg.ID),
				Payload:   append(json.RawMessage(nil), line...),
			})
			continue
		}

		if msg.Method != "" && len(msg.ID) > 0 {
			c.trace(TraceEntry{
				Direction: "incoming",
				Kind:      "server_request",
				Method:    msg.Method,
				ID:        traceID(msg.ID),
				Payload:   append(json.RawMessage(nil), line...),
			})
			if c.onServerRequest != nil {
				req := ServerRequest{
					ID:     append(json.RawMessage(nil), msg.ID...),
					Method: msg.Method,
					Params: append(json.RawMessage(nil), msg.Params...),
				}
				go c.onServerRequest(req)
			}
			continue
		}

		if msg.Method != "" && c.onNotification != nil {
			c.trace(TraceEntry{
				Direction: "incoming",
				Kind:      "notification",
				Method:    msg.Method,
				Payload:   append(json.RawMessage(nil), line...),
			})
			notification := Notification{Method: msg.Method, Params: append(json.RawMessage(nil), msg.Params...)}
			go c.onNotification(notification)
		}
	}

	if err := scanner.Err(); err != nil {
		c.failPending(err)
		return
	}
	c.failPending(io.EOF)
}

func (c *Client) failPending(err error) {
	select {
	case c.done <- err:
	default:
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	for id, ch := range c.wait {
		delete(c.wait, id)
		close(ch)
	}
}

func (c *Client) respondToRequest(rawID json.RawMessage, result any) error {
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      json.RawMessage(rawID),
		"result":  result,
	})
	if err != nil {
		return err
	}
	_, err = c.stdin.Write(append(payload, '\n'))
	if err == nil {
		c.trace(TraceEntry{
			Direction: "outgoing",
			Kind:      "response",
			ID:        traceID(rawID),
			Payload:   append(json.RawMessage(nil), payload...),
		})
	}
	return err
}

func (c *Client) RespondToApproval(rawID json.RawMessage, decision string) error {
	result := map[string]any{
		"decision": decision,
	}
	return c.respondToRequest(rawID, result)
}

func (c *Client) trace(entry TraceEntry) {
	if c.onTrace != nil {
		c.onTrace(entry)
	}
}
