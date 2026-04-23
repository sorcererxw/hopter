package codex

import (
	"context"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/pmenglund/codex-sdk-go/protocol"
	"github.com/pmenglund/codex-sdk-go/rpc"
	"github.com/sorcererxw/hopter/internal/core"
)

type fakeRPCTransport struct {
	mu     sync.Mutex
	reads  chan string
	writes []string
}

func newFakeRPCTransport() *fakeRPCTransport {
	return &fakeRPCTransport{reads: make(chan string, 8)}
}

func (f *fakeRPCTransport) ReadLine() (string, error) {
	line, ok := <-f.reads
	if !ok {
		return "", io.EOF
	}
	return line, nil
}

func (f *fakeRPCTransport) WriteLine(line string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.writes = append(f.writes, line)
	return nil
}

func (f *fakeRPCTransport) Close() error {
	close(f.reads)
	return nil
}

func (f *fakeRPCTransport) queueResponse(id int, result string) {
	f.reads <- `{"id":` + strconv.Itoa(id) + `,"result":` + result + `}`
}

func (f *fakeRPCTransport) writtenLine(index int) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if index < 0 || index >= len(f.writes) {
		return ""
	}
	return f.writes[index]
}

func TestTraceLineClassifiesAppServerRequestWithoutJSONRPC(t *testing.T) {
	var traces []TraceEntry
	transport := &tracedTransport{
		onTrace: func(entry TraceEntry) {
			traces = append(traces, entry)
		},
	}

	transport.traceLine("outgoing", `{"id":7,"method":"thread/start","params":{"approvalPolicy":"on-request"}}`)

	if len(traces) != 1 {
		t.Fatalf("trace count = %d, want 1", len(traces))
	}
	if traces[0].Kind != "request" || traces[0].Method != "thread/start" || traces[0].ID != "7" {
		t.Fatalf("trace = %#v, want outgoing thread/start request", traces[0])
	}
	var payload map[string]any
	if err := json.Unmarshal(traces[0].Payload, &payload); err != nil {
		t.Fatalf("decode trace payload: %v", err)
	}
	if _, ok := payload["jsonrpc"]; ok {
		t.Fatalf("payload included jsonrpc field: %s", traces[0].Payload)
	}
}

func TestApplyServiceTierUsesFastWhenRequested(t *testing.T) {
	var serviceTier interface{}

	applyServiceTier(&serviceTier, core.SessionTurnOptions{
		CodexFastMode: true,
	})

	if serviceTier != protocol.ServiceTierFast {
		t.Fatalf("service tier = %#v, want fast", serviceTier)
	}
}

func TestListThreadsIncludesExecSource(t *testing.T) {
	transport := newFakeRPCTransport()
	client := &Client{
		ctx: context.Background(),
		rpc: rpc.NewClient(transport, rpc.ClientOptions{}),
	}
	defer client.rpc.Close()
	transport.queueResponse(1, `{"data":[]}`)

	if _, err := client.ListThreads("", 10); err != nil {
		t.Fatalf("ListThreads: %v", err)
	}

	line := transport.writtenLine(0)
	if !strings.Contains(line, `"sourceKinds":["cli","exec","vscode","appServer"]`) {
		t.Fatalf("thread/list sourceKinds = %s", line)
	}
}

func TestApplyServiceTierLeavesDefaultWhenFastModeDisabled(t *testing.T) {
	var serviceTier interface{}

	applyServiceTier(&serviceTier, core.SessionTurnOptions{})

	if serviceTier != nil {
		t.Fatalf("service tier = %#v, want nil", serviceTier)
	}
}

func TestBuildCodexInputIncludesImageAttachments(t *testing.T) {
	input := buildCodexInput("inspect this", []core.SessionInputAttachment{
		{
			Label:       "screen.png",
			URL:         "data:image/png;base64,abc123",
			ContentType: "image/png",
		},
		{
			Label: "ignored",
		},
	})

	if len(input) != 2 {
		t.Fatalf("input count = %d, want 2", len(input))
	}
	if input[0].Type != "text" || input[0].Text != "inspect this" {
		t.Fatalf("text input = %#v", input[0])
	}
	if input[1].Type != "image" {
		t.Fatalf("image input type = %q, want image", input[1].Type)
	}
	if input[1].URL != "data:image/png;base64,abc123" {
		t.Fatalf("image url = %q", input[1].URL)
	}
	if input[1].Name != "screen.png" {
		t.Fatalf("image name = %q, want screen.png", input[1].Name)
	}
}

func TestBuildCodexInputPreservesTextOnlyTurn(t *testing.T) {
	input := buildCodexInput("plain follow up", nil)

	if len(input) != 1 {
		t.Fatalf("input count = %d, want 1", len(input))
	}
	if input[0].Type != "text" || input[0].Text != "plain follow up" {
		t.Fatalf("text-only input = %#v", input[0])
	}
}

func TestBuildCodexInputAllowsImageOnlyTurn(t *testing.T) {
	input := buildCodexInput("", []core.SessionInputAttachment{
		{URL: "data:image/jpeg;base64,xyz"},
	})

	if len(input) != 1 {
		t.Fatalf("input count = %d, want 1", len(input))
	}
	if input[0].Type != "image" || input[0].URL != "data:image/jpeg;base64,xyz" {
		t.Fatalf("image-only input = %#v", input[0])
	}
}

func TestTraceLineClassifiesInitializedNotification(t *testing.T) {
	var traces []TraceEntry
	transport := &tracedTransport{
		onTrace: func(entry TraceEntry) {
			traces = append(traces, entry)
		},
	}

	transport.traceLine("outgoing", `{"method":"initialized"}`)

	if len(traces) != 1 {
		t.Fatalf("trace count = %d, want 1", len(traces))
	}
	if traces[0].Kind != "notification" || traces[0].Method != "initialized" {
		t.Fatalf("trace = %#v, want initialized notification", traces[0])
	}
}

func TestTraceLineCapturesServerRequestWireID(t *testing.T) {
	var gotMethod string
	var gotID json.RawMessage
	var gotParams json.RawMessage
	transport := &tracedTransport{
		onServerRequest: func(method string, id json.RawMessage, params json.RawMessage) {
			gotMethod = method
			gotID = append(json.RawMessage(nil), id...)
			gotParams = append(json.RawMessage(nil), params...)
		},
	}

	transport.traceLine("incoming", `{"id":"approval-1","method":"item/fileChange/requestApproval","params":{"itemId":"item-1"}}`)

	if gotMethod != "item/fileChange/requestApproval" {
		t.Fatalf("method = %q", gotMethod)
	}
	if string(gotID) != `"approval-1"` {
		t.Fatalf("id = %s", gotID)
	}
	if string(gotParams) != `{"itemId":"item-1"}` {
		t.Fatalf("params = %s", gotParams)
	}
}
