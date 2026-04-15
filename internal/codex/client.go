package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"sync/atomic"
)

type Notification struct {
	Method string
	Params json.RawMessage
}

type serverRequest struct {
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

	onNotification func(Notification)
	onExit         func()
}

type StartThreadResult struct {
	Thread struct {
		ID   string  `json:"id"`
		Path *string `json:"path"`
		Cwd  string  `json:"cwd"`
	} `json:"thread"`
}

type StartTurnResult struct {
	Turn struct {
		ID string `json:"id"`
	} `json:"turn"`
}

type ReadThreadResult struct {
	Thread struct {
		Turns []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
			Items  []struct {
				Type  string `json:"type"`
				Text  string `json:"text"`
				Phase string `json:"phase"`
			} `json:"items"`
		} `json:"turns"`
	} `json:"thread"`
}

func Start(ctx context.Context, cwd string, onNotification func(Notification), onExit func()) (*Client, error) {
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
		cmd:            cmd,
		stdin:          stdin,
		wait:           make(map[int64]chan envelope),
		onNotification: onNotification,
		onExit:         onExit,
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
			"name":    "orchd-go",
			"version": "0.1.0",
		},
		"capabilities": nil,
	})
	return err
}

func (c *Client) StartThread(cwd string) (*StartThreadResult, error) {
	raw, err := c.request("thread/start", map[string]any{
		"cwd":                    cwd,
		"approvalPolicy":         "never",
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

func (c *Client) StartTurn(threadID string, text string) (*StartTurnResult, error) {
	raw, err := c.request("turn/start", map[string]any{
		"threadId": threadID,
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

func (c *Client) ReadThread(threadID string) (*ReadThreadResult, error) {
	raw, err := c.request("thread/read", map[string]any{
		"threadId":     threadID,
		"includeTurns": true,
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

	response := <-waitCh
	if response.Error != nil {
		return nil, fmt.Errorf("%s: %s", method, response.Error.Message)
	}
	return response.Result, nil
}

func (c *Client) read(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 4*1024*1024)

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
			continue
		}

		if msg.Method != "" && len(msg.ID) > 0 {
			c.respondToServerRequest(serverRequest{ID: msg.ID, Method: msg.Method, Params: msg.Params})
			continue
		}

		if msg.Method != "" && c.onNotification != nil {
			notification := Notification{Method: msg.Method, Params: append(json.RawMessage(nil), msg.Params...)}
			go c.onNotification(notification)
		}
	}
}

func (c *Client) respondToServerRequest(req serverRequest) {
	result := map[string]any{}
	switch req.Method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		result = map[string]any{"decision": "accept"}
	case "execCommandApproval", "applyPatchApproval":
		result = map[string]any{"decision": "approved"}
	case "item/permissions/requestApproval":
		result = map[string]any{"permissions": map[string]any{}, "scope": "session"}
	case "item/tool/requestUserInput":
		result = map[string]any{"answers": []any{}}
	}

	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      json.RawMessage(req.ID),
		"result":  result,
	})
	if err == nil {
		_, _ = c.stdin.Write(append(payload, '\n'))
	}
}
